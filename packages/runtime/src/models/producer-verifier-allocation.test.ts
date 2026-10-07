import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AutopilotStateStore } from "@beyonder/compute";
import { AdaptiveModelSelector } from "./adaptive-selector.js";
import { objectivePhaseTask } from "./compute-policy.js";
import { resolveQualityFloor } from "./compute-policy.js";
import { analyzeGoalContract } from "../intelligence/goal-contract.js";
import type { IntelligenceTask } from "../intelligence/contracts.js";
import type { ModelCapabilityEvidence, ModelCapabilityRequest, ModelCapabilitySource } from "./capability-source.js";

class Capacity implements ModelCapabilitySource {
  constructor(private readonly judges: Record<string, number>, private readonly unsafe: string[] = []) {}
  async getVerificationSafetyEvidence(model: string) { return this.unsafe.includes(model) ? { falseApprovals: 1, lastFalseApprovalAt: "2026-10-07T00:00:00.000Z" } : null; }
  async getCapability(input: ModelCapabilityRequest): Promise<ModelCapabilityEvidence | null> {
    if (input.provider !== "kilo-gateway") return null;
    const producerScore = input.model === "best-judge" ? 1 : 0.94;
    const judgeScore = this.judges[input.model] ?? 0.2;
    const dimensions = Object.fromEntries(["reasoning", "coding", "synthesis", "structuredOutput", "verification"].map(dimension => [dimension, { score: dimension === "verification" ? judgeScore : producerScore, samples: 3, updatedAt: new Date().toISOString() }]));
    return { score: Math.min(producerScore, ...(input.dimensions?.includes("verification") ? [judgeScore] : [])), samples: 3, source: "BIB", dimensions };
  }
  async getCapabilityScore(input: ModelCapabilityRequest) { return (await this.getCapability(input))?.score ?? null; }
}
async function selector(models: string[], judges: Record<string, number>, unsafe: string[] = []) {
  const filename = join(await mkdtemp(join(tmpdir(), "beyonder-pair-")), "providers.json");
  await new AutopilotStateStore(filename).write({ version: 1, updatedAt: new Date().toISOString(), providers: {
    "kilo-gateway": { providerId: "kilo-gateway", state: "READY", classification: "KEYLESS", attempts: 1, lastUpdatedAt: new Date().toISOString(), validation: {
      status: "validated", models, modelMetadata: models.map(id => ({ id, role: "instruct", costClass: "FREE_CONFIRMED", capabilities: ["CHAT", "REASONING", "CODING"], contextWindow: 32000, toolCalling: "yes", structuredOutput: "native" }))
    } }
  } });
  return new AdaptiveModelSelector(filename, { capabilitySource: new Capacity(judges, unsafe) });
}
function task(): IntelligenceTask {
  const input = "Escreva uma função TypeScript que preserve a primeira ocorrência de cada chave string.";
  return { id: "joint-allocation", input, type: "coding", complexity: 0.2, risk: 0.05, estimatedTokens: 300, requirements: { coding: true }, goalContract: analyzeGoalContract(input, "coding") };
}
describe("joint producer and independent verifier allocation", () => {
  it("rejects a known unsafe judge even when its average score remains perfect", async () => {
    const router = await selector(["useful-producer", "best-judge"], { "best-judge": 1 }, ["best-judge"]);
    const route = await router.route(objectivePhaseTask(task(), "OBJECTIVE_VERIFICATION"), "normal");
    expect(route.candidates.some(candidate => candidate.model === "best-judge")).toBe(false);
    expect(route.rejectedCandidates).toContainEqual(expect.objectContaining({ model: "best-judge", reasons: [expect.stringContaining("adjudicated false approval")] }));
    const producer = await router.route(objectivePhaseTask(task(), "DIRECT_RESPONSE"), "normal");
    expect(producer.capacityStatus).toBe("NEEDS_CAPABILITY");
    expect(producer.reason).toContain("no independently qualified verifier");
  });
  it.each(["Qual é a versão estável atual de um programa?", "Responda somente JSON com dois campos."])("requires verification capability for every independent semantic review: %s", input => {
    const mission: IntelligenceTask = { ...task(), input, type: "chat", requirements: { directResponse: true }, goalContract: analyzeGoalContract(input, "chat") };
    const producer = resolveQualityFloor(objectivePhaseTask(mission, "DIRECT_RESPONSE"));
    const judge = resolveQualityFloor(objectivePhaseTask(mission, "OBJECTIVE_VERIFICATION"));
    expect(producer.dimensions.verification).toBeUndefined();
    expect(judge.dimensions.verification).toBeGreaterThanOrEqual(0.54);
    expect(judge.minimumOverall).toBe(producer.minimumOverall);
  });
  it("preserves the only adequate judge for a different eligible producer", async () => {
    const router = await selector(["useful-producer", "best-judge"], { "best-judge": 1 });
    const route = await router.route(objectivePhaseTask(task(), "DIRECT_RESPONSE"), "normal");
    expect(route.selected?.model).toBe("useful-producer");
    expect(route.selected?.capabilityFit?.passes).toBe(true);
    expect(route.qualityFloor?.minimumOverall).toBe(0.71);
    expect(route.rejectedCandidates).toContainEqual(expect.objectContaining({ model: "best-judge", reasons: ["no independently qualified verifier for this producer"] }));
    const verification = await router.route(objectivePhaseTask(task(), "OBJECTIVE_VERIFICATION"), "normal");
    expect(verification.selected?.model).toBe("best-judge");
    expect(verification.selected?.capabilityFit?.dimensions.verification).toBe(1);
  });
  it("distinguishes verifier shortage from a producer quality rejection", async () => {
    const router = await selector(["useful-producer", "best-judge"], {});
    const route = await router.route(objectivePhaseTask(task(), "DIRECT_RESPONSE"), "normal");
    expect(route).toMatchObject({ candidates: [], capacityStatus: "NEEDS_CAPABILITY" });
    expect(route.reason).toContain("producer capacity exists");
    expect(route.reason).toContain("independently qualified verifier");
  });
  it("does not invent an independent pair from physical aliases", async () => {
    const models = ["vendor/same-model:free", "other/same_model"];
    const router = await selector(models, Object.fromEntries(models.map(model => [model, 1])));
    const route = await router.route(objectivePhaseTask(task(), "DIRECT_RESPONSE"), "normal");
    expect(route).toMatchObject({ candidates: [], capacityStatus: "NEEDS_CAPABILITY" });
    expect(route.rejectedCandidates?.filter(candidate => candidate.reasons.includes("no independently qualified verifier for this producer"))).toHaveLength(2);
  });
});
