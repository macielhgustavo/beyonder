import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutopilotStateStore } from "@beyonder/compute";
import { createRuntime } from "../runtime.js";
import { loadConfig } from "../config/env.js";
import { httpFailure, parseRetryAfter, parseRateLimitReset, runCandidates, type InferenceAttempt } from "./inference.js";
import { ModelRouter } from "./model-router.js";
import { OperationalHealthStore, operationalCooldown } from "./operational-health.js";
import { AutopilotQuotaSource, parseReset } from "./quota.js";
import { inferenceAttemptPolicy } from "./router-config.js";
import type { ModelCandidate } from "./adaptive-types.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const candidate = (provider: string, model = "m"): ModelCandidate => ({ provider, model, monetaryCostUsd: 0, shadowCostUsd: 0.001, local: false } as ModelCandidate);
const attempt = (patch: Partial<InferenceAttempt> = {}): InferenceAttempt => ({ id: "a", taskId: "t", phase: "DIRECT_RESPONSE", attempt: 1, provider: "p", model: "m", status: "FAILED", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), latencyMs: 10, monetaryCostUsd: 0, shadowCostUsd: 0, failureClass: "RATE_LIMITED", ...patch });
const runtime = () => createRuntime(loadConfig({ BEYONDER_DB_PATH: ":memory:", BEYONDER_MODEL_PROVIDER: "none" }));

