import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AutopilotStateStore } from "@beyonder/compute";
import type { IntelligenceTask } from "../intelligence/contracts.js";
import { AdaptiveModelSelector } from "./adaptive-selector.js";
import { runCandidates, InferenceError, type InferenceAttempt } from "./inference.js";
import { fixtureZeroCost } from "./testing/zero-cost-fixture.js";
import type { ModelCapabilitySource } from "./capability-source.js";

const models = { groq: "qwen/qwen3-coder", openrouter: "deepseek/deepseek-r1:free" } as const;
const task = (type: IntelligenceTask["type"]): IntelligenceTask => ({
  id: `objective-${type}`, input: type === "coding" ? "Implement a parser" : "Explain a logical proof",
  type, complexity: 0.45, risk: 0.05, estimatedTokens: 300,
  requirements: type === "coding" ? { coding: true } : { reasoning: true }
});

async function selector(staleGroqState = false) {
  const path = join(await mkdtemp(join(tmpdir(), "beyonder-product-flow-")), "state.json");
  const stamp = new Date().toISOString();
  await new AutopilotStateStore(path).write({ version: 1, updatedAt: stamp, providers: Object.fromEntries(
    Object.entries(models).map(([providerId, model]) => [providerId, {
      providerId, state: providerId === "groq" && staleGroqState ? "FAILED" : "READY", classification: "AUTO_WITH_HUMAN_GATE", attempts: 1, lastUpdatedAt: stamp,
      validation: { status: "validated", models: [model], modelMetadata: [{ id: model, capabilities: ["CHAT", "REASONING", "CODING"], costClass: "FREE_CONFIRMED", structuredOutput: "unknown" }] }
    }])
  ) });
  const capabilitySource: ModelCapabilitySource = {
    async getCapability({ provider, taskType }) {
      const preferred = taskType === "coding" ? "groq" : "openrouter";
      return { score: provider === preferred ? 0.9 : 0.5, samples: 8, source: "BIB" };
    },
    async getCapabilityScore(input) { return (await this.getCapability(input))?.score ?? null; }
  };
  return new AdaptiveModelSelector(path, {
    capabilitySource,
    economicEvidence: async (provider, model) => fixtureZeroCost(provider, model),
    canAttempt: async ({ provider }) => provider in models
  });
}

