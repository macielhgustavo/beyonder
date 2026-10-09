import { fixtureZeroCost } from './testing/zero-cost-fixture.js';
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AutopilotStateStore } from "@beyonder/compute";
import { AdaptiveModelSelector } from "./adaptive-selector.js";
import type { ModelCapabilityEvidence, ModelCapabilityRequest, ModelCapabilitySource } from "./capability-source.js";
import type { ModelCandidate } from "./adaptive-types.js";
import { ModelRouter } from "./model-router.js";
import { loadConfig } from "../config/env.js";
import type { IntelligenceTask } from "../intelligence/contracts.js";
import { analyzeGoalContract } from "../intelligence/goal-contract.js";

const disabled = "reasoning-disabled:max-output-2400";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function statePath() {
  const path = join(await mkdtemp(join(tmpdir(), "beyonder-profile-")), "providers.json");
  await new AutopilotStateStore(path).write({ version: 1, updatedAt: new Date().toISOString(), providers: {
    "kilo-gateway": { providerId: "kilo-gateway", state: "READY", classification: "KEYLESS", attempts: 1, lastUpdatedAt: new Date().toISOString(), validation: { status: "validated", models: ["profile-model"], modelMetadata: [{ id: "profile-model", role: "instruct", capabilities: ["CHAT", "REASONING"], costClass: "FREE_CONFIRMED", reasoningControl: true, contextWindow: 32000, toolCalling: "yes", structuredOutput: "prompted" }] } }
  } });
  return path;
}
class Profiles implements ModelCapabilitySource {
  constructor(private score: number, private listed = [disabled], private lowScore = 0.5) {}
  async listInferenceProfiles() { return this.listed; }
  async getCapability(input: ModelCapabilityRequest): Promise<ModelCapabilityEvidence> {
    const score = input.inferenceProfile === disabled ? this.score : this.lowScore;
    return { score, samples: 6, source: "BIB", inferenceProfile: input.inferenceProfile,
      dimensions: Object.fromEntries(["reasoning", "research", "synthesis", "verification", "freshnessEvidence"].map(d => [d, { score, samples: 2, updatedAt: new Date().toISOString() }])) };
  }
  async getCapabilityScore(input: ModelCapabilityRequest) { return (await this.getCapability(input)).score; }
}
function researchTask(): IntelligenceTask {
  const input = "Compare duas fontes atuais sobre sistemas de bancos de dados.";
  return { id: "profile-task", input, type: "research", complexity: 0.3, risk: 0.05, estimatedTokens: 300, requirements: { reasoning: true }, goalContract: analyzeGoalContract(input, "research") };
}
describe("observed inference profiles", () => {
  it.each([0.99, 0.2])("requires the unchanged high floor for an observed mode (score=%s)", async score => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("local unavailable")));
    const selector = new AdaptiveModelSelector(await statePath(), { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model), capabilitySource: new Profiles(score) });
    const route = await selector.route(researchTask(), "normal");
    expect(route.qualityFloor?.level).toBe("HIGH");
    const models = route.candidates.filter(c => c.provider === "kilo-gateway");
    expect(models).toHaveLength(1);
    expect(models[0]?.capabilityFit?.passes).toBe(score > 0.9);
  });
  it("counts two qualified modes as one physical candidate", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("local unavailable")));
    const selector = new AdaptiveModelSelector(await statePath(), { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model), capabilitySource: new Profiles(0.99, [disabled], 0.99) });
    const route = await selector.route(researchTask(), "normal");
    expect(route.consideredCandidates?.filter(c => c.provider === "kilo-gateway" && c.eligible)).toHaveLength(2);
    expect(route.candidates.filter(c => c.provider === "kilo-gateway")).toHaveLength(1);
  });
  it("ignores unmeasured or unsupported mode names", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("local unavailable")));
    const selector = new AdaptiveModelSelector(await statePath(), { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model), capabilitySource: new Profiles(0.99, ["unbounded-mode", "reasoning-disabled:max-output-999999"]) });
    const route = await selector.route(researchTask(), "normal");
    expect(route.candidates.filter(c => c.provider === "kilo-gateway")).toHaveLength(1);
    expect(route.consideredCandidates?.filter(c => c.provider === "kilo-gateway")).toHaveLength(1);
  });
  it("does not transfer an optional profile's observations to an unmeasured task category", async () => {
    const measured = new Profiles(0.99, [disabled], 0.99);
    const source: ModelCapabilitySource = {
      listInferenceProfiles: measured.listInferenceProfiles.bind(measured),
      getCapability: async input => input.inferenceProfile === disabled ? null : measured.getCapability(input),
      getCapabilityScore: async input => input.inferenceProfile === disabled ? null : measured.getCapabilityScore(input)
    };
    const selector = new AdaptiveModelSelector(await statePath(), { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model), capabilitySource: source });
    const route = await selector.route(researchTask(), "normal");
    expect(route.candidates.find(candidate => candidate.provider === "kilo-gateway")?.inferenceProfile).toBe("reasoning-low:max-output-2400");
    expect(route.rejectedCandidates).toContainEqual(expect.objectContaining({ inferenceProfile: disabled, reasons: ["no observed task capability for the requested inference profile"] }));
  });
  it.each([true, false])("executes only the independently measured bounded profile (matched=%s)", async matched => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ model: "profile-model", choices: [{ finish_reason: "stop", message: { content: "Observed response" } }], usage: { cost: 0 } })));
    vi.stubGlobal("fetch", fetch);
    const router = new ModelRouter(loadConfig({ BEYONDER_MODEL_PROVIDER: "auto" }).model, { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model) });
    const candidate = { provider: "kilo-gateway", model: "profile-model", capabilities: ["reasoning-control"], inferenceProfile: disabled, benchmarkCapability: { inferenceProfile: matched ? disabled : "reasoning-low:max-output-2400" } } as ModelCandidate;
    await router.completeForCandidate([], candidate);
    const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    expect(body.max_tokens).toBe(2400);
    expect(body.reasoning).toEqual(matched ? { enabled: false } : { effort: "low" });
  });
});
