import { describe, expect, it } from "vitest";
import { ToolExecutor, ToolRegistry, ToolRisk, ToolSideEffect, createToolInputSchema, type ToolDefinition } from "@beyonder/tools";
import { openDatabase } from "../db/client.js";
import { StateStore } from "../memory/state-store.js";
import { StateTaskCheckpointStore } from "./checkpoints.js";
import { AutonomousTaskExecutor } from "./task-executor.js";
import type { Plan } from "./contracts.js";
import type { IntelligenceTask } from "../intelligence/contracts.js";

function task(): IntelligenceTask { return { id: "resume-task", input: "resume", type: "tool-use", complexity: 0.1, risk: 0, estimatedTokens: 20, requirements: {} }; }
function plan(): Plan { return { id: "resume-plan", taskId: "resume-task", objective: "resume", createdAt: new Date(0).toISOString(), revision: 1, steps: [
  { id: "one", description: "one", status: "PENDING", action: { id: "one-call", tool: "fixture", arguments: {} } },
  { id: "two", description: "two", status: "PENDING", action: { id: "two-call", tool: "fixture", arguments: {} }, dependencies: ["one"] }
] }; }
function definition(onExecute: () => void): ToolDefinition {
  return { id: "fixture", name: "fixture", description: "fixture", inputSchema: createToolInputSchema((input) => ({ success: true as const, data: input })), risk: ToolRisk.LOW, sideEffects: ToolSideEffect.READ, execute: async () => { onExecute(); return { output: "ok" }; } };
}

describe("task checkpoint persistence", () => {
  it("recreates the executor and resumes after the last completed step", async () => {
    const { db, sqlite } = openDatabase(":memory:");
    const store = new StateTaskCheckpointStore(new StateStore(db));
    const firstAbort = new AbortController();
    let firstCalls = 0;
    const first = new AutonomousTaskExecutor({ toolExecutor: new ToolExecutor(new ToolRegistry().register(definition(() => { firstCalls += 1; firstAbort.abort(); }))), checkpointStore: store });
    const interrupted = await first.execute({ task: task(), plan: plan(), economicState: "normal", signal: firstAbort.signal });
    expect(interrupted.status).toBe("CANCELLED");
    expect(firstCalls).toBe(1);
    const saved = await store.get("resume-task");
    expect(saved?.plan.steps.find((step) => step.id === "one")?.status).toBe("COMPLETED");
    expect(saved?.plan.steps.find((step) => step.id === "two")?.status).toBe("PENDING");
    expect(saved?.usage.toolInvocations).toBe(1);

    let resumedCalls = 0;
    const second = new AutonomousTaskExecutor({ toolExecutor: new ToolExecutor(new ToolRegistry().register(definition(() => { resumedCalls += 1; }))), checkpointStore: store });
    const completed = await second.resume({ execution: saved!, economicState: "normal", completionCriteria: { expectedText: "ok" } });
    expect(completed.status).toBe("COMPLETED");
    expect(resumedCalls).toBe(1);
    expect(completed.execution.usage.toolInvocations).toBe(2);
    sqlite.close();
  });

  it("checkpoints a paused task and continues only after resume", async () => {
    const { db, sqlite } = openDatabase(":memory:");
    const store = new StateTaskCheckpointStore(new StateStore(db));
    let paused = false;
    let calls = 0;
    let waited = false;
    const states: string[] = [];
    const executor = new AutonomousTaskExecutor({
      toolExecutor: new ToolExecutor(new ToolRegistry().register(definition(() => { calls++; if (calls === 1) paused = true; }))),
      checkpointStore: store,
      onProgress: async (execution) => { states.push(execution.state); },
      isPaused: async () => {
        if (paused && states.includes("WAITING")) {
          expect(calls).toBe(1);
          expect((await store.get("resume-task"))?.state).toBe("WAITING");
          waited = true;
          paused = false;
        }
        return paused;
      }
    });
    try {
      const result = await executor.execute({ task: task(), plan: plan(), economicState: "normal" });
      expect(waited).toBe(true); expect(calls).toBe(2); expect(result.status).toBe("COMPLETED");
    } finally { sqlite.close(); }
  });

  it("rejects corrupted or incompatible checkpoints safely", async () => {
    const { db, sqlite } = openDatabase(":memory:");
    const state = new StateStore(db);
    const store = new StateTaskCheckpointStore(state);
    await state.set("task-checkpoint:bad", { version: 99, execution: {} });
    expect(await store.get("bad")).toBeUndefined();
    await state.set("task-checkpoint:broken", "not-an-execution");
    expect(await store.get("broken")).toBeUndefined();
    sqlite.close();
  });
});
