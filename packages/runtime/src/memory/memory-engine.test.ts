import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../db/client.js";
import type { IntelligenceTask, TaskOutcome } from "../intelligence/contracts.js";
import { MemoryEngine } from "./memory-engine.js";
import { MemoryStore } from "./memory-store.js";

const open = new Set<Database.Database>();

afterEach(() => {
  for (const sqlite of open) sqlite.close();
  open.clear();
});

function createMemory() {
  const { sqlite, db } = openDatabase(":memory:");
  open.add(sqlite);
  const store = new MemoryStore(db);
  return { store, engine: new MemoryEngine(store) };
}

describe("MemoryEngine v2", () => {
  it("keeps working memory ephemeral", async () => {
    const { store, engine } = createMemory();
    await engine.remember("working", "temporary execution context", 3);

    expect(await store.all()).toHaveLength(0);
    const results = await engine.retrieve({ query: "temporary context" });
    expect(results[0]?.kind).toBe("working");
    expect(results[0]?.accessCount).toBe(1);
  });

  it("persists episodic, semantic, procedural, and economic memory", async () => {
    const { store, engine } = createMemory();
    await engine.remember("episodic", "task completed safely", 3);
    await engine.remember("semantic", "the runtime defaults to zero cost", 4);
    await engine.remember("procedural", "use safe-objective for side-effect-free checks", 4);
    await engine.remember("economic", "monetary cost was zero", 3);

    const records = await store.all();
    expect(records.map((record) => record.kind)).toEqual(
      expect.arrayContaining(["episodic", "semantic", "procedural", "economic"])
    );
    expect(await engine.stats()).toMatchObject({ episodic: 1, semantic: 1, procedural: 1, economic: 1 });
  });

  it("updates accessCount and lastAccessedAt when retrieval uses a persistent memory", async () => {
    const { store, engine } = createMemory();
    const record = await engine.remember("semantic", "alpha runtime fact", 3, { utility: 0.7 });
    const before = await store.get(record.id);

    const results = await engine.retrieve({ query: "alpha runtime" });
    const after = await store.get(record.id);

    expect(results[0]?.id).toBe(record.id);
    expect(before?.accessCount).toBe(0);
    expect(after?.accessCount).toBe(1);
    expect(Date.parse(after!.lastAccessedAt)).toBeGreaterThanOrEqual(Date.parse(before!.lastAccessedAt));
  });

  it("uses importance as a configurable ranking signal", async () => {
    const { engine } = createMemory();
    await engine.remember("semantic", "importance signal alpha", 1, { utility: 0.5 });
    const high = await engine.remember("semantic", "importance signal alpha", 5, { utility: 0.5 });

    const results = await engine.retrieve({ query: "importance signal alpha", limit: 2 });
    expect(results[0]?.id).toBe(high.id);
  });

  it("uses utility as a ranking signal", async () => {
    const { engine } = createMemory();
    await engine.remember("procedural", "utility signal beta", 3, { utility: 0.1 });
    const useful = await engine.remember("procedural", "utility signal beta", 3, { utility: 1 });

    const results = await engine.retrieve({ query: "utility signal beta", limit: 2 });
    expect(results[0]?.id).toBe(useful.id);
  });

  it("uses recency as a ranking signal", async () => {
    const { engine } = createMemory();
    await engine.remember("semantic", "recency signal gamma", 3, {
      utility: 0.5,
      createdAt: new Date(Date.now() - 90 * 86_400_000).toISOString()
    });
    const recent = await engine.remember("semantic", "recency signal gamma", 3, {
      utility: 0.5,
      createdAt: new Date().toISOString()
    });

    const results = await engine.retrieve({ query: "recency signal gamma", limit: 2 });
    expect(results[0]?.id).toBe(recent.id);
  });

  it("records task outcomes as episodic and economic memory", async () => {
    const { store, engine } = createMemory();
    const task: IntelligenceTask = {
      id: "task_test",
      input: "Implement a safe parser",
      type: "coding",
      complexity: 0.6,
      risk: 0.1,
      estimatedTokens: 900,
      requirements: { reasoning: true }
    };
    const outcome: TaskOutcome = {
      task,
      attempts: [],
      success: true,
      result: "parser implemented",
      evaluation: { score: 0.9, passed: true },
      provider: "test-provider",
      model: "test-model",
      tokens: 700,
      monetaryCostUsd: 0,
      shadowCostUsd: 0,
      latencyMs: 42,
      tools: ["safe-objective"],
      quotaConsumed: 1,
      completedAt: new Date().toISOString()
    };

    const saved = await engine.recordOutcome(outcome);
    const records = await store.all();

    expect(saved.episodic.kind).toBe("episodic");
    expect(saved.economic.kind).toBe("economic");
    expect(saved.economic.metadata).toMatchObject({
      provider: "test-provider",
      model: "test-model",
      taskType: "coding",
      tokens: 700,
      monetaryCostUsd: 0,
      shadowCostUsd: 0,
      success: true,
      evaluationScore: 0.9,
      quotaConsumed: 1
    });
    expect(records.filter((record) => record.taskId === task.id)).toHaveLength(2);
  });
});
