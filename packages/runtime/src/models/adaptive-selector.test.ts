import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { AutopilotStateStore } from "@beyonder/compute";
import type { IntelligenceTask } from "../intelligence/contracts.js";
import { AdaptiveModelSelector } from "./adaptive-selector.js";
import type { QuotaSource } from "./quota.js";
import type { QuotaSnapshot } from "./adaptive-types.js";
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
});
