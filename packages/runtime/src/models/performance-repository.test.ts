import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/client.js";
import { MemoryEngine } from "../memory/memory-engine.js";
import { MemoryStore } from "../memory/memory-store.js";
import type { TaskOutcome } from "../intelligence/contracts.js";
import { MemoryPerformanceRepository } from "./performance-repository.js";

function outcome(overrides: Partial<TaskOutcome> = {}): TaskOutcome {
  return {
    task: {
      id: `task-${Math.random()}`,
      input: "Implement a TypeScript parser",
      type: "coding",
      complexity: 0.6,
      risk: 0.1,
      estimatedTokens: 1000,
      requirements: { reasoning: true }
    },
    attempts: [],
    success: true,
    result: "ok",
    evaluation: { score: 0.8, passed: true },
    provider: "provider-a",
    model: "model-a",
    tokens: 1000,
    monetaryCostUsd: 0,
    shadowCostUsd: 0.002,
    latencyMs: 120,
    tools: [],
    completedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("MemoryPerformanceRepository", () => {
  it("aggregates real-world outcomes without a benchmark table", async () => {
    const { db, sqlite } = openDatabase(":memory:");
    const store = new MemoryStore(db);
    const memory = new MemoryEngine(store);
    const repository = new MemoryPerformanceRepository(store);

    await memory.recordOutcome(outcome());
    await memory.recordOutcome(outcome({
      success: false,
      evaluation: { score: 0.4, passed: false },
      latencyMs: 280,
      shadowCostUsd: 0.004,
      completedAt: new Date(Date.now() + 1).toISOString()
    }));

    const stats = await repository.get("provider-a", "model-a", "coding");
    expect(stats.samples).toBe(2);
    expect(stats.successes).toBe(1);
    expect(stats.failures).toBe(1);
    expect(stats.successRate).toBe(0.5);
    expect(stats.avgEvaluationScore).toBeCloseTo(0.6);
    expect(stats.avgLatencyMs).toBe(200);
    expect(stats.avgMonetaryCostUsd).toBe(0);
    expect(stats.avgShadowCostUsd).toBeCloseTo(0.003);
    sqlite.close();
  });
});
