import { fixtureZeroCost } from '../models/testing/zero-cost-fixture.js';
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutopilotStateStore, getProvider, isModelEligibleForWorkload, modelMetadata } from "@beyonder/compute";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime } from "../runtime.js";
import { loadConfig } from "../config/env.js";
import { DEFAULT_TASK_BUDGET } from "./contracts.js";
import { httpFailure, InferenceError, parseStructuredObject, runCandidates } from "../models/inference.js";
import { discoverOllama } from "../models/ollama-discovery.js";
import { TaskClassifier } from "../intelligence/task-classifier.js";
import { ComplexityEstimator } from "../intelligence/complexity-estimator.js";
import { AdaptiveModelSelector, workloadForTask } from "../models/adaptive-selector.js";
import type { ModelCandidate } from "../models/adaptive-types.js";
import { inspectTaskTrace } from "./trace.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const candidate = (model: string): ModelCandidate => ({ economics: fixtureZeroCost("fixture", model), provider: "fixture", model, monetaryCostUsd: 0, shadowCostUsd: 0.001, utility: 1 } as ModelCandidate);
function setup() {
  const runtime = createRuntime(loadConfig({ BEYONDER_DB_PATH: ":memory:", BEYONDER_MODEL_PROVIDER: "none" }));
  vi.spyOn(runtime.modelRouter, "route").mockImplementation(async (task, economicState) => ({ task, economicState, selected: candidate("first"), candidates: [candidate("first"), candidate("second"), candidate("third")], reason: "fixture candidates", explored: false }));
  return runtime;
}

describe("capability requirements and workload eligibility", () => {
  it.each([
    ["Calcule 27 vezes 14 usando a calculadora.", "tool-use", "calculator"],
    ["Use a calculadora para somar 2 + 2.", "tool-use", "calculator"],
    ["Calculate 27 times 14 using the calculator.", "tool-use", "calculator"],
    ["Use the calculator to add 2 + 2.", "tool-use", "calculator"],
    ["Responda apenas OK.", "chat", "directResponse"],
    ["Reply only OK.", "chat", "directResponse"],
    ["Pesquise na web oportunidades.", "research", "browser"],
    ["Research online sources.", "research", "browser"],
    ["Refatore esta função.", "coding", "coding"],
    ["Refactor this function.", "coding", "coding"]
  ])("detects %s", (input, type, requirement) => {
    const actual = new TaskClassifier().classify(input);
    expect(actual).toBe(type);
    expect(new ComplexityEstimator().estimate(input, actual).requirements).toMatchObject({ [requirement]: true });
  });
  it.each(["meta-llama/llama-prompt-guard-2-86m", "meta-llama/llama-prompt-guard-2-22m", "openai/gpt-oss-safeguard-20b", "qwen3-embedding", "some-reranker", "whisper-large"])("excludes specialized model %s", (id) => {
    for (const workload of ["general_chat", "planning", "tool-use", "reasoning"] as const) expect(isModelEligibleForWorkload(getProvider("groq")!, id, workload)).toBe(false);
  });
  it("honors explicit model roles and maps actual workloads", () => {
    const provider = { ...getProvider("groq")!, modelCatalog: [{ id: "opaque-123", capabilities: ["CHAT" as const], role: "guard" as const }] };
    expect(isModelEligibleForWorkload(provider, "opaque-123", "general_chat")).toBe(false);
    for (const type of ["planning", "tool-use", "reasoning", "coding", "research", "browser", "extraction", "classification", "compression"] as const) expect(workloadForTask(type)).toBe(type);
    expect(modelMetadata(getProvider("groq")!, "unknown-instruct").costClass).toBe("UNKNOWN_COST");
  });
});

