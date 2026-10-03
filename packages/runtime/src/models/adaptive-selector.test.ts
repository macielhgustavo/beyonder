import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { AutopilotStateStore } from "@beyonder/compute";
import type { IntelligenceTask } from "../intelligence/contracts.js";
import { AdaptiveModelSelector } from "./adaptive-selector.js";
import type { ModelCapabilityEvidence, ModelCapabilityRequest, ModelCapabilitySource } from "./capability-source.js";
import type { PerformanceRepository } from "./performance-repository.js";
import type { QuotaSource } from "./quota.js";
import type { HistoricalPerformance, QuotaSnapshot, RouterTelemetry } from "./adaptive-types.js";
import type { RandomSource } from "./random.js";

function task(overrides: Partial<IntelligenceTask> = {}): IntelligenceTask {
  return {
    id: "task-route",
    input: "Implement a TypeScript parser with tests",
    type: "coding",
    complexity: 0.6,
    risk: 0.1,
    estimatedTokens: 900,
    requirements: { reasoning: true, contextWindow: 1024 },
    ...overrides
  };
}

class FixedQuotaSource implements QuotaSource {
  async get(provider: string, model?: string): Promise<QuotaSnapshot> {
    return {
      provider,
      model,
      requestsPerMinute: 60,
      requestsPerDay: 1000,
      tokensPerMinute: 100000,
      tokensPerDay: 1000000,
      requestQuotaTotal: 1000,
      requestQuotaRemaining: 900,
      tokenQuotaTotal: 1000000,
      tokenQuotaRemaining: 900000,
      resetAt: "unknown",
      health: "healthy",
      lastUpdatedAt: new Date().toISOString()
    };
  }
  async list(): Promise<QuotaSnapshot[]> { return []; }
}

class SequenceRandom implements RandomSource {
  constructor(private readonly values: number[]) {}
  next(): number { return this.values.shift() ?? 0.99; }
}

class FixedCapabilitySource implements ModelCapabilitySource {
  constructor(private readonly scores: Record<string, ModelCapabilityEvidence | null>) {}

  async getCapability(input: ModelCapabilityRequest): Promise<ModelCapabilityEvidence | null> {
    return this.scores[`${input.provider}/${input.model}/${input.taskType}`] ?? null;
  }

  async getCapabilityScore(input: ModelCapabilityRequest): Promise<number | null> {
    return (await this.getCapability(input))?.score ?? null;
  }
}

class FixedPerformanceRepository implements PerformanceRepository {
  constructor(private readonly records: Record<string, HistoricalPerformance> = {}) {}

  async get(provider: string, model: string, taskType: HistoricalPerformance["taskType"]): Promise<HistoricalPerformance> {
    return this.records[`${provider}/${model}/${taskType}`] ?? performance(provider, model, taskType, 0, 0.5, 0.5);
  }
}

class CapturingTelemetry implements RouterTelemetry {
  readonly events: Array<{ level: string; event: string; details?: Record<string, unknown> }> = [];

  async record(level: "debug" | "info" | "warn" | "error", event: string, details?: Record<string, unknown>): Promise<void> {
    this.events.push({ level, event, details });
  }
}

async function providerStatePath() {
  const dir = await mkdtemp(join(tmpdir(), "beyonder-router-"));
  const path = join(dir, "providers.json");
  await new AutopilotStateStore(path).write({
    version: 1,
    updatedAt: new Date().toISOString(),
    providers: {
      groq: {
        providerId: "groq",
        state: "READY",
        classification: "AUTO_WITH_HUMAN_GATE",
        attempts: 1,
        lastUpdatedAt: new Date().toISOString(),
        validation: { status: "validated", models: ["groq-test-model"], latencyMs: 80 }
      },
      ovh: {
        providerId: "ovh",
        state: "READY",
        classification: "AUTO_WITH_HUMAN_GATE",
        attempts: 1,
        lastUpdatedAt: new Date().toISOString(),
        validation: { status: "validated", models: ["ovh-test-model"], latencyMs: 140 }
      },
      "ai-horde": {
        providerId: "ai-horde",
        state: "READY",
        classification: "KEYLESS",
        attempts: 1,
        lastUpdatedAt: new Date().toISOString(),
        validation: { status: "validated", models: ["horde-test-model"], latencyMs: 600 }
      }
    }
  });
  return path;
}

