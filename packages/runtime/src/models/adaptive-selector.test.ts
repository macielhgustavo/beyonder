import { fixtureZeroCost } from './testing/zero-cost-fixture.js';
import { mkdtemp, readFile } from "node:fs/promises";
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
  constructor(private readonly overrides: Record<string, Partial<QuotaSnapshot>> = {}) {}

  async get(provider: string, model?: string): Promise<QuotaSnapshot> {
    const base: QuotaSnapshot = {
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
    return { ...base, ...(this.overrides[provider] ?? {}), provider, model };
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
        validation: { status: "validated", models: ["llama-3.3-70b-versatile"], latencyMs: 80 }
      },
      ovh: {
        providerId: "ovh",
        state: "READY",
        classification: "AUTO_WITH_HUMAN_GATE",
        attempts: 1,
        lastUpdatedAt: new Date().toISOString(),
        validation: { status: "validated", models: ["Meta-Llama-3_3-70B-Instruct"], latencyMs: 140 }
      },
      "ai-horde": {
        providerId: "ai-horde",
        state: "READY",
        classification: "KEYLESS",
        attempts: 1,
        lastUpdatedAt: new Date().toISOString(),
        validation: { status: "validated", models: ["anonymous-worker-pool"], latencyMs: 600 }
      }
    }
  });
  return path;
}