describe("H1 persistent scoped operational health", () => {
  it("excludes cooldowns in the actual adaptive route, not only in candidate execution", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "beyonder-route-")), "providers.json");
    await new AutopilotStateStore(path).write({ version: 1, updatedAt: new Date().toISOString(), providers: { groq: { providerId: "groq", state: "READY", classification: "AUTO_WITH_HUMAN_GATE", attempts: 1, lastUpdatedAt: new Date().toISOString(), validation: { status: "validated", models: ["llama-3.3-70b-versatile"] } } } });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("local discovery offline")));
    const r = createRuntime(loadConfig({ BEYONDER_DB_PATH: ":memory:", BEYONDER_MODEL_PROVIDER: "auto", BEYONDER_PROVIDER_STATE_PATH: path }));
    try {
      const { task } = await r.intelligence.inspect("Reply OK");
      expect((await r.modelRouter.route(task, "normal")).candidates.some((c) => c.provider === "groq")).toBe(true);
      await r.modelRouter.recordAttempt(attempt({ provider: "groq", failureClass: "AUTH_REQUIRED" }));
      expect((await r.modelRouter.route(task, "normal")).candidates.some((c) => c.provider === "groq")).toBe(false);
    } finally { r.sqlite.close(); }
  });
  it("only validated credential repair clears auth exclusion, never a quota cooldown", async () => {
    const r = runtime();
    try {
      await r.modelRouter.recordAttempt(attempt({ failureClass: "AUTH_REQUIRED" }));
      await r.modelRouter.operationalHealth.credentialValidated("p");
      expect(await r.modelRouter.canAttempt(candidate("p"))).toBe(true);
      await r.modelRouter.recordAttempt(attempt({ id: "quota", responseBody: "daily quota" }));
      await r.modelRouter.operationalHealth.credentialValidated("p");
      expect(await r.modelRouter.canAttempt(candidate("p"))).toBe(false);
    } finally { r.sqlite.close(); }
  });
  it.each(["PAID_MODEL_AUTH_REQUIRED", "paid_model_auth_required", "upstream_provider_shared_pool"]) ("scopes a model-specific authentication refusal (%s) to that model", async body => {
    const r = runtime();
    try {
      const error = httpFailure(401, body);
      await r.modelRouter.recordAttempt(attempt({ failureClass: error.failureClass, failureScope: error.failureScope, responseBody: error.responseBody }));
      expect(await r.modelRouter.canAttempt(candidate("p"))).toBe(false);
      expect(await r.modelRouter.canAttempt(candidate("p", "sibling"))).toBe(true);
    } finally { r.sqlite.close(); }
  });
  it.each(["newer", "older", "missing", "future", "quota"] as const)("recovers keyless auth only with newer real inference, preserving quota (%s)", async condition => {
    const r = runtime();
    const failedAt = Date.now() - 10_000;
    const proof = condition === "missing" ? null : { model: "different-model", observedAt: new Date(condition === "older" ? failedAt - 1 : condition === "future" ? Date.now() + 60_000 : failedAt + 1).toISOString() };
    const router = new ModelRouter(loadConfig({ BEYONDER_MODEL_PROVIDER: "auto" }).model, { state: r.state, capabilitySource: { getCapability: async () => null, getCapabilityScore: async () => null, getLastSuccessfulRequest: async () => proof } });
    try {
      await router.recordAttempt(attempt({ provider: "kilo-gateway", failureClass: condition === "quota" ? "RATE_LIMITED" : "AUTH_REQUIRED", responseBody: condition === "quota" ? "daily quota" : "invalid key", completedAt: new Date(failedAt).toISOString() }));
      expect(await router.canAttempt(candidate("kilo-gateway"))).toBe(condition === "newer");
      expect((await router.operationalHealth.get("kilo-gateway")).failures).toBe(1);
    } finally { r.sqlite.close(); }
  });
  it.each(["upstream_provider_account", "upstream_provider_shared_pool"])("isolates upstream rate limits from gateway quota (%s)", async limitSource => {
    const r = runtime();
    const responseBody = JSON.stringify({ error: { metadata: { limit_source: limitSource, remedy_hint: "Check your provider account", raw: "server overload" } } });
    try {
      const error = httpFailure(429, responseBody);
      const failed = attempt({ failureClass: error.failureClass, failureScope: error.failureScope, responseBody });
      await r.modelRouter.recordAttempt(failed);
      expect(operationalCooldown(failed)).toMatchObject({ scope: "model", reason: "RATE_LIMITED" });
      expect(await r.modelRouter.canAttempt(candidate("p"))).toBe(false);
      expect(await r.modelRouter.canAttempt(candidate("p", "sibling"))).toBe(true);
    } finally { r.sqlite.close(); }
  });
  it.each(["rpd", "rpm", "tpm"])("retains a shared upstream model's %s limit without disabling siblings", async dimension => {
    const r = runtime();
    const responseBody = JSON.stringify({ error: { message: `Rate limit exceeded: limit_${dimension}/vendor/model-20260730/account-id. Daily limit reached for vendor/model:free.`, metadata: { limit_source: "openrouter_shared_capacity" } } });
    const until = new Date(Date.now() + 86_400_000).toISOString();
    const failed = attempt({ responseBody });
    try {
      expect(httpFailure(429, responseBody).failureScope).toBe("model");
      await r.state.set("task-attempts:t", [failed]);
      await r.state.set("provider-health:p", { samples: 1, failures: 1, latencyMs: 10, lastFailureAt: failed.completedAt, cooldown: { scope: "provider", reason: "QUOTA_EXHAUSTED", until } });
      expect(await r.modelRouter.canAttempt(candidate("p", "sibling"))).toBe(true);
      expect(await r.modelRouter.canAttempt(candidate("p"))).toBe(false);
      expect((await r.modelRouter.operationalHealth.get("p", "m")).cooldown?.until).toBe(until);
    } finally { r.sqlite.close(); }
  });
  it("does not reinterpret an unscoped shared-capacity daily gateway cap", () => {
    const responseBody = JSON.stringify({ error: { message: "Daily account limit exceeded", metadata: { limit_source: "openrouter_shared_capacity" } } });
    expect(httpFailure(429, responseBody).failureScope).toBeUndefined();
    expect(operationalCooldown(attempt({ responseBody }))).toMatchObject({ scope: "provider", reason: "QUOTA_EXHAUSTED" });
  });
  it.each(["upstream_provider_account", "upstream_provider_shared_pool", "gateway_daily_quota"])("reclassifies retained legacy health only with original upstream evidence (%s)", async limitSource => {
    const r = runtime();
    const failed = attempt({ responseBody: JSON.stringify({ error: { metadata: { limit_source: limitSource } } }) });
    const until = new Date(Date.now() + 86_400_000).toISOString();
    try {
      await r.state.set("task-attempts:t", [failed]);
      await r.state.set("provider-health:p", { samples: 1, failures: 1, latencyMs: 10, lastFailureAt: failed.completedAt, cooldown: { scope: "provider", reason: "QUOTA_EXHAUSTED", until } });
      expect(await r.modelRouter.canAttempt(candidate("p", "sibling"))).toBe(limitSource !== "gateway_daily_quota");
      expect(await r.modelRouter.canAttempt(candidate("p"))).toBe(false);
      expect((await r.modelRouter.operationalHealth.get("p")).failures).toBe(1);
      if (limitSource !== "gateway_daily_quota") expect((await r.modelRouter.operationalHealth.get("p", "m")).cooldown?.until).toBe(until);
    } finally { r.sqlite.close(); }
  });
  it.each([
    ["AUTH_REQUIRED", "", "provider"], ["FORBIDDEN", "", "model"], ["MODEL_UNAVAILABLE", "", "model"],
    ["RATE_LIMITED", "requests per day exceeded", "provider"], ["RATE_LIMITED", "account credits exhausted", "provider"],
    ["RATE_LIMITED", "tokens per minute", "model"], ["TIMEOUT", "", "model"], ["NETWORK_ERROR", "", "model"]
  ])("classifies %s / %s to %s scope", (failureClass, responseBody, scope) => {
    expect(operationalCooldown(attempt({ failureClass: failureClass as InferenceAttempt["failureClass"], responseBody }))).toMatchObject({ scope });
  });
  it.each(["BAD_REQUEST", "INVALID_OUTPUT", "INVALID_ACTION"] as const)("does not globally cool down %s", (failureClass) => {
    expect(operationalCooldown(attempt({ failureClass }))).toBeUndefined();
  });
  it("honors numeric and HTTP-date Retry-After without persisting arbitrary headers", () => {
    const now = Date.parse("2026-10-04T12:00:00Z");
    expect(parseRetryAfter("60", now)).toBe("2026-10-04T12:01:00.000Z");
    expect(parseRetryAfter("Sun, 04 Oct 2026 12:02:00 GMT", now)).toBe("2026-10-04T12:02:00.000Z");
    for (const value of ["-1", "invalid", "", "0.0.1"]) expect(parseRetryAfter(value, now)).toBeUndefined();
    const error = httpFailure(429, "limited", new Headers({ "retry-after": "60", "set-cookie": "SECRET" }));
    expect(error.retryAfterAt).toBeDefined();
    expect(JSON.stringify(error)).not.toContain("SECRET");
    expect(operationalCooldown(attempt({ retryAfterAt: "2026-10-04T12:01:00Z" }), now)?.until).toBe("2026-10-04T12:01:00.000Z");
  });
  it.each(["1791331200000", "1791331200", "2026-10-07T00:00:00Z"])("honors an observed upstream reset instead of guessing a rolling 24 hours (%s)", reset => {
    const now = Date.parse("2026-10-06T04:20:42Z");
    const responseBody = JSON.stringify({ error: { message: "daily limit", metadata: { headers: { "X-RateLimit-Reset": reset } } } });
    expect(parseRateLimitReset(responseBody, undefined, now)).toBe("2026-10-07T00:00:00.000Z");
    expect(operationalCooldown(attempt({ responseBody, failureScope: "model" }), now)).toMatchObject({ until: "2026-10-07T00:00:00.000Z", deadlineSource: "provider-reset", scope: "model" });
  });
  it("keeps the later restriction when Retry-After and an upstream reset disagree", () => {
    const now = Date.parse("2026-10-06T04:20:42Z");
    const responseBody = JSON.stringify({ error: { message: "daily limit", metadata: { headers: { "x-ratelimit-reset": "1791331200000" } } } });
    expect(operationalCooldown(attempt({ responseBody, retryAfterAt: "2026-10-07T05:00:00Z" }), now)?.until).toBe("2026-10-07T05:00:00.000Z");
    for (const reset of ["nonsense", "-1", {}, null]) {
      const malformed = JSON.stringify({ error: { metadata: { headers: { "X-RateLimit-Reset": reset } } } });
      expect(parseRateLimitReset(malformed, undefined, now)).toBeUndefined();
      expect(operationalCooldown(attempt({ responseBody: "daily limit " + malformed }), now)).toMatchObject({ until: "2026-10-07T04:20:42.000Z", deadlineSource: "fallback" });
    }
  });
  it.each(["past", "future", "missing", "different-model"] as const)("repairs a persisted guessed deadline only from its matching original response (%s)", condition => {
    const now = Date.now(), resetAt = now + (condition === "future" ? 3_600_000 : -3_600_000);
    return (async () => {
      const r = runtime();
      const failedAt = now - 2 * 3_600_000;
      const responseBody = JSON.stringify({ error: { message: "daily limit", metadata: { headers: condition === "missing" ? {} : { "X-RateLimit-Reset": String(resetAt) } } } });
      const original = attempt({ model: condition === "different-model" ? "sibling" : "m", responseBody, failureScope: "model", completedAt: new Date(failedAt).toISOString() });
      try {
        await r.modelRouter.recordAttempt(original);
        await r.state.set("model-health:p:m", { samples: 1, failures: 1, latencyMs: 10, lastFailureAt: original.completedAt, cooldown: { reason: "QUOTA_EXHAUSTED", scope: "model", until: new Date(failedAt + 86_400_000).toISOString() } });
        expect(await r.modelRouter.canAttempt(candidate("p"))).toBe(condition === "past");
        expect((await r.modelRouter.attemptsFor("t"))[0]).toEqual(original);
        expect((await r.modelRouter.operationalHealth.get("p", "m")).failures).toBe(1);
      } finally { r.sqlite.close(); }
    })();
  });
  it("persists auth exclusion across restart and releases it only after expiry", async () => {
    const dbPath = join(await mkdtemp(join(tmpdir(), "beyonder-rc-")), "runtime.sqlite");
    const config = loadConfig({ BEYONDER_DB_PATH: dbPath, BEYONDER_MODEL_PROVIDER: "none" });
    const first = createRuntime(config);
    await first.modelRouter.recordAttempt(attempt({ failureClass: "AUTH_REQUIRED" }));
    first.sqlite.close();
    const second = createRuntime(config);
    try {
      expect(await second.modelRouter.canAttempt(candidate("p", "sibling"))).toBe(false);
      expect(await second.modelRouter.canAttempt(candidate("other"))).toBe(true);
      const future = new OperationalHealthStore(second.state, () => Date.now() + 3_600_001);
      expect(await future.blocked("p", "sibling")).toBeUndefined();
    } finally { second.sqlite.close(); }
  });
  it("isolates a retired model and counts terminal attempts exactly once", async () => {
    const r = runtime();
    try {
      const failed = attempt({ failureClass: "MODEL_UNAVAILABLE", httpStatus: 404 });
      await r.modelRouter.recordAttempt(failed);
      await r.modelRouter.recordAttempt(failed);
      await r.modelRouter.recordAttempt({ ...failed, status: "STARTED" });
      expect(await r.modelRouter.canAttempt(candidate("p"))).toBe(false);
      expect(await r.modelRouter.canAttempt(candidate("p", "other"))).toBe(true);
      expect(await r.modelRouter.operationalHealth.get("p", "m")).toMatchObject({ samples: 1, failures: 1, latencyMs: 10 });
      expect((await r.modelRouter.attemptsFor("t"))[0]?.status).toBe("FAILED");
    } finally { r.sqlite.close(); }
  });
  it("uses bounded recent operational samples without contaminating quality memory", async () => {
    const r = runtime();
    try {
      await r.modelRouter.recordAttempt(attempt({ failureClass: "INVALID_OUTPUT" }));
      expect(await r.modelRouter.operationalHealth.get("p", "m")).toMatchObject({ samples: 1, failures: 0 });
      expect(await r.modelRouter.canAttempt(candidate("p"))).toBe(true);
      expect((await r.performance.get("p", "m", "chat")).samples).toBe(0);
    } finally { r.sqlite.close(); }
  });
  it("skips a failed provider's sibling in the same cascade without spending an attempt", async () => {
    const r = runtime();
    const complete = vi.fn(async (_messages, c: ModelCandidate) => {
      if (c.provider === "p") throw httpFailure(401, "invalid key");
      return { provider: c.provider, model: c.model, estimatedCostUsd: 0, content: "OK" };
    });
    try {
      const result = await runCandidates({ taskId: "t", phase: "DIRECT_RESPONSE", candidates: [candidate("p", "a"), candidate("p", "b"), candidate("keyless")], messages: [], maxCandidates: 2, maxMonetaryCostUsd: 0, maxShadowCostUsd: 0.01, maxDurationMs: 1000, complete, validate: (r) => r.content, record: r.modelRouter.recordAttempt.bind(r.modelRouter), canAttempt: r.modelRouter.canAttempt.bind(r.modelRouter) });
      expect(result.attempts.map((a) => a.provider)).toEqual(["p", "keyless"]);
      expect(complete).toHaveBeenCalledTimes(2);
    } finally { r.sqlite.close(); }
  });
  it("does not unlock another remote in survival after a provider failure", async () => {
    const r = runtime();
    const complete = vi.fn().mockRejectedValue(httpFailure(401, "invalid key"));
    try {
      await expect(runCandidates({ taskId: "t", phase: "DIRECT_RESPONSE", candidates: [candidate("p"), candidate("overflow")], messages: [], ...inferenceAttemptPolicy("survival"), maxCandidates: 1, maxMonetaryCostUsd: 0, maxShadowCostUsd: 0.01, maxDurationMs: 1000, complete, validate: (r) => r.content, record: r.modelRouter.recordAttempt.bind(r.modelRouter), canAttempt: r.modelRouter.canAttempt.bind(r.modelRouter) })).rejects.toMatchObject({ failureClass: "AUTH_REQUIRED" });
      expect(complete).toHaveBeenCalledOnce();
    } finally { r.sqlite.close(); }
  });
  it("preserves the reserved local slot with a long remote pool and health checks", async () => {
    const local = { ...candidate("ollama"), local: true, externalQuotaConsumption: false, costClass: "FREE_CONFIRMED" as const, shadowCostUsd: 0 };
    const complete = vi.fn(async (_messages, c: ModelCandidate) => {
      if (!c.local) throw httpFailure(500, "offline");
      return { provider: c.provider, model: c.model, estimatedCostUsd: 0, content: "OK" };
    });
    const result = await runCandidates({ taskId: "t", phase: "DIRECT_RESPONSE", candidates: [candidate("a"), candidate("b"), candidate("c"), local], messages: [], maxCandidates: 3, maxMonetaryCostUsd: 0, maxShadowCostUsd: 0.01, maxDurationMs: 1000, complete, validate: (r) => r.content, canAttempt: async () => true });
    expect(result.attempts.map((a) => a.provider)).toEqual(["a", "b", "ollama"]);
  });
  it("accounts every physical request inside one logical inference operation", async () => {
    const local = { ...candidate("ollama", "local"), local: true, externalQuotaConsumption: false, costClass: "FREE_CONFIRMED" as const, shadowCostUsd: 0 };
    const complete = vi.fn()
      .mockRejectedValueOnce(httpFailure(429, "limited"))
      .mockResolvedValueOnce({ provider: "ollama", model: "local", estimatedCostUsd: 0, content: "OK" });
    const records: InferenceAttempt[] = [];
    const result = await runCandidates({ taskId: "logical-task", phase: "DIRECT_RESPONSE", candidates: [candidate("groq"), local], messages: [], ...inferenceAttemptPolicy("survival"), maxCandidates: 1, maxMonetaryCostUsd: 0, maxShadowCostUsd: 0.01, maxDurationMs: 1000, complete, validate: (r) => r.content, record: async (entry) => { records.push({ ...entry }); } });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.attempts.map(({ attempt, provider, status }) => ({ attempt, provider, status }))).toEqual([
      { attempt: 1, provider: "groq", status: "FAILED" },
      { attempt: 2, provider: "ollama", status: "SUCCEEDED" }
    ]);
    expect(records.filter((entry) => entry.status !== "STARTED")).toHaveLength(2);
  });
});

