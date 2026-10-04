import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskClassifier } from "../intelligence/task-classifier.js";
import { ComplexityEstimator } from "../intelligence/complexity-estimator.js";
import { createRuntime } from "../runtime.js";
import { loadConfig } from "../config/env.js";
import { DEFAULT_TASK_BUDGET, type Plan } from "./contracts.js";
import { httpFailure, InferenceError, runCandidates } from "../models/inference.js";
import { getEconomicRoutingPolicy, inferenceAttemptPolicy } from "../models/router-config.js";
import type { ModelCandidate } from "../models/adaptive-types.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const remote = (model = "remote"): ModelCandidate => ({ provider: "fixture", model, monetaryCostUsd: 0, shadowCostUsd: 0.001, local: false, utility: 1 } as ModelCandidate);
const local: ModelCandidate = { ...remote("local"), provider: "ollama", local: true, costClass: "FREE_CONFIRMED", shadowCostUsd: 0, externalQuotaConsumption: false };
const response = { provider: "fixture", model: "remote", content: "OK", estimatedCostUsd: 0 };
function setup(browser = false) {
  const runtime = createRuntime(loadConfig({ BEYONDER_DB_PATH: ":memory:", BEYONDER_MODEL_PROVIDER: "none", BEYONDER_TOOLS_ENABLED: "1", BEYONDER_BROWSER_ENABLED: browser ? "1" : "0" }));
  vi.spyOn(runtime.modelRouter, "route").mockImplementation(async (task, economicState) => ({ task, economicState, selected: remote(), candidates: [remote()], reason: "fixture", explored: false }));
  return runtime;
}

describe("browser intent independent of incidental language tokens", () => {
  it.each([
    "Abra https://nodejs.org/ e descubra a versão LTS",
    "Abra https://typescriptlang.org e leia a documentação",
    "Use o site oficial do Python para descobrir a versão",
    "Abra a documentação do TypeScript e descubra a versão",
    "Open the site https://nodejs.org and read the LTS version",
    "Look on the website for the Python release",
    "Consulte o site oficial e descubra a versão"
  ])("requires actual browser evidence: %s", (input) => {
    expect(new TaskClassifier().classify(input)).toBe("browser");
    // A conflicting metadata classifier must not erase the actual requirements.
    for (const type of ["browser", "coding", "reasoning"] as const) {
      expect(new ComplexityEstimator().estimate(input, type).requirements).toMatchObject({ browser: true, toolUse: true, directResponse: false, planning: true, tools: ["browser"] });
    }
  });
  it("does not treat product names as code files", () => {
    const input = "Explique o que é Node.js";
    const type = new TaskClassifier().classify(input);
    expect(type).toBe("chat");
    expect(new ComplexityEstimator().estimate(input, type).requirements).toMatchObject({ browser: false, coding: false, directResponse: true });
  });
  it("retains explicit coding intent", () => {
    const input = "Refatore src/server.js";
    const type = new TaskClassifier().classify(input);
    expect(type).toBe("coding");
    expect(new ComplexityEstimator().estimate(input, type).requirements.coding).toBe(true);
  });
});