describe("AdaptiveModelSelector", () => {
  it("uses observed historical latency when operational health has no samples", async () => {
    const path = await providerStatePathFor({ groq: ["llama-3.3-70b-versatile"], gemini: ["gemini-2.5-flash"] });
    const selector = new AdaptiveModelSelector(path, { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model),
      quotaSource: new FixedQuotaSource(),
      operationalHealth: async () => ({ samples: 0, failures: 0, latencyMs: 0 }),
      canAttempt: async (candidate) => ["groq", "gemini"].includes(candidate.provider),
      performanceRepository: new FixedPerformanceRepository({
        "groq/llama-3.3-70b-versatile/chat": { ...performance("groq", "llama-3.3-70b-versatile", "chat", 25, 0.99, 1), avgLatencyMs: 10000 },
        "gemini/gemini-2.5-flash/chat": { ...performance("gemini", "gemini-2.5-flash", "chat", 25, 0.86, 1), avgLatencyMs: 1 }
      })
    });
    const route = await selector.route(task({ type: "chat", complexity: 0.1, requirements: { directResponse: true } }), "normal");
    const slow = route.candidates.find(candidate => candidate.provider === "groq")!;
    const fast = route.candidates.find(candidate => candidate.provider === "gemini")!;
    expect(slow.latencyPenalty).toBeGreaterThan(fast.latencyPenalty);
    expect(slow.latencyPenalty).toBeGreaterThan(0);
    expect(route.selected).toBe(route.candidates[0]);
    expect(route.selected!.utility).toBe(Math.max(...route.candidates.map(candidate => candidate.utility)));
  });
  it("generates and ranks multiple compatible zero-money candidates", async () => {
    const path = await providerStatePath();
    const selector = new AdaptiveModelSelector(path, { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model), quotaSource: new FixedQuotaSource(), random: new SequenceRandom([0.99]) });
    const route = await selector.route(task(), "normal");
    expect(route.candidates.length).toBeGreaterThanOrEqual(3);
    expect(route.selected).toBe(route.candidates[0]);
    expect(route.candidates.every((candidate) => candidate.monetaryCostUsd === 0)).toBe(true);
    expect(route.candidates[0]?.utility).toBeGreaterThanOrEqual(route.candidates.at(-1)?.utility ?? -1);
  });

  it("filters incompatible vision tasks and blocks halted inference", async () => {
    const path = await providerStatePath();
    const selector = new AdaptiveModelSelector(path, { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model), quotaSource: new FixedQuotaSource() });
    const vision = await selector.route(task({ requirements: { vision: true } }), "normal");
    expect(vision.candidates).toHaveLength(0);
    const halted = await selector.route(task(), "halted");
    expect(halted.candidates).toHaveLength(0);
    expect(halted.reason).toContain("halted");
  });

  it("supports deterministic controlled exploration without bypassing candidate constraints", async () => {
    const path = await providerStatePath();
    const selector = new AdaptiveModelSelector(path, { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model),
      quotaSource: new FixedQuotaSource(),
      allowExploration: true,
      random: new SequenceRandom([0, 0])
    });
    const route = await selector.route(task(), "normal");
    expect(route.candidates.length).toBeGreaterThan(1);
    expect(route.explored).toBe(true);
    expect(route.selected).not.toBe(route.candidates[0]);
    expect(route.selected?.monetaryCostUsd).toBe(0);
  });

  it("uses the best qualified candidate in normal product routing even when randomness would explore", async () => {
    const selector = new AdaptiveModelSelector(await providerStatePath(), { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model), quotaSource: new FixedQuotaSource(), random: new SequenceRandom([0, 0]) });
    const route = await selector.route(task(), "normal");
    expect(route.candidates.length).toBeGreaterThan(1);
    expect(route.explored).toBe(false);
    expect(route.selected).toBe(route.candidates[0]);
  });

  it("uses BIB prior when no real outcomes exist", async () => {
    const path = await providerStatePath();
    const selector = new AdaptiveModelSelector(path, { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model),
      quotaSource: new FixedQuotaSource(),
      random: new SequenceRandom([0.99]),
      capabilitySource: new FixedCapabilitySource({
        "ovh/Meta-Llama-3_3-70B-Instruct/coding": { score: 0.96, samples: 8, source: "BIB" }
      })
    });
    const route = await selector.route(task(), "normal");
    const ovh = route.candidates.find((candidate) => candidate.provider === "ovh");
    expect(ovh?.capabilityEvidence).toMatchObject({ bibScore: 0.96, bibSamples: 8, realSamples: 0, source: "BIB" });
  });

  it("uses real outcomes when BIB is absent", async () => {
    const path = await providerStatePath();
    const selector = new AdaptiveModelSelector(path, { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model),
      quotaSource: new FixedQuotaSource(),
      performanceRepository: new FixedPerformanceRepository({
        "groq/llama-3.3-70b-versatile/coding": performance("groq", "llama-3.3-70b-versatile", "coding", 10, 0.8, 0.8)
      })
    });
    const route = await selector.route(task(), "normal");
    const groq = route.candidates.find((candidate) => candidate.provider === "groq");
    expect(groq?.capabilityEvidence).toMatchObject({ bibScore: null, realSamples: 10, source: "outcomes" });
    expect(groq?.predictedQuality).toBeGreaterThan(0.78);
  });

  it("combines BIB prior with real outcomes and exposes evidence even when the quality floor rejects execution", async () => {
    const path = await providerStatePath();
    const telemetry = new CapturingTelemetry();
    const selector = new AdaptiveModelSelector(path, { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model),
      quotaSource: new FixedQuotaSource(),
      telemetry,
      capabilitySource: new FixedCapabilitySource({
        "groq/llama-3.3-70b-versatile/coding": { score: 0.9, samples: 6, source: "BIB" }
      }),
      performanceRepository: new FixedPerformanceRepository({
        "groq/llama-3.3-70b-versatile/coding": performance("groq", "llama-3.3-70b-versatile", "coding", 20, 0.6, 0.6)
      })
    });
    const route = await selector.route(task(), "normal");
    const groq = route.consideredCandidates?.find((candidate) => candidate.provider === "groq");
    expect(groq?.capabilityEvidence).toMatchObject({ bibScore: 0.9, bibSamples: 6, realScore: 0.6, realSamples: 20, source: "BIB + outcomes" });
    expect(groq?.predictedQuality).toBeGreaterThan(0.6);
    expect(telemetry.events.some((entry) => entry.event === "capability.resolved" && entry.details?.bibScore === 0.9)).toBe(true);
  });

  it("lets BIB prior change routing when economic constraints are equal", async () => {
    const path = await providerStatePath();
    const selector = new AdaptiveModelSelector(path, { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model),
      quotaSource: new FixedQuotaSource(),
      random: new SequenceRandom([0.99]),
      capabilitySource: new FixedCapabilitySource({
        "groq/llama-3.3-70b-versatile/coding": { score: 0.55, samples: 8, source: "BIB" },
        "ovh/Meta-Llama-3_3-70B-Instruct/coding": { score: 0.98, samples: 8, source: "BIB" }
      }),
      performanceRepository: new FixedPerformanceRepository({
        "groq/llama-3.3-70b-versatile/coding": performance("groq", "llama-3.3-70b-versatile", "coding", 0, 0.5, 0.5),
        "ovh/Meta-Llama-3_3-70B-Instruct/coding": performance("ovh", "Meta-Llama-3_3-70B-Instruct", "coding", 0, 0.5, 0.5)
      })
    });
    const route = await selector.route(task(), "normal");
    expect(route.selected?.provider).toBe("ovh");
    expect(route.selected?.capabilityEvidence.bibScore).toBe(0.98);
  });

  it("includes free providers but excludes NVIDIA Developer from product routing", async () => {
    const path = await providerStatePathFor({
      groq: ["llama-3.3-70b-versatile"],
      "nvidia-nim": ["qwen/qwen2.5-coder-32b-instruct"],
      "cloudflare-workers-ai": ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"]
    });
    const selector = new AdaptiveModelSelector(path, { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model), quotaSource: new FixedQuotaSource(), random: new SequenceRandom([0.99]) });
    const route = await selector.route(task({ type: "coding" }), "normal");
    expect(route.candidates.map((candidate) => candidate.provider)).toEqual(expect.arrayContaining([
      "groq",
      "cloudflare-workers-ai"
    ]));
    expect(route.candidates.some(candidate => candidate.provider === 'nvidia-nim')).toBe(false);
    expect(route.rejectedCandidates?.find(candidate => candidate.provider === 'nvidia-nim')?.economics?.classification).toBe('DEV_EVAL_ONLY');
  });

  it("rejects exhausted NVIDIA quota while preserving BIB capability", async () => {
    const path = await providerStatePathFor({
      "nvidia-nim": ["qwen/qwen2.5-coder-32b-instruct"],
      groq: ["llama-3.3-70b-versatile"]
    });
    const selector = new AdaptiveModelSelector(path, { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model),
      quotaSource: new FixedQuotaSource({
        "nvidia-nim": { health: "unhealthy", requestQuotaRemaining: 0, resetAt: new Date(Date.now() + 60_000).toISOString() }
      }),
      capabilitySource: new FixedCapabilitySource({
        "nvidia-nim/qwen/qwen2.5-coder-32b-instruct/coding": { score: 0.9, samples: 3, source: "BIB" }
      })
    });
    const route = await selector.route(task({ type: "coding" }), "normal");
    expect(route.candidates.some(candidate => candidate.provider === "nvidia-nim")).toBe(false);
    expect(route.rejectedCandidates?.find(candidate => candidate.provider === "nvidia-nim")?.economics?.classification).toBe("DEV_EVAL_ONLY");
    expect((await new AutopilotStateStore(path).read()).providers["nvidia-nim"].validation?.models).toContain("qwen/qwen2.5-coder-32b-instruct");
  });

  it("excludes incompatible Cloudflare models from candidates", async () => {
    const path = await providerStatePathFor({
      "cloudflare-workers-ai": ["@cf/baai/bge-base-en-v1.5", "@cf/openai/whisper"]
    });
    const selector = new AdaptiveModelSelector(path, { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model), quotaSource: new FixedQuotaSource() });
    const route = await selector.route(task({ type: "chat" }), "normal");
    expect(route.candidates.some((candidate) => candidate.provider === "cloudflare-workers-ai")).toBe(false);
  });

  it("keeps free providers ahead of billing-risk providers and survival at zero money", async () => {
    const path = await providerStatePathFor({
      groq: ["llama-3.3-70b-versatile"],
      reka: ["reka-flash-3"]
    });
    const selector = new AdaptiveModelSelector(path, { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model), quotaSource: new FixedQuotaSource() });
    const normal = await selector.route(task({ type: "chat" }), "normal");
    expect(normal.candidates.map((candidate) => candidate.provider)).toContain("groq");
    expect(normal.candidates.map((candidate) => candidate.provider)).not.toContain("reka");
    const survival = await selector.route(task({ type: "chat" }), "survival");
    expect(survival.candidates.every((candidate) => candidate.monetaryCostUsd === 0)).toBe(true);
  });
});