describe("bounded real executor inference pipeline", () => {
  it("persists action-planning attempts before inference, falls back 400 → 429 → calculator, and retains attribution", async () => {
    const runtime = setup();
    try {
      const { task } = await runtime.intelligence.inspect("Calcule 27 vezes 14 usando a calculadora e responda apenas o número.");
      const tools = await runtime.getAvailableTools();
      const complete = vi.spyOn(runtime.modelRouter, "completeForPlanningCandidate").mockImplementation(async (_messages, c) => {
        const attempts = await runtime.modelRouter.attemptsFor(task.id);
        expect(attempts.at(-1)).toMatchObject({ status: "STARTED", provider: "fixture", model: c.model });
        if (attempts.at(-1)?.phase === "PLANNING") return { provider: "fixture", model: c.model, estimatedCostUsd: 0, content: JSON.stringify({ id: "plan", taskId: task.id, objective: task.input, createdAt: new Date().toISOString(), revision: 1, steps: [{ id: "calculate", description: "Calculate", status: "PENDING", allowedToolCapabilities: ["calculation"] }] }) };
        if (c.model === "first") throw httpFailure(400, "bad request");
        if (c.model === "second") throw httpFailure(429, "retry later");
        return { provider: "fixture", model: c.model, estimatedCostUsd: 0, content: '```json\n{"id":"calc","tool":"calculator","arguments":{"operation":"multiply","operands":[27,14]}}\n```' };
      });
      const plan = { id: "bounded-action-plan", taskId: task.id, objective: task.input, createdAt: new Date().toISOString(), revision: 1, steps: [{ id: "calculate", description: "Calculate through the selected tool", status: "PENDING" as const, allowedToolCapabilities: ["calculation"] }] };
      const outcome = await runtime.taskExecutor.execute({ task, plan, economicState: "normal" });
      expect(complete).toHaveBeenCalledTimes(3);
      expect(outcome.status).toBe("COMPLETED");
      expect(outcome.result).toBe("378");
      expect(outcome.execution.usage.toolInvocations).toBe(1);
      expect(outcome.execution.steps[0]?.toolResult?.output).toEqual({ value: 378 });
      expect(outcome.execution.attempts?.filter((a) => a.status === "FAILED").map((a) => a.failureClass)).toEqual(["BAD_REQUEST", "RATE_LIMITED"]);
      expect((await runtime.checkpoints.get(task.id))?.state).toBe("COMPLETED");
      expect(await inspectTaskTrace(runtime, task.id)).toMatchObject({ taskId: task.id, execution: { result: "378" } });
      const memory = (await runtime.memoryStore.all()).find((m) => m.kind === "economic");
      expect(memory?.metadata).toMatchObject({ provider: "fixture", model: "third" });
    } finally { runtime.sqlite.close(); }
  });

  it("direct response uses no tools and completes", async () => {
    const runtime = setup();
    try {
      const { task } = await runtime.intelligence.inspect("Responda apenas OK.");
      const complete = vi.spyOn(runtime.modelRouter, "completeForPlanningCandidate");
      const tool = vi.spyOn(runtime.toolExecutor, "execute");
      const plan = await runtime.planner.createPlan({ task, objective: task.input, memoryContext: [], availableTools: await runtime.getAvailableTools(), budget: DEFAULT_TASK_BUDGET, economicState: "normal" });
      const outcome = await runtime.taskExecutor.execute({ task, plan, economicState: "normal", completionCriteria: { expectedText: "OK" } });
      expect(outcome).toMatchObject({ status: "COMPLETED", result: "OK" });
      expect(tool).not.toHaveBeenCalled();
      expect(outcome.execution.attempts?.[0]?.phase).toBe("DIRECT_RESPONSE");
      expect(outcome.execution.attempts?.[0]).toMatchObject({ provider: "deterministic", model: "literal-output-contract" });
      expect(complete).not.toHaveBeenCalled();
    } finally { runtime.sqlite.close(); }
  });

  it("presents calculator evidence without a second tool call or model calculation", async () => {
    const runtime = setup();
    try {
      const { task } = await runtime.intelligence.inspect("Calcule 27 vezes 14 usando a calculadora e responda apenas o número.");
      const complete = vi.spyOn(runtime.modelRouter, "completeForPlanningCandidate");
      const outcome = await runtime.taskExecutor.execute({ task, economicState: "normal", plan: { id: "plan", taskId: task.id, objective: task.input, createdAt: new Date().toISOString(), revision: 1, steps: [
        { id: "calculate", description: "Calculate", status: "PENDING", action: { id: "calc", tool: "calculator", arguments: { operation: "multiply", operands: [27, 14] } } },
        { id: "respond", description: "Present result", status: "PENDING", kind: "DIRECT_RESPONSE", dependencies: ["calculate"] }
      ] } });
      expect(outcome).toMatchObject({ status: "COMPLETED", result: "378" });
      expect(outcome.execution.usage.toolInvocations).toBe(1);
      expect(complete).not.toHaveBeenCalled();
    } finally { runtime.sqlite.close(); }
  });

  it("cannot bypass calculator requirements with an early direct response", async () => {
    const runtime = setup();
    try {
      const { task } = await runtime.intelligence.inspect("Calculate 27 times 14 using the calculator.");
      const outcome = await runtime.taskExecutor.execute({ task, economicState: "normal", plan: { id: "p", taskId: task.id, objective: task.input, revision: 1, createdAt: new Date().toISOString(), steps: [{ id: "fake", description: "Pretend", kind: "DIRECT_RESPONSE", status: "PENDING" }] } });
      expect(outcome.status).toBe("FAILED");
      expect(outcome.execution.failure?.failureClass).toBe("INVALID_ACTION");
    } finally { runtime.sqlite.close(); }
  });

  it("failure before ToolCall keeps provider/model/error and does not poison quality memory", async () => {
    const runtime = setup();
    try {
      const { task } = await runtime.intelligence.inspect("Use a calculadora para somar 2 + 2.");
      vi.spyOn(runtime.modelRouter, "completeForPlanningCandidate").mockRejectedValue(httpFailure(500, "authorization=secret"));
      const outcome = await runtime.taskExecutor.execute({ task, economicState: "normal", plan: { id: "plan", taskId: task.id, objective: task.input, createdAt: new Date().toISOString(), revision: 1, steps: [{ id: "calc", description: "Calculate", status: "PENDING" }] } });
      expect(outcome.status).toBe("FAILED");
      expect(outcome.execution.usage.toolInvocations).toBe(0);
      expect(outcome.execution.failure).toMatchObject({ provider: "fixture", model: "third", phase: "ACTION_PLANNING", failureClass: "PROVIDER_UNAVAILABLE", httpStatus: 500 });
      expect(outcome.execution.checkpoints.length).toBeGreaterThan(0);
      const memory = (await runtime.memoryStore.all()).find((m) => m.kind === "economic");
      expect(memory?.metadata).toMatchObject({ provider: "fixture", failureClass: "PROVIDER_UNAVAILABLE" });
      expect((await runtime.performance.get("fixture", "third", task.type)).samples).toBe(0);
    } finally { runtime.sqlite.close(); }
  });
});