describe("browser evidence and no-tool response boundary", () => {
  it("replaces a model's invalid direct-only browser plan with a tool-backed evidence plan", async () => {
    const runtime = setup(true);
    try {
      const { task } = await runtime.intelligence.inspect("Abra https://nodejs.org e leia a versão LTS");
      vi.spyOn(runtime.modelRouter, "completeForPlanningCandidate").mockResolvedValue({ ...response, content: JSON.stringify({ id: "p", taskId: task.id, objective: task.input, revision: 1, createdAt: new Date().toISOString(), steps: [{ id: "fake", description: "Pretend", status: "PENDING", kind: "DIRECT_RESPONSE" }] }) });
      const plan = await runtime.planner.createPlan({ task, objective: task.input, availableTools: await runtime.getAvailableTools(), memoryContext: [], budget: DEFAULT_TASK_BUDGET, economicState: "survival" });
      expect(plan.steps.map((step) => ({ kind: step.kind, capabilities: step.allowedToolCapabilities, dependencies: step.dependencies }))).toEqual([
        { kind: "TOOL", capabilities: ["browser", "browser:open"], dependencies: undefined },
        { kind: "TOOL", capabilities: ["browser", "browser:extractText"], dependencies: ["browser-navigate"] },
        { kind: "DIRECT_RESPONSE", capabilities: undefined, dependencies: ["browser-read"] }
      ]);
      expect(runtime.planner.lastResult).toMatchObject({ provider: "deterministic", model: "browser-read-plan", usedFallback: true });
    } finally { await runtime.browser.closeAll(); runtime.sqlite.close(); }
  });
  it("fails explicitly before inference when browser is unavailable", async () => {
    const runtime = setup();
    try {
      const { task } = await runtime.intelligence.inspect("Abra https://nodejs.org e leia a versão LTS");
      const complete = vi.spyOn(runtime.modelRouter, "completeForPlanningCandidate");
      await expect(runtime.planner.createPlan({ task, objective: task.input, availableTools: await runtime.getAvailableTools(), memoryContext: [], budget: DEFAULT_TASK_BUDGET, economicState: "survival" })).rejects.toMatchObject({ failureClass: "TOOL_UNAVAILABLE" });
      expect(complete).not.toHaveBeenCalled();
    } finally { runtime.sqlite.close(); }
  });
  it.each([false, true])("rejects an initial direct-response-only plan (browser available=%s)", async (browser) => {
    const runtime = setup(browser);
    try {
      const { task } = await runtime.intelligence.inspect("Abra https://nodejs.org e leia a versão LTS");
      const complete = vi.spyOn(runtime.modelRouter, "completeForPlanningCandidate");
      const outcome = await runtime.taskExecutor.execute({ task, economicState: "survival", plan: { id: "p", taskId: task.id, objective: task.input, revision: 1, createdAt: new Date().toISOString(), steps: [{ id: "fake", description: "Pretend", kind: "DIRECT_RESPONSE", status: "PENDING" }] } });
      expect(outcome.status).toBe("FAILED");
      expect(outcome.execution.failure?.failureClass).toBe(browser ? "INVALID_ACTION" : "TOOL_UNAVAILABLE");
      expect(complete).not.toHaveBeenCalled();
    } finally { await runtime.browser.closeAll(); runtime.sqlite.close(); }
  });
  it("runs a registered browser READ tool before an evidence-backed final response", async () => {
    const runtime = setup(true);
    try {
      const { task } = await runtime.intelligence.inspect("Abra https://nodejs.org e leia a versão LTS");
      const tools = await runtime.getAvailableTools();
      const open = tools.find((tool) => tool.capabilities.includes("browser:open"))!;
      expect(open.sideEffects).toEqual(["READ"]);
      vi.spyOn(runtime.browser, "startSession").mockResolvedValue("fixture-session");
      const browser = vi.spyOn(runtime.browser, "execute").mockResolvedValue({ status: "ok", action: { type: "open", url: "https://nodejs.org/" }, observation: { url: "https://nodejs.org/", title: "Node.js fixture", visibleText: "Fixture release v24.0.0 LTS", interactiveElements: [] } } as never);
      const plan: Plan = { id: "p", taskId: task.id, objective: task.input, revision: 1, createdAt: new Date().toISOString(), steps: [
        { id: "read", description: "Read official page", status: "PENDING", action: { id: "open", tool: open.id, arguments: { url: "https://nodejs.org/" } } },
        { id: "respond", description: "Answer from evidence", status: "PENDING", kind: "DIRECT_RESPONSE", dependencies: ["read"] }
      ] };
      vi.spyOn(runtime.modelRouter, "completeForPlanningCandidate").mockImplementation(async (messages) => {
        expect(JSON.stringify(messages)).toContain("Fixture release v24.0.0 LTS");
        return { ...response, content: "v24.0.0 LTS (fixture)" };
      });
      const outcome = await runtime.taskExecutor.execute({ task, plan, economicState: "survival" });
      expect(outcome.status).toBe("COMPLETED");
      expect(browser).toHaveBeenCalledOnce();
      expect(outcome.execution.usage.toolInvocations).toBe(1);
      expect(outcome.execution.steps[0]?.toolCapabilities).toContain("browser");
      expect(outcome.result).toContain("v24.0.0");
      expect((await runtime.checkpoints.get(task.id))?.state).toBe("COMPLETED");
    } finally { await runtime.browser.closeAll(); runtime.sqlite.close(); }
  });
  it("formats observed browser evidence deterministically after an operational response failure", async () => {
    const runtime = setup(true);
    try {
      const { task } = await runtime.intelligence.inspect("Use o site oficial do Python para descobrir a versão estável atual e explique em uma frase curta o que encontrou.");
      const open = (await runtime.getAvailableTools()).find((tool) => tool.capabilities.includes("browser:open"))!;
      vi.spyOn(runtime.browser, "startSession").mockResolvedValue("fixture-session");
      const browser = vi.spyOn(runtime.browser, "execute").mockResolvedValue({ status: "ok", action: { type: "open", url: "https://python.org/" }, observation: { url: "https://python.org/", title: "Python fixture", visibleText: "Download Python 3.14.8. Release notes are available.", interactiveElements: [] } } as never);
      vi.spyOn(runtime.modelRouter, "completeForPlanningCandidate").mockRejectedValue(new InferenceError("Inference deadline exceeded.", "TIMEOUT"));
      const plan: Plan = { id: "p", taskId: task.id, objective: task.input, revision: 1, createdAt: new Date().toISOString(), steps: [
        { id: "read", description: "Read official page", status: "PENDING", action: { id: "open", tool: open.id, arguments: { url: "https://python.org/" } } },
        { id: "respond", description: "Answer from evidence", status: "PENDING", kind: "DIRECT_RESPONSE", dependencies: ["read"] }
      ] };
      const outcome = await runtime.taskExecutor.execute({ task, plan, economicState: "survival" });
      expect(outcome.status).toBe("COMPLETED");
      expect(outcome.result).toBe("A versão estável atual do Python observada no site oficial é 3.14.8.");
      expect(browser).toHaveBeenCalledOnce();
      expect(outcome.execution.attempts?.at(-1)).toMatchObject({ phase: "DIRECT_RESPONSE", provider: "deterministic", model: "observed-evidence-format", status: "SUCCEEDED" });
      expect(outcome.execution.steps.at(-1)?.route?.selected).toMatchObject({ provider: "deterministic", model: "observed-evidence-format" });
    } finally { await runtime.browser.closeAll(); runtime.sqlite.close(); }
  });
  it("does not claim success when an operational response failure has no matching fact in browser evidence", async () => {
    const runtime = setup(true);
    try {
      const { task } = await runtime.intelligence.inspect("Use o site oficial do Python para descobrir a versão estável atual.");
      const open = (await runtime.getAvailableTools()).find((tool) => tool.capabilities.includes("browser:open"))!;
      vi.spyOn(runtime.browser, "startSession").mockResolvedValue("fixture-session");
      vi.spyOn(runtime.browser, "execute").mockResolvedValue({ status: "ok", action: { type: "open", url: "https://python.org/" }, observation: { url: "https://python.org/", title: "Python fixture", visibleText: "No release information is present in this fixture.", interactiveElements: [] } } as never);
      vi.spyOn(runtime.modelRouter, "completeForPlanningCandidate").mockRejectedValue(new InferenceError("Inference deadline exceeded.", "TIMEOUT"));
      const plan: Plan = { id: "p", taskId: task.id, objective: task.input, revision: 1, createdAt: new Date().toISOString(), steps: [
        { id: "read", description: "Read official page", status: "PENDING", action: { id: "open", tool: open.id, arguments: { url: "https://python.org/" } } },
        { id: "respond", description: "Answer from evidence", status: "PENDING", kind: "DIRECT_RESPONSE", dependencies: ["read"] }
      ] };
      const outcome = await runtime.taskExecutor.execute({ task, plan, economicState: "survival" });
      expect(outcome.status).toBe("FAILED");
      expect(outcome.execution.failure).toMatchObject({ failureClass: "TIMEOUT", phase: "DIRECT_RESPONSE" });
      expect(outcome.result).toBeUndefined();
      expect(outcome.execution.attempts?.some((attempt) => attempt.model === "observed-evidence-format")).toBe(false);
    } finally { await runtime.browser.closeAll(); runtime.sqlite.close(); }
  });
  it("does not mask invalid browser response output with deterministic formatting", async () => {
    const runtime = setup(true);
    try {
      const { task } = await runtime.intelligence.inspect("Abra https://nodejs.org e leia a versão LTS");
      const open = (await runtime.getAvailableTools()).find((tool) => tool.capabilities.includes("browser:open"))!;
      vi.spyOn(runtime.browser, "startSession").mockResolvedValue("fixture-session");
      vi.spyOn(runtime.browser, "execute").mockResolvedValue({ status: "ok", action: { type: "open", url: "https://nodejs.org/" }, observation: { url: "https://nodejs.org/", title: "Node.js fixture", visibleText: "Node.js v24.0.0 LTS", interactiveElements: [] } } as never);
      vi.spyOn(runtime.modelRouter, "completeForPlanningCandidate").mockResolvedValue({ ...response, content: '<tool_call>{"tool":"web.run"}</tool_call>' });
      const plan: Plan = { id: "p", taskId: task.id, objective: task.input, revision: 1, createdAt: new Date().toISOString(), steps: [
        { id: "read", description: "Read official page", status: "PENDING", action: { id: "open", tool: open.id, arguments: { url: "https://nodejs.org/" } } },
        { id: "respond", description: "Answer from evidence", status: "PENDING", kind: "DIRECT_RESPONSE", dependencies: ["read"] }
      ] };
      const outcome = await runtime.taskExecutor.execute({ task, plan, economicState: "survival" });
      expect(outcome.status).toBe("FAILED");
      expect(outcome.execution.failure).toMatchObject({ failureClass: "INVALID_OUTPUT", phase: "DIRECT_RESPONSE" });
      expect(outcome.execution.attempts?.some((attempt) => attempt.model === "observed-evidence-format")).toBe(false);
    } finally { await runtime.browser.closeAll(); runtime.sqlite.close(); }
  });
  it.each(["pseudo", "provider"])("records %s unsolicited tools without executing them", async (kind) => {
    const runtime = setup();
    try {
      const { task } = await runtime.intelligence.inspect("Responda apenas OK.");
      const complete = vi.spyOn(runtime.modelRouter, "completeForPlanningCandidate");
      if (kind === "pseudo") complete.mockResolvedValue({ ...response, content: '<tool_call>{"tool":"web.run"}</tool_call>' });
      else complete.mockRejectedValue(httpFailure(400, JSON.stringify({ error: { code: "tool_use_failed", message: "Tool choice is none, but model called a tool", failed_generation: "web.run" } })));
      const tool = vi.spyOn(runtime.toolExecutor, "execute");
      const plan = await runtime.planner.createPlan({ task, objective: task.input, availableTools: await runtime.getAvailableTools(), memoryContext: [], budget: DEFAULT_TASK_BUDGET, economicState: "survival" });
      const outcome = await runtime.taskExecutor.execute({ task, plan, economicState: "survival" });
      expect(outcome.status).toBe("FAILED");
      expect(outcome.execution.failure?.failureClass).toBe(kind === "pseudo" ? "INVALID_OUTPUT" : "BAD_REQUEST");
      expect(outcome.execution.attempts?.[0]).toMatchObject({ phase: "DIRECT_RESPONSE", provider: "fixture", model: "remote", status: "FAILED" });
      if (kind === "provider") expect(outcome.execution.attempts?.[0]).toMatchObject({ httpStatus: 400, responseBody: expect.stringContaining("tool_use_failed"), error: expect.stringContaining("not executed") });
      expect(tool).not.toHaveBeenCalled();
    } finally { runtime.sqlite.close(); }
  });
  it("rejects native tool calls even in a successful HTTP response", async () => {
    vi.stubEnv("GROQ_API_KEY", "fixture-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "OK", tool_calls: [{ function: { name: "web.run" } }] } }] }))));
    const runtime = createRuntime(loadConfig({ BEYONDER_DB_PATH: ":memory:", BEYONDER_MODEL_PROVIDER: "auto" }));
    try {
      await expect(runtime.modelRouter.completeForPlanningCandidate([{ role: "user", content: "OK" }], { ...remote(), provider: "groq" })).rejects.toMatchObject({ failureClass: "INVALID_OUTPUT" });
    } finally { runtime.sqlite.close(); }
  });
});

describe("survival: one remote attempt plus optional zero-quota local fallback", () => {
  const run = (complete: ReturnType<typeof vi.fn>, candidates = [remote(), remote("second-remote"), local]) => runCandidates({ taskId: "t", phase: "DIRECT_RESPONSE", candidates, messages: [], maxCandidates: getEconomicRoutingPolicy("survival").maxAttempts, ...inferenceAttemptPolicy("survival"), maxMonetaryCostUsd: 0, maxShadowCostUsd: 0.01, maxDurationMs: 1000, complete, validate: (r) => r.content });
  it("preserves the economic policy while using eligible local fallback on operational failure", async () => {
    expect(getEconomicRoutingPolicy("survival")).toMatchObject({ maxAttempts: 1, maxEscalations: 0 });
    const complete = vi.fn().mockRejectedValueOnce(httpFailure(400, "tool_use_failed")).mockResolvedValueOnce({ ...response, provider: "ollama", model: "local" });
    const result = await run(complete);
    expect(result.attempts.map((a) => a.model)).toEqual(["remote", "local"]);
    expect(result.monetaryCostUsd).toBe(0);
  });
  it("does not call local after remote success", async () => {
    const complete = vi.fn().mockResolvedValue(response);
    await run(complete);
    expect(complete).toHaveBeenCalledOnce();
  });
  it("never consumes another remote tier when local is absent", async () => {
    const complete = vi.fn().mockRejectedValue(httpFailure(500, "offline"));
    await expect(run(complete, [remote(), remote("other")])).rejects.toMatchObject({ failureClass: "PROVIDER_UNAVAILABLE" });
    expect(complete).toHaveBeenCalledOnce();
  });
  it.each([{ monetaryCostUsd: 1 }, { externalQuotaConsumption: true }, { externalQuotaConsumption: undefined }, { costClass: "UNKNOWN_COST" }, { provider: "remote-proxy" }])("rejects local fallback without zero-cost provenance: %j", async (overrides) => {
    const complete = vi.fn().mockRejectedValue(httpFailure(500, "offline"));
    await expect(run(complete, [remote(), { ...local, ...overrides } as ModelCandidate])).rejects.toMatchObject({ failureClass: "PROVIDER_UNAVAILABLE" });
    expect(complete).toHaveBeenCalledOnce();
  });
  it("does not reinterpret invalid output as operational failure", async () => {
    const complete = vi.fn().mockRejectedValue(new InferenceError("invalid", "INVALID_OUTPUT"));
    await expect(run(complete)).rejects.toMatchObject({ failureClass: "INVALID_OUTPUT" });
    expect(complete).toHaveBeenCalledOnce();
  });
  it("allows local alone when remote is unavailable", async () => {
    const complete = vi.fn().mockResolvedValue({ ...response, provider: "ollama" });
    await run(complete, [local]);
    expect(complete.mock.calls[0]?.[1]).toEqual(local);
  });
  it("keeps local resource accounting separate and enforces the remaining budget", async () => {
    const complete = vi.fn().mockRejectedValueOnce(httpFailure(500, "offline")).mockResolvedValue(response);
    await expect(run(complete, [remote(), { ...local, shadowCostUsd: 0.02 }])).rejects.toMatchObject({ failureClass: "BUDGET_EXHAUSTED" });
    expect(complete).toHaveBeenCalledOnce();
  });
});