async function providerStatePathFor(modelsByProvider: Record<string, string[]>) {
  const dir = await mkdtemp(join(tmpdir(), "beyonder-router-"));
  const path = join(dir, "providers.json");
  const providers = Object.fromEntries(Object.entries(modelsByProvider).map(([providerId, models]) => [
    providerId,
    {
      providerId,
      state: "READY" as const,
      classification: providerId === "reka" ? "PAID_ONLY" as const : "AUTO_WITH_HUMAN_GATE" as const,
      attempts: 1,
      lastUpdatedAt: new Date().toISOString(),
      validation: { status: "validated" as const, models, latencyMs: 100 }
    }
  ]));
  await new AutopilotStateStore(path).write({ version: 1, updatedAt: new Date().toISOString(), providers });
  return path;
}

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


it("keeps capability history while excluding currently inaccessible credentials",async()=>{
 const path=await providerStatePathFor({groq:["llama-3.3-70b-versatile"]});
 const before=await readFile(path,'utf8');
 const selector=new AdaptiveModelSelector(path,{ economicEvidence: async (provider, model) => fixtureZeroCost(provider, model),quotaSource:new FixedQuotaSource(),credentialAccess:async()=>({identity:'credential://provider/groq',provider:'groq',expected:true,configured:true,present:true,accessible:false,valid:'UNKNOWN',source:'BEYONDER_VAULT',scope:['inference'],status:'VAULT_LOCKED',lastValidated:null})});
 const route=await selector.route(task({type:'chat',complexity:0.1,requirements:{directResponse:true}}),'normal');
 expect(route.selected).toBeUndefined();expect(route.capacityStatus).toBe('NEEDS_CAPABILITY');expect(route.rejectedCandidates?.some(c=>c.reasons.some(r=>r.includes('VAULT_LOCKED')&&r.includes('history retained')))).toBe(true);
 expect(await readFile(path,'utf8')).toBe(before);
});