describe("Q1 quota snapshots", () => {
  it("parses reset seconds before date heuristics and anchors durations to observation", () => {
    const now = Date.parse("2026-10-04T12:00:00Z");
    expect(parseReset("60", now)).toBe("2026-10-04T12:01:00.000Z");
    expect(parseReset("1m30s", now)).toBe("2026-10-04T12:01:30.000Z");
    expect(parseReset("-10", now)).toBe("unknown");
  });
  it.each([true, false])("does not claim stale remaining quota (fresh=%s)", async (fresh) => {
    const path = join(await mkdtemp(join(tmpdir(), "beyonder-quota-")), "providers.json");
    await new AutopilotStateStore(path).write({ version: 1, updatedAt: new Date().toISOString(), providers: { groq: { providerId: "groq", state: "READY", classification: "AUTO_WITH_HUMAN_GATE", attempts: 1, lastUpdatedAt: new Date(Date.now() - (fresh ? 0 : 600_000)).toISOString(), validation: { status: "validated", rateLimitHeaders: { "x-ratelimit-remaining-requests": "42", "x-ratelimit-reset-requests": "60" } } } } });
    expect((await new AutopilotQuotaSource(path).get("groq")).requestQuotaRemaining).toBe(fresh ? 42 : "unknown");
  });
});

