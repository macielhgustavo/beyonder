import { fixtureZeroCost } from './testing/zero-cost-fixture.js';
import { analyzeGoalContract } from "../intelligence/goal-contract.js";
import { describe, expect, it, vi } from "vitest";
import type { IntelligenceTask } from "../intelligence/contracts.js";
import type { ModelResponse } from "../types.js";
import type { ModelCandidate } from "./adaptive-types.js";
import { assessCapability, computeTier, objectivePhaseTask, resolveQualityFloor, routingScore } from "./compute-policy.js";
import { InferenceError, runCandidates } from "./inference.js";
import { inferenceAttemptPolicy } from "./router-config.js";
import { predictCapability } from "./capability-source.js";

function task(overrides: Partial<IntelligenceTask> = {}): IntelligenceTask {
  return {
    id: "cloud-first-task",
    input: "Answer the objective",
    type: "chat",
    complexity: 0.15,
    risk: 0.05,
    estimatedTokens: 300,
    requirements: { directResponse: true },
    ...overrides
  };
}

describe("mission-adjusted cloud efficiency", () => {
  it.each([1, 40])("counts %s observed failures once while preserving rejection for poor sustained quality", samples => {
    const performance = { ...candidate().performance, samples, successes: 0, failures: samples, successRate: 0, avgEvaluationScore: 0 };
    const predictedQuality = predictCapability({ benchmarkPrior: 1, performance, metadataQualityClass: "high" });
    const current = candidate({ predictedQuality, performance, reliability: 1 });
    const floor = { level: "HIGH" as const, minimumOverall: 0.745, dimensions: {}, reasons: [] };
    const fit = assessCapability(current, task(), floor);
    expect(fit.overall).toBeCloseTo(predictedQuality * 0.82 + 0.18);
    expect(fit.passes).toBe(samples === 1);
    expect(predictedQuality).toBeLessThan(1);
    expect(floor.minimumOverall).toBe(0.745);
  });
  it("prefers efficient adequate cloud for a minimal floor while retaining quality dominance for high floors", () => {
    const floor = resolveQualityFloor(task());
    const strong = candidate({ predictedQuality: 0.98, latencyPenalty: 1 });
    const efficient = candidate({ predictedQuality: 0.8, latencyPenalty: 0.01 });
    const strongFit = assessCapability(strong, task(), floor), efficientFit = assessCapability(efficient, task(), floor);
    expect(efficientFit.passes).toBe(true);
    expect(routingScore(efficient, efficientFit, "STRONG_FREE_CLOUD", floor)).toBeGreaterThan(routingScore(strong, strongFit, "STRONG_FREE_CLOUD", floor));
    const high = { ...floor, level: "HIGH" as const, minimumOverall: 0.77 };
    expect(routingScore(strong, strongFit, "STRONG_FREE_CLOUD", high)).toBeGreaterThan(routingScore(efficient, efficientFit, "STRONG_FREE_CLOUD", high));
  });
});

function candidate(overrides: Partial<ModelCandidate> = {}): ModelCandidate {
  const provider = overrides.provider ?? "groq";
  const model = overrides.model ?? "strong-free-model";
  return {
    economics: fixtureZeroCost(provider, model),
    provider,
    model,
    local: false,
    externalQuotaConsumption: true,
    costClass: "FREE_CONFIRMED",
    structuredOutput: "native",
    capabilities: ["text", "reasoning", "coding"],
    contextWindow: 32_768,
    toolCalling: "yes",
    predictedQuality: 0.86,
    historicalSuccess: 0.9,
    reliability: 0.92,
    monetaryCostUsd: 0,
    shadowCostUsd: 0.001,
    latencyPenalty: 0.08,
    failureRisk: 0.08,
    effectiveResourceCost: 0.001,
    utility: 0.82,
    quota: {
      provider,
      model,
      requestsPerMinute: 60,
      requestsPerDay: 1000,
      tokensPerMinute: 100_000,
      tokensPerDay: 1_000_000,
      requestQuotaTotal: 1000,
      requestQuotaRemaining: 900,
      tokenQuotaTotal: 1_000_000,
      tokenQuotaRemaining: 900_000,
      resetAt: "unknown",
      health: "healthy",
      lastUpdatedAt: new Date().toISOString()
    },
    performance: {
      provider,
      model,
      taskType: "chat",
      samples: 20,
      successes: 18,
      failures: 2,
      successRate: 0.9,
      avgEvaluationScore: 0.86,
      avgLatencyMs: 200,
      avgMonetaryCostUsd: 0,
      avgShadowCostUsd: 0.001,
      avgAttempts: 1
    },
    benchmarkCapability: { score: 0.86, samples: 8, source: "BIB" },
    capabilityEvidence: {
      bibScore: 0.86,
      bibSamples: 8,
      realScore: 0.88,
      realSamples: 20,
      predictedScore: 0.86,
      source: "BIB + outcomes"
    },
    explanation: { positives: [], penalties: [], constraints: [] },
    ...overrides
  };
}

