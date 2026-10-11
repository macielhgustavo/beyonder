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
  it.each(["NEEDS_CAPABILITY", "NEEDS_INPUT", "RECONCILIATION_REQUIRED"])("preserves %s costs without treating it as failed producer quality", async objectiveStatus => {
    const { db, sqlite } = openDatabase(":memory:");
    const store = new MemoryStore(db), memory = new MemoryEngine(store), repository = new MemoryPerformanceRepository(store);
    try {
      await memory.recordOutcome(outcome({ success: false, evaluation: { score: 0, passed: false, criteria: { objectiveStatus } } }));
      expect((await repository.get("provider-a", "model-a", "coding")).samples).toBe(0);
      const economic = (await store.all()).find(record => record.kind === "economic")!;
      expect(economic.metadata).toMatchObject({ success: false, evaluationScore: null, qualityEvaluated: false, shadowCostUsd: 0.002, objectiveStatus });
      await memory.recordOutcome(outcome({ success: false, evaluation: { score: 0, passed: false, criteria: { objectiveStatus: "FAILED" } } }));
      expect(await repository.get("provider-a", "model-a", "coding")).toMatchObject({ samples: 1, failures: 1, avgEvaluationScore: 0 });
    } finally { sqlite.close(); }
  });

  it("recovers interpretation of a legacy blocked row using persisted mission truth", async () => {
    const { db, sqlite } = openDatabase(":memory:");
    const store = new MemoryStore(db);
    try {
      await store.remember({ kind: "economic", content: "legacy blocked mission", taskId: "legacy", metadata: { provider: "provider-a", model: "model-a", taskType: "coding", success: false, evaluationScore: 0 } });
      const repository = new MemoryPerformanceRepository(store, async () => "NEEDS_CAPABILITY");
      expect((await repository.get("provider-a", "model-a", "coding")).samples).toBe(0);
      expect((await store.all()).length).toBe(1);
    } finally { sqlite.close(); }
  });
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