describe("parsing, budgets and local discovery", () => {
  it.each([
    [503, "Upstream error from Nvidia: Service temporarily overloaded", "PROVIDER_UNAVAILABLE", undefined],
    [429, "Rate limit exceeded for free models. Please try again later.", "RATE_LIMITED", "provider"],
    [401, "paid_model_auth_required", "AUTH_REQUIRED", "model"]
  ])("preserves actual HTTP 200 and classifies upstream %s operational failure", async (code, message, failureClass, failureScope) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code, message } }))));
    const runtime = createRuntime(loadConfig({ BEYONDER_DB_PATH: ":memory:", BEYONDER_MODEL_PROVIDER: "auto" }), { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model) });
    try {
      const attempts: import("../models/inference.js").InferenceAttempt[] = [];
      await expect(runCandidates({ taskId: "upstream-envelope", phase: "DIRECT_RESPONSE", candidates: [{ ...candidate("physical-model"), provider: "kilo-gateway", economics: fixtureZeroCost("kilo-gateway", "physical-model") }], maxMonetaryCostUsd: 0, maxShadowCostUsd: 1, maxDurationMs: 1000,
        messages: [{ role: "user", content: "answer" }], complete: (messages, model) => runtime.modelRouter.completeForPlanningCandidate(messages, model), validate: response => response.content,
        record: async attempt => { if (attempt.status !== "STARTED") { attempts.push({ ...attempt }); await runtime.modelRouter.recordAttempt(attempt); } }
      })).rejects.toMatchObject({ failureClass, httpStatus: 200, upstreamHttpStatus: code });
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({ status: "FAILED", httpStatus: 200, upstreamHttpStatus: code, failureClass, failureScope });
      expect((await runtime.modelRouter.operationalHealth.get("kilo-gateway", "physical-model")).failures).toBe(1);
      expect(await runtime.modelRouter.canAttempt({ provider: "kilo-gateway", model: "physical-model" })).toBe(false);
    } finally { runtime.sqlite.close(); }
  });
  it.each([
    { error: { message: "Upstream unavailable", apiKey: "SENSITIVE" } },
    { model: "observed-model", choices: [{ message: { content: "" }, finish_reason: "stop" }] },
    { model: "observed-model", choices: [{ message: { content: "partial", reasoning: "PRIVATE_CHAIN" }, finish_reason: "length" }], usage: { total_tokens: 2400, cost: 0 } }
  ])("retains redacted diagnostics for unusable HTTP 200 completions", async envelope => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(envelope))));
    const runtime = createRuntime(loadConfig({ BEYONDER_DB_PATH: ":memory:", BEYONDER_MODEL_PROVIDER: "auto" }), { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model) });
    try {
      let failure: unknown;
      try { await runtime.modelRouter.completeForPlanningCandidate([{ role: "user", content: "answer" }], { ...candidate("physical-model"), provider: "kilo-gateway", economics: fixtureZeroCost("kilo-gateway", "physical-model") }); } catch (error) { failure = error; }
      expect(failure).toMatchObject({ failureClass: "INVALID_OUTPUT", httpStatus: 200 });
      const diagnostic = (failure as InferenceError).responseBody!;
      expect(diagnostic).not.toContain("SENSITIVE"); expect(diagnostic).not.toContain("PRIVATE_CHAIN");
      expect(diagnostic.length).toBeLessThanOrEqual(1500);
      expect(JSON.parse(diagnostic)).toMatchObject("error" in envelope ? { error: { message: "Upstream unavailable" } } : { model: "observed-model", finishReason: envelope.choices[0]!.finish_reason });
    } finally { runtime.sqlite.close(); }
  });
  it("resolves Cloudflare account separately from its bearer token", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "fixture-account");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "fixture-token");
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] })));
    vi.stubGlobal("fetch", fetch);
    const runtime = createRuntime(loadConfig({ BEYONDER_DB_PATH: ":memory:", BEYONDER_MODEL_PROVIDER: "auto" }), { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model) });
    try {
      await runtime.modelRouter.completeForPlanningCandidate([{ role: "user", content: "OK" }], { ...candidate("model"), provider: "cloudflare-workers-ai" });
      expect(fetch).toHaveBeenCalledWith("https://api.cloudflare.com/client/v4/accounts/fixture-account/ai/v1/chat/completions", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer fixture-token" }) }));
    } finally { runtime.sqlite.close(); }
  });
  it.each(["physical-research", "physical-planning", "physical-code"])("keeps the observed BIB JSON profile for %s instead of unmeasured native mode", async model => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ model, choices: [{ message: { content: '{"satisfied":true}' } }] })));
    vi.stubGlobal("fetch", fetch);
    const runtime = createRuntime(loadConfig({ BEYONDER_DB_PATH: ":memory:", BEYONDER_MODEL_PROVIDER: "auto" }), { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model) });
    try {
      await runtime.modelRouter.completeForStructuredCandidate([{ role: "user", content: "verify" }], { ...candidate(model), provider: "kilo-gateway", structuredOutput: "native", benchmarkCapability: { source: "BIB", score: 1, samples: 2, structuredOutputMode: "prompted" } });
      const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
      expect(body.response_format).toBeUndefined();
      expect(body.max_tokens).toBeGreaterThanOrEqual(3600);
      expect(body.max_tokens).toBeLessThanOrEqual(4800);
    } finally { runtime.sqlite.close(); }
  });

  it.each(["native", "prompted", "unknown"] as const)("uses only declared JSON mode for remote verification (%s)", async structuredOutput => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "fixture-account");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "fixture-token");
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: '{"satisfied":true}' } }] })));
    vi.stubGlobal("fetch", fetch);
    const runtime = createRuntime(loadConfig({ BEYONDER_DB_PATH: ":memory:", BEYONDER_MODEL_PROVIDER: "auto" }), { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model) });
    try {
      await runtime.modelRouter.completeForStructuredCandidate([{ role: "user", content: "verify" }], { ...candidate("fixture-model"), provider: "cloudflare-workers-ai", structuredOutput });
      const completionCall = fetch.mock.calls.find(([url]) => String(url).endsWith('/chat/completions'));
      const body = JSON.parse(String((completionCall?.[1] as RequestInit | undefined)?.body));
      expect(body).toMatchObject({ model: "fixture-model", stream: false });
      expect(body.response_format).toEqual(structuredOutput === "native" ? { type: "json_object" } : undefined);
      expect(body.max_tokens).toBeGreaterThanOrEqual(3600);
      expect(body.max_tokens).toBeLessThanOrEqual(4800);
    } finally { runtime.sqlite.close(); }
  });
  it.each([400, 401, 403, 404, 429, 500])("classifies HTTP %s without exposing credentials", (status) => {
    const error = httpFailure(status, '{"apiKey":"SENSITIVE","message":"Bearer SENSITIVE"}');
    expect(error.httpStatus).toBe(status);
    expect(error.responseBody).not.toContain("SENSITIVE");
  });
  it.each(['{"ok":true}', '```json\n{"ok":true}\n```', 'Result: {"ok":true}'])("parses one safely extractable object", (text) => expect(parseStructuredObject(text)).toEqual({ ok: true }));
  it.each(['{} {}', '{broken}', '{"x":"unterminated}', 'no JSON'])("rejects ambiguous or malformed output", (text) => expect(() => parseStructuredObject(text)).toThrow());
  it("tries the next free candidate despite advisory shadow budget", async () => {
    const complete = vi.fn().mockRejectedValue(httpFailure(429, "limited"));
    await expect(runCandidates({ taskId: "t", phase: "PLANNING", candidates: [candidate("1"), candidate("2")], messages: [], maxMonetaryCostUsd: 0, maxShadowCostUsd: 0.001, maxDurationMs: 500, complete, validate: (v) => v })).rejects.toMatchObject({ failureClass: "RATE_LIMITED" });
    expect(complete).toHaveBeenCalledTimes(2);
  });
  it("bounds a stalled inference and persists TIMEOUT", async () => {
    const record = vi.fn();
    await expect(runCandidates({ taskId: "t", phase: "ACTION_PLANNING", candidates: [candidate("slow")], messages: [], maxMonetaryCostUsd: 0, maxShadowCostUsd: 0.01, maxDurationMs: 20, complete: () => new Promise(() => {}), validate: (v) => v, record })).rejects.toMatchObject({ failureClass: "TIMEOUT" });
    expect(record.mock.calls.at(-1)?.[0]).toMatchObject({ model: "slow", status: "FAILED", failureClass: "TIMEOUT" });
  });
  it("persists bounded invalid model output for diagnosis without executing it", async () => {
    const record = vi.fn();
    const content = JSON.stringify({ unexpected: "diagnostic", apiKey: "SECRET" });
    await expect(runCandidates({ taskId: "t", phase: "OBJECTIVE_VERIFICATION", candidates: [candidate("invalid")], messages: [], maxMonetaryCostUsd: 0, maxShadowCostUsd: 0.01, maxDurationMs: 500, complete: async () => ({ provider: "fixture", model: "invalid", estimatedCostUsd: 0, content }), validate: () => { throw new InferenceError("invalid verdict", "INVALID_OUTPUT"); }, record })).rejects.toMatchObject({ failureClass: "INVALID_OUTPUT" });
    expect(record.mock.calls.at(-1)?.[0]).toMatchObject({ status: "FAILED", responseBody: expect.stringContaining("diagnostic") });
    expect(record.mock.calls.at(-1)?.[0].responseBody).not.toContain("SECRET");
  });
  it("keeps persisted pre-tool attribution after runtime restart", async () => {
    const dbPath = join(await mkdtemp(join(tmpdir(), "beyonder-trace-")), "runtime.sqlite");
    const config = loadConfig({ BEYONDER_DB_PATH: dbPath, BEYONDER_MODEL_PROVIDER: "none" });
    const first = createRuntime(config);
    await first.modelRouter.recordAttempt({ id: "attempt", taskId: "task-restart", phase: "ACTION_PLANNING", attempt: 1, provider: "groq", model: "failed-model", startedAt: new Date().toISOString(), status: "FAILED", failureClass: "BAD_REQUEST", httpStatus: 400, monetaryCostUsd: 0, shadowCostUsd: 0 });
    first.sqlite.close();
    const second = createRuntime(config);
    try { expect((await second.modelRouter.attemptsFor("task-restart"))[0]).toMatchObject({ provider: "groq", model: "failed-model", httpStatus: 400 }); }
    finally { second.sqlite.close(); }
  });
  it("discovers installed local completion capabilities without pulling models", async () => {
    const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/api/tags") ? { models: [{ name: "qwen3:4b" }, { name: "qwen2.5-coder:3b" }] } : { capabilities: ["completion", "tools", "thinking"] })));
    vi.stubGlobal("fetch", fetch);
    const entries = await discoverOllama("http://localhost:11434");
    expect(entries.flatMap((e) => e.models)).toEqual(["qwen3:4b", "qwen2.5-coder:3b"]);
    expect(entries.every((e) => e.modelMetadata[0]?.costClass === "FREE_CONFIRMED")).toBe(true);
    expect(fetch.mock.calls.every(([url]) => /\/api\/(tags|show)$/.test(url))).toBe(true);
  });
  it("passes an explicit JSON schema to local structured verification", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(String(_url).endsWith("/api/tags") ? { models: [{ name: "fixture-local" }] } : String(_url).endsWith("/api/show") ? { capabilities: ["completion"] } : { message: { content: '{"satisfied":true}' } })));
    vi.stubGlobal("fetch", fetch);
    const runtime = createRuntime(loadConfig({ BEYONDER_DB_PATH: ":memory:", BEYONDER_MODEL_PROVIDER: "ollama", BEYONDER_MODEL_NAME: "fixture-local" }));
    try {
      const schema = { type: "object", required: ["satisfied"], properties: { satisfied: { type: "boolean" } } };
      await runtime.modelRouter.completeForStructuredCandidate([{ role: "user", content: "verify" }], { ...candidate("fixture-local"), provider: "ollama", local: true }, undefined, schema);
      const body = JSON.parse(String((fetch.mock.calls.find(call => String(call[0]).endsWith("/api/chat"))?.[1] as RequestInit | undefined)?.body));
      expect(body).toMatchObject({ model: "fixture-local", stream: false, think: false, format: schema });
    } finally { runtime.sqlite.close(); }
  });
  it("tolerates offline Ollama", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(await discoverOllama("http://localhost:11434")).toEqual([]);
  });
  it("auto pool includes reachable local models, excludes unknown costs and unsupported structured output", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "beyonder-hardening-")), "providers.json");
    await new AutopilotStateStore(path).write({ version: 1, updatedAt: new Date().toISOString(), providers: { groq: { providerId: "groq", state: "READY", classification: "AUTO_WITH_HUMAN_GATE", attempts: 1, lastUpdatedAt: new Date().toISOString(), validation: { status: "validated", models: ["unknown-instruct", "llama-3.3-70b-versatile"] } } } });
    const provider = getProvider("groq")!;
    const previous = provider.modelCatalog;
    provider.modelCatalog = [{ id: "llama-3.3-70b-versatile", capabilities: ["CHAT"], structuredOutput: "unsupported", costClass: "FREE_TIER_ELIGIBLE" }];
    try {
      vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/api/tags") ? { models: [{ name: "qwen3:4b" }] } : { capabilities: ["completion", "tools"] }))));
      const selector = new AdaptiveModelSelector(path, { economicEvidence: async (provider, model) => model === "unknown-instruct" ? { ...fixtureZeroCost(provider, model), zeroCostExecutionGuaranteed: false, classification: "UNKNOWN_COST" as const, monetaryCost: { state: "UNKNOWN" as const } } : fixtureZeroCost(provider, model), ollamaBaseUrl: "http://localhost:11434" });
      const task = { id: "auto", input: "Choose a tool", type: "tool-use" as const, complexity: 0.1, risk: 0, estimatedTokens: 100, requirements: { structuredOutput: true } };
      const route = await selector.route(task, "survival");
      expect(route.candidates.some((c) => c.provider === "ollama" && c.model === "qwen3:4b" && c.local && c.monetaryCostUsd === 0)).toBe(true);
      expect(route.candidates.some((c) => c.provider === "groq")).toBe(false);
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      const offline = await selector.route({ ...task, requirements: {} }, "survival");
      expect(offline.candidates.some((c) => c.provider === "groq")).toBe(true);
      expect(offline.candidates.some((c) => c.provider === "ollama")).toBe(false);
    } finally { provider.modelCatalog = previous; }
  });
  it.each([
    '{"id":"x","tool":"unknown","arguments":{}}',
    '{"id":"x","tool":"calculator","arguments":{"operation":"multiply","operands":[2,3],"extra":true}}',
    '{"id":"x","tool":"calculator","arguments":{"operation":"multiply","operands":[2,3]},"extra":true}'
  ])("rejects invalid actions without invoking tools", async (content) => {
    const runtime = setup();
    try {
      const { task } = await runtime.intelligence.inspect("Use a calculadora para somar 2 + 2.");
      vi.spyOn(runtime.modelRouter, "completeForPlanningCandidate").mockResolvedValue({ provider: "fixture", model: "first", estimatedCostUsd: 0, content });
      const result = await runtime.taskExecutor.execute({ task, economicState: "normal", plan: { id: "p", taskId: task.id, objective: task.input, revision: 1, createdAt: new Date().toISOString(), steps: [{ id: "c", description: "Calculate", status: "PENDING" }] } });
      expect(result.execution.failure?.failureClass).toBe("INVALID_ACTION");
      expect(result.execution.usage.toolInvocations).toBe(0);
    } finally { runtime.sqlite.close(); }
  });
});