function response(forCandidate: ModelCandidate, content = "ok"): ModelResponse {
  return { content, provider: forCandidate.provider, model: forCandidate.model, estimatedCostUsd: 0 };
}

describe("cloud-first routing policy", () => {
  it.each(["coding", "planning", "research"] as const)("does not promote unmeasured %s from a good synthesis benchmark", taskType => {
    const current = task({ type: taskType, complexity: 0.5, requirements: { [taskType]: true } });
    const floor = { ...resolveQualityFloor(current), minimumOverall: 0.75, dimensions: { [taskType]: 0.75 } };
    const measured = candidate({ predictedQuality: 1, metadataQuality: 0.68, reliability: 0.72, performance: { ...candidate().performance, samples: 0 }, capabilities: ["text"], contextWindow: "unknown", benchmarkCapability: { score: 1, samples: 2, source: "BIB", dimensions: { synthesis: { score: 1, samples: 2, updatedAt: new Date().toISOString() } } } });
    expect(assessCapability(measured, current, floor).passes).toBe(false);
  });
  it("raises a HIGH multidimensional floor for current multi-source research", () => {
    const research = task({
      type: "research",
      complexity: 0.76,
      requirements: { browser: true, reasoning: true, toolUse: true },
      goalContract: {
        version: 1,
        normalizedObjective: "Compare current providers using multiple sources",
        primaryIntent: "COMPARISON",
        domain: "technology",
        freshness: "CURRENT",
        evidenceRequirement: "REQUIRED",
        requiredCapabilities: ["web-research", "browser-read", "comparison", "citations", "reasoning"],
        ambiguityLevel: "LOW",
        clarificationRequired: false,
        successCriteria: [],
        expectedResultKind: "COMPARISON",
        qualityTarget: "HIGH",
        minimumEvidenceSources: 3,
        analysisMethod: "hybrid"
      }
    });
    const floor = resolveQualityFloor(research);
    expect(floor.level).toBe("HIGH");
    expect(floor.minimumOverall).toBeGreaterThanOrEqual(0.77);
    expect(floor.dimensions).toMatchObject({ research: expect.any(Number), synthesis: expect.any(Number), reasoning: expect.any(Number), verification: expect.any(Number), freshnessEvidence: expect.any(Number) });
  });

  it("rejects a small local model below a complex mission floor", () => {
    const hardCoding = task({
      type: "coding",
      complexity: 0.9,
      requirements: { coding: true, reasoning: true, planning: true, structuredOutput: true },
      goalContract: {
        version: 1,
        normalizedObjective: "Design and implement a difficult production refactor",
        primaryIntent: "CODING",
        domain: "software-development",
        freshness: "STATIC",
        evidenceRequirement: "NONE",
        requiredCapabilities: ["coding", "reasoning", "planning", "structured-output"],
        ambiguityLevel: "LOW",
        clarificationRequired: false,
        successCriteria: [],
        expectedResultKind: "CODE",
        qualityTarget: "HIGH",
        minimumEvidenceSources: 0,
        analysisMethod: "hybrid"
      }
    });
    const floor = resolveQualityFloor(hardCoding);
    const local = candidate({
      provider: "ollama",
      model: "qwen3:4b",
      local: true,
      externalQuotaConsumption: false,
      predictedQuality: 0.49,
      historicalSuccess: 0.58,
      reliability: 0.78,
      capabilities: ["text", "reasoning"],
      performance: { ...candidate().performance, provider: "ollama", model: "qwen3:4b", taskType: "coding", samples: 12, successes: 7, failures: 5, successRate: 0.58, avgEvaluationScore: 0.52 },
      capabilityEvidence: { bibScore: 0.5, bibSamples: 5, realScore: 0.55, realSamples: 12, predictedScore: 0.49, source: "BIB + outcomes" }
    });
    const fit = assessCapability(local, hardCoding, floor);
    expect(fit.passes).toBe(false);
    expect(fit.gaps.length).toBeGreaterThan(0);
    expect(computeTier(local, fit, floor)).toBe("LOCAL_EMERGENCY");
  });

  it("allows quality-qualified local compute only as LOCAL_EMERGENCY for a simple task", () => {
    const simple = task({ type: "chat", complexity: 0.08 });
    const floor = resolveQualityFloor(simple);
    const local = candidate({ provider: "ollama", model: "qwen3.5:4b", local: true, externalQuotaConsumption: false, predictedQuality: 0.74, reliability: 0.9, historicalSuccess: 0.84 });
    const fit = assessCapability(local, simple, floor);
    expect(fit.passes).toBe(true);
    expect(computeTier(local, fit, floor)).toBe("LOCAL_EMERGENCY");
  });

  it("classifies a high-quality reliable free cloud as STRONG_FREE_CLOUD", () => {
    const simple = task();
    const floor = resolveQualityFloor(simple);
    const cloud = candidate();
    const fit = assessCapability(cloud, simple, floor);
    expect(fit.passes).toBe(true);
    expect(computeTier(cloud, fit, floor)).toBe("STRONG_FREE_CLOUD");
  });

  it("tries a second qualified cloud before local when the first cloud fails", async () => {
    const first = candidate({ provider: "cloud-a", model: "a", computeTier: "STRONG_FREE_CLOUD", eligible: true });
    const second = candidate({ provider: "cloud-b", model: "b", computeTier: "OTHER_FREE_CLOUD", eligible: true });
    const local = candidate({ provider: "ollama", model: "qwen3.5:4b", local: true, externalQuotaConsumption: false, computeTier: "LOCAL_EMERGENCY", eligible: true });
    const order: string[] = [];
    const complete = vi.fn(async (_messages, current: ModelCandidate) => {
      order.push(current.provider);
      if (current.provider === "cloud-a") throw new InferenceError("first cloud unavailable", "PROVIDER_UNAVAILABLE");
      return response(current, "resolved by second cloud");
    });
    const result = await runCandidates({
      taskId: "two-clouds",
      phase: "DIRECT_RESPONSE",
      candidates: [first, second, local],
      messages: [{ role: "user", content: "hello" }],
      remoteAttemptBudget: 2,
      localFallbackBudget: 1,
      maxMonetaryCostUsd: 0,
      maxShadowCostUsd: 0.02,
      maxDurationMs: 5_000,
      complete,
      validate: (value) => value.content
    });
    expect(result.value).toBe("resolved by second cloud");
    expect(order).toEqual(["cloud-a", "cloud-b"]);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("uses local only after all budgeted clouds fail and only when local is eligible", async () => {
    const cloudA = candidate({ provider: "cloud-a", model: "a", computeTier: "STRONG_FREE_CLOUD", eligible: true });
    const cloudB = candidate({ provider: "cloud-b", model: "b", computeTier: "OTHER_FREE_CLOUD", eligible: true });
    const local = candidate({ provider: "ollama", model: "qwen3.5:4b", local: true, externalQuotaConsumption: false, computeTier: "LOCAL_EMERGENCY", eligible: true });
    const order: string[] = [];
    const result = await runCandidates({
      taskId: "airbag",
      phase: "DIRECT_RESPONSE",
      candidates: [cloudA, cloudB, local],
      messages: [{ role: "user", content: "simple task" }],
      remoteAttemptBudget: 2,
      localFallbackBudget: 1,
      maxMonetaryCostUsd: 0,
      maxShadowCostUsd: 0.02,
      maxDurationMs: 5_000,
      complete: async (_messages, current) => {
        order.push(current.provider);
        if (!current.local) throw new InferenceError("cloud unavailable", "PROVIDER_UNAVAILABLE");
        return response(current, "local emergency result");
      },
      validate: (value) => value.content
    });
    expect(result.candidate.provider).toBe("ollama");
    expect(order).toEqual(["cloud-a", "cloud-b", "ollama"]);
  });

  it("never attempts an ineligible local model after cloud failures", async () => {
    const cloud = candidate({ provider: "cloud-a", model: "a", computeTier: "STRONG_FREE_CLOUD", eligible: true });
    const weakLocal = candidate({ provider: "ollama", model: "qwen3:4b", local: true, externalQuotaConsumption: false, computeTier: "LOCAL_EMERGENCY", eligible: false, rejectionReasons: ["quality-floor:overall=0.49<0.77"] });
    const order: string[] = [];
    await expect(runCandidates({
      taskId: "weak-local",
      phase: "DIRECT_RESPONSE",
      candidates: [cloud, weakLocal],
      messages: [{ role: "user", content: "hard task" }],
      remoteAttemptBudget: 1,
      localFallbackBudget: 1,
      maxMonetaryCostUsd: 0,
      maxShadowCostUsd: 0.02,
      maxDurationMs: 5_000,
      complete: async (_messages, current) => {
        order.push(current.provider);
        throw new InferenceError("cloud unavailable", "PROVIDER_UNAVAILABLE");
      },
      validate: (value) => value.content
    })).rejects.toMatchObject({ failureClass: "NEEDS_CAPABILITY" });
    expect(order).toEqual(["cloud-a"]);
  });

  it("returns NEEDS_CAPABILITY when no acceptable model is executable", async () => {
    await expect(runCandidates({
      taskId: "none-sufficient",
      phase: "DIRECT_RESPONSE",
      candidates: [],
      messages: [{ role: "user", content: "hard task" }],
      remoteAttemptBudget: 2,
      localFallbackBudget: 1,
      maxMonetaryCostUsd: 0,
      maxShadowCostUsd: 0.02,
      maxDurationMs: 5_000,
      complete: async (_messages, current) => response(current),
      validate: (value) => value.content
    })).rejects.toMatchObject({ failureClass: "NEEDS_CAPABILITY" });
  });

  it("budgets multiple cloud attempts in survival while keeping one local airbag", () => {
    expect(inferenceAttemptPolicy("survival")).toEqual({ remoteAttemptBudget: 2, localFallbackBudget: 1 });
  });
});

describe("phase requirements retain the goal's quality floor", () => {
  it.each(["Escreva uma função TypeScript que remova duplicatas.", "Compare dois índices atuais de popularidade de linguagens.", "Planeje uma migração de dados."])("keeps producer and independent judge capacity distinct: %s", input => {
    const original = task({ input, goalContract: analyzeGoalContract(input, "reasoning") });
    const mission = resolveQualityFloor(original);
    const producer = resolveQualityFloor(objectivePhaseTask(original, "DIRECT_RESPONSE"));
    const verifier = resolveQualityFloor(objectivePhaseTask(original, "OBJECTIVE_VERIFICATION"));
    expect(producer.level).toBe(mission.level);
    expect(producer.minimumOverall).toBe(mission.minimumOverall);
    expect(verifier.minimumOverall).toBe(mission.minimumOverall);
    expect(producer.dimensions.verification).toBeUndefined();
    expect(verifier.dimensions.verification).toBe(mission.dimensions.verification);
    expect(mission.dimensions.verification).toBeDefined();
    for (const [dimension, minimum] of Object.entries(mission.dimensions)) {
      if (dimension !== "verification" && dimension !== "toolUse") expect(producer.dimensions[dimension as keyof typeof producer.dimensions]).toBe(minimum);
    }
    const badJudge = candidate({ predictedQuality: 0.99, reliability: 0.99, benchmarkCapability: { score: 0.99, samples: 10, source: "BIB", dimensions: Object.fromEntries(Object.keys(verifier.dimensions).map(dimension => [dimension, { score: dimension === "verification" ? 0.1 : 0.99, samples: 3, updatedAt: new Date().toISOString() }])) } });
    expect(assessCapability(badJudge, objectivePhaseTask(original, "DIRECT_RESPONSE"), producer).passes).toBe(true);
    expect(assessCapability(badJudge, objectivePhaseTask(original, "OBJECTIVE_VERIFICATION"), verifier).passes).toBe(false);
  });
  it.each(["Qual é a versão estável atual do Python?", "Qual é a versão LTS atual do Node.js?", "Compare dois índices atuais de popularidade de linguagens."])("does not ask the answer/verifier to replan completed research: %s", objective => {
    const original = task({type: "browser", input: objective, requirements: {browser: true, planning: true, toolUse: true, tools: ["browser"]}, goalContract: analyzeGoalContract(objective, "browser")});
    for (const phase of ["DIRECT_RESPONSE", "OBJECTIVE_VERIFICATION"] as const) {
      const phased = objectivePhaseTask(original, phase); const floor = resolveQualityFloor(phased);
      expect(floor.minimumOverall).toBe(resolveQualityFloor(original).minimumOverall);
      expect(floor.level).toBe("HIGH");
      expect(floor.dimensions.planning).toBeUndefined();
      expect(floor.dimensions.research).toBeGreaterThanOrEqual(0.71);
      expect(floor.dimensions.freshnessEvidence).toBeGreaterThanOrEqual(0.71);
      expect(phased.goalContract).toBe(original.goalContract);
    }
  });
  it("retains planning capability for an actual planning objective in both phases", () => {
    const original = task({type: "planning", input: "Planeje uma migração de dados.", requirements: {planning: true}, goalContract: analyzeGoalContract("Planeje uma migração de dados.", "planning")});
    for (const phase of ["DIRECT_RESPONSE", "OBJECTIVE_VERIFICATION"] as const) expect(resolveQualityFloor(objectivePhaseTask(original, phase)).dimensions.planning).toBeDefined();
  });
});