describe("adaptive product flow", () => {
  it("discovers and ranks native free-plan candidates across Gemini, Groq and Cloudflare", async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'beyonder-native-pool-')), 'state.json');
    const stamp = new Date().toISOString();
    const nativeModels = { gemini: 'gemini-2.5-flash', groq: 'openai/gpt-oss-120b', 'cloudflare-workers-ai': '@cf/zai-org/glm-4.7-flash' } as const;
    await new AutopilotStateStore(path).write({ version: 1, updatedAt: stamp, providers: Object.fromEntries(Object.entries(nativeModels).map(([providerId, model]) => [providerId, {
      providerId, state: 'READY', classification: 'AUTO_WITH_HUMAN_GATE', attempts: 1, lastUpdatedAt: stamp,
      validation: { status: 'validated', models: [model], modelMetadata: [{ id: model, capabilities: ['CHAT', 'REASONING', 'CODING'], costClass: providerId === 'gemini' ? 'FREE_TIER_ELIGIBLE' : 'PAID' }] }
    }])) });
    const selector = new AdaptiveModelSelector(path, {
      providerAccountPlan: async provider => provider === 'groq' ? 'GROQ_FREE' : undefined,
      billingCapability: async provider => provider === 'gemini' || provider === 'cloudflare-workers-ai'
        ? { provider, credentialSha256: 'fixture-credential-fingerprint', capability: 'NO_BILLING_CAPABILITY', source: provider === 'gemini' ? 'GOOGLE_CLOUD_BILLING_API' : 'CLOUDFLARE_SUBSCRIPTIONS_API', checkedAt: new Date().toISOString(), reason: 'Provider billing API fixture.' }
        : undefined,
      capabilitySource: {
        async getCapability({ provider, taskType }) { return { score: provider === (taskType === 'coding' ? 'groq' : 'gemini') ? 0.95 : 0.55, samples: 8, source: 'BIB' as const }; },
        async getCapabilityScore(input) { return (await this.getCapability(input))?.score ?? null; }
      }
    });
    const coding = await selector.route(task('coding'), 'normal');
    const reasoning = await selector.route(task('reasoning'), 'normal');
    expect(coding.candidates.map(candidate => candidate.provider)).toEqual(expect.arrayContaining(Object.keys(nativeModels)));
    expect(coding.selected?.provider).toBe('groq');
    expect(reasoning.selected?.provider).toBe('gemini');
    expect(coding.candidates.every(candidate => candidate.monetaryCostUsd === 0)).toBe(true);
    expect(coding.candidates.filter(candidate => candidate.provider !== 'groq').every(candidate => candidate.economics?.source === 'PROVIDER_BILLING_API')).toBe(true);
    expect(coding.candidates.find(candidate => candidate.provider === 'groq')?.economics?.source).toBe('PROVIDER_FREE_PLAN');
  });
  it("keeps a validated free candidate discoverable after stale bootstrap failure", async () => {
    const route = await (await selector(true)).route(task("coding"), "normal");
    expect(route.candidates.some(candidate => candidate.provider === "groq")).toBe(true);
  });
  it("ranks different free providers for coding and reasoning", async () => {
    const router = await selector();
    const coding = await router.route(task("coding"), "normal");
    const reasoning = await router.route(task("reasoning"), "normal");
    expect(coding.candidates.map(candidate => candidate.provider)).toEqual(["groq", "openrouter"]);
    expect(reasoning.candidates.map(candidate => candidate.provider)).toEqual(["openrouter", "groq"]);
    expect(coding.candidates.every(candidate => candidate.monetaryCostUsd === 0)).toBe(true);
  });

  it("fails over to the next ranked free provider and records physical attempts at zero cost", async () => {
    const route = await (await selector()).route(task("coding"), "normal");
    const recorded: InferenceAttempt[] = [];
    const result = await runCandidates({
      taskId: "objective-coding", phase: "DIRECT_RESPONSE", candidates: route.candidates,
      messages: [{ role: "user", content: "Implement a parser" }],
      maxCandidates: 2, remoteAttemptBudget: 2, localFallbackBudget: 0,
      maxDurationMs: 10_000, maxMonetaryCostUsd: 0, maxShadowCostUsd: 0,
      complete: async (_messages, candidate) => {
        if (candidate.provider === "groq") throw new InferenceError("daily quota exhausted", "RATE_LIMITED", 429, undefined, undefined, "provider");
        return { provider: candidate.provider, model: candidate.model, content: "Parser implementation", estimatedCostUsd: 0,
          attribution: { requestedModel: candidate.model, reportedModel: "deepseek/deepseek-r1:free", upstreamProvider: "upstream" } };
      },
      validate: response => response.content,
      record: async attempt => { if (attempt.status !== "STARTED") recorded.push({ ...attempt }); }
    });
    expect(result.candidate.provider).toBe("openrouter");
    expect(recorded.map(attempt => [attempt.provider, attempt.status])).toEqual([["groq", "FAILED"], ["openrouter", "SUCCEEDED"]]);
    expect(recorded[0]?.failureClass).toBe('RATE_LIMITED');
    expect(recorded[1]?.attribution?.reportedModel).toBe("deepseek/deepseek-r1:free");
    expect(result.monetaryCostUsd).toBe(0);
    expect(result.shadowCostUsd).toBeGreaterThan(0);
  });

  it("refreshes expired zero-cost evidence before a physical attempt", async () => {
    const candidate = (await (await selector()).route(task("coding"), "normal")).candidates[0]!;
    candidate.economics = { ...candidate.economics!, expiresAt: new Date(0).toISOString() };
    let refreshed = 0;
    const result = await runCandidates({
      taskId: "expired-evidence", phase: "DIRECT_RESPONSE", candidates: [candidate], messages: [],
      remoteAttemptBudget: 1, localFallbackBudget: 0, maxDurationMs: 1000,
      maxMonetaryCostUsd: 0, maxShadowCostUsd: 0,
      refreshEconomics: async selected => { refreshed++; return fixtureZeroCost(selected.provider, selected.model); },
      complete: async () => ({ provider: candidate.provider, model: candidate.model, content: "OK", estimatedCostUsd: 0 }),
      validate: response => response.content
    });
    expect(refreshed).toBe(1);
    expect(result.attempts[0]?.status).toBe("SUCCEEDED");
    expect(result.monetaryCostUsd).toBe(0);
  });
});