describe("AdaptiveModelSelector", () => {
  it("generates and ranks multiple compatible zero-money candidates", async () => {
    const path = await providerStatePath();
    const selector = new AdaptiveModelSelector(path, { quotaSource: new FixedQuotaSource(), random: new SequenceRandom([0.99]) });
    const route = await selector.route(task(), "normal");
    expect(route.candidates.length).toBeGreaterThanOrEqual(3);
    expect(route.selected).toBe(route.candidates[0]);
    expect(route.candidates.every((candidate) => candidate.monetaryCostUsd === 0)).toBe(true);
    expect(route.candidates[0]?.utility).toBeGreaterThanOrEqual(route.candidates.at(-1)?.utility ?? -1);
  });

  it("filters incompatible vision tasks and blocks halted inference", async () => {
    const path = await providerStatePath();
    const selector = new AdaptiveModelSelector(path, { quotaSource: new FixedQuotaSource() });
    const vision = await selector.route(task({ requirements: { vision: true } }), "normal");
    expect(vision.candidates).toHaveLength(0);
    const halted = await selector.route(task(), "halted");
    expect(halted.candidates).toHaveLength(0);
    expect(halted.reason).toContain("halted");
  });

  it("supports deterministic controlled exploration without bypassing candidate constraints", async () => {
    const path = await providerStatePath();
    const selector = new AdaptiveModelSelector(path, {
      quotaSource: new FixedQuotaSource(),
      random: new SequenceRandom([0, 0])
    });
    const route = await selector.route(task(), "normal");
    expect(route.candidates.length).toBeGreaterThan(1);
    expect(route.explored).toBe(true);
    expect(route.selected).not.toBe(route.candidates[0]);
    expect(route.selected?.monetaryCostUsd).toBe(0);
  });

  it("uses BIB prior when no real outcomes exist", async () => {
    const path = await providerStatePath();
    const selector = new AdaptiveModelSelector(path, {
      quotaSource: new FixedQuotaSource(),
      random: new SequenceRandom([0.99]),
      capabilitySource: new FixedCapabilitySource({
        "ovh/ovh-test-model/coding": { score: 0.96, samples: 8, source: "BIB" }
      })
    });
    const route = await selector.route(task(), "normal");
    const ovh = route.candidates.find((candidate) => candidate.provider === "ovh");
    expect(ovh?.capabilityEvidence).toMatchObject({ bibScore: 0.96, bibSamples: 8, realSamples: 0, source: "BIB" });
  });

  it("uses real outcomes when BIB is absent", async () => {
    const path = await providerStatePath();
    const selector = new AdaptiveModelSelector(path, {
      quotaSource: new FixedQuotaSource(),
      performanceRepository: new FixedPerformanceRepository({
        "groq/groq-test-model/coding": performance("groq", "groq-test-model", "coding", 10, 0.8, 0.8)
      })
    });
    const route = await selector.route(task(), "normal");
    const groq = route.candidates.find((candidate) => candidate.provider === "groq");
    expect(groq?.capabilityEvidence).toMatchObject({ bibScore: null, realSamples: 10, source: "outcomes" });
    expect(groq?.predictedQuality).toBeGreaterThan(0.78);
  });

  it("combines BIB prior with real outcomes and exposes evidence", async () => {
    const path = await providerStatePath();
    const telemetry = new CapturingTelemetry();
    const selector = new AdaptiveModelSelector(path, {
      quotaSource: new FixedQuotaSource(),
      telemetry,
      capabilitySource: new FixedCapabilitySource({
        "groq/groq-test-model/coding": { score: 0.9, samples: 6, source: "BIB" }
      }),
      performanceRepository: new FixedPerformanceRepository({
        "groq/groq-test-model/coding": performance("groq", "groq-test-model", "coding", 20, 0.6, 0.6)
      })
    });
    const route = await selector.route(task(), "normal");
    const groq = route.candidates.find((candidate) => candidate.provider === "groq");
    expect(groq?.capabilityEvidence).toMatchObject({ bibScore: 0.9, bibSamples: 6, realScore: 0.6, realSamples: 20, source: "BIB + outcomes" });
    expect(groq?.predictedQuality).toBeGreaterThan(0.6);
    expect(telemetry.events.some((entry) => entry.event === "capability.resolved" && entry.details?.bibScore === 0.9)).toBe(true);
  });

  it("lets BIB prior change routing when economic constraints are equal", async () => {
    const path = await providerStatePath();
    const selector = new AdaptiveModelSelector(path, {
      quotaSource: new FixedQuotaSource(),
      random: new SequenceRandom([0.99]),
      capabilitySource: new FixedCapabilitySource({
        "groq/groq-test-model/coding": { score: 0.55, samples: 8, source: "BIB" },
        "ovh/ovh-test-model/coding": { score: 0.98, samples: 8, source: "BIB" }
      }),
      performanceRepository: new FixedPerformanceRepository({
        "groq/groq-test-model/coding": performance("groq", "groq-test-model", "coding", 0, 0.5, 0.5),
        "ovh/ovh-test-model/coding": performance("ovh", "ovh-test-model", "coding", 0, 0.5, 0.5)
      })
    });
    const route = await selector.route(task(), "normal");
    expect(route.selected?.provider).toBe("ovh");
    expect(route.selected?.capabilityEvidence.bibScore).toBe(0.98);
  });
});

function performance(
  provider: string,
  model: string,
  taskType: HistoricalPerformance["taskType"],
  samples: number,
  score: number,
  successRate: number
): HistoricalPerformance {
  return {
    provider,
    model,
    taskType,
    samples,
    successes: Math.round(samples * successRate),
    failures: samples - Math.round(samples * successRate),
    successRate,
    avgEvaluationScore: score,
    avgLatencyMs: 100,
    avgMonetaryCostUsd: 0,
    avgShadowCostUsd: 0,
    avgAttempts: samples === 0 ? 0 : 1
  };
}