describe("L1 legacy path truth", () => {
  it("uses the same no-pseudo-tool boundary in legacy inference", async () => {
    const r = runtime();
    vi.spyOn(r.modelRouter, "route").mockImplementation(async (task, economicState) => ({ task, economicState, selected: candidate("p"), candidates: [candidate("p")], explored: false, reason: "fixture" }));
    vi.spyOn(r.modelRouter, "completeForPlanningCandidate").mockResolvedValue({ provider: "p", model: "m", estimatedCostUsd: 0, content: '<tool_call>{"tool":"web.run"}</tool_call>' });
    try {
      const { task } = await r.intelligence.inspect("Reply OK");
      const result = await r.adaptiveExecution.execute({ task, economicState: "survival", messages: [] });
      expect(result.exhausted).toBe(true);
      expect(result.attempts[0]?.failureClass).toBe("INVALID_OUTPUT");
      expect(result.response).toBeUndefined();
    } finally { r.sqlite.close(); }
  });
  it("calls the real adapter instead of reporting synthetic selection as a response", async () => {
    vi.stubEnv("GROQ_API_KEY", "fixture-key");
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "Actual fixture response" } }] })));
    vi.stubGlobal("fetch", fetch);
    const r = createRuntime(loadConfig({ BEYONDER_DB_PATH: ":memory:", BEYONDER_MODEL_PROVIDER: "auto" }));
    try {
      expect((await r.modelRouter.completeForCandidate([], candidate("groq"))).content).toBe("Actual fixture response");
      expect(fetch).toHaveBeenCalledOnce();
      await expect(r.modelRouter.complete([])).rejects.toMatchObject({ failureClass: "INVALID_ACTION" });
    } finally { r.sqlite.close(); }
  });
  it.each(["Abra https://nodejs.org e leia a versão", "Use a calculadora para somar 2 e 2"])("cannot complete required tools via objective recording: %s", async (objective) => {
    const r = createRuntime(loadConfig({ BEYONDER_DB_PATH: ":memory:", BEYONDER_MODEL_PROVIDER: "none" }), { fixture: true });
    try {
      await r.agent.initialize();
      expect((await r.agent.step(objective)).status).toBe("failed");
      expect((await r.memoryStore.all()).filter((m) => m.kind === "economic").every((m) => m.metadata.success === false)).toBe(true);
    } finally { r.sqlite.close(); }
  });
  it("does not turn failed inference into success through the fixture objective tool", async () => {
    const r = createRuntime(loadConfig({ BEYONDER_DB_PATH: ":memory:", BEYONDER_MODEL_PROVIDER: "auto" }), { fixture: true });
    vi.spyOn(r.modelRouter, "route").mockImplementation(async (task, economicState) => ({ task, economicState, selected: candidate("p"), candidates: [candidate("p")], explored: false, reason: "fixture" }));
    vi.spyOn(r.modelRouter, "completeForPlanningCandidate").mockRejectedValue(httpFailure(401, "invalid key"));
    try {
      await r.agent.initialize();
      expect((await r.agent.step("Summarize readiness without side effects")).status).toBe("failed");
      const memory = (await r.memoryStore.all()).find((m) => m.kind === "economic");
      expect(memory?.metadata).toMatchObject({ success: false, failureClass: "AUTH_REQUIRED" });
      expect((await r.performance.get("p", "m", "compression")).samples).toBe(0);
    } finally { r.sqlite.close(); }
  });
});
