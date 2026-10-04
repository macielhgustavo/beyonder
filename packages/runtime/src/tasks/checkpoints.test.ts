import { describe, expect, it } from "vitest";
import { DefaultToolPolicy, ToolExecutor, ToolRegistry, ToolRisk, ToolSideEffect, createToolInputSchema, type ToolDefinition } from "@beyonder/tools";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { openDatabase } from "../db/client.js";
import { StateStore } from "../memory/state-store.js";
import { StateTaskCheckpointStore } from "./checkpoints.js";
import { ExecutionLeaseConflictError, StateTaskExecutionLeaseStore } from "./execution-lease.js";
import { AutonomousTaskExecutor } from "./task-executor.js";
import { DEFAULT_TASK_BUDGET, type Plan, type TaskExecution } from "./contracts.js";
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
    expect(await store.inspect("bad")).toMatchObject({ status: "CHECKPOINT_VERSION_UNSUPPORTED", version: 99 });
    await expect(store.get("bad")).rejects.toMatchObject({ status: "CHECKPOINT_VERSION_UNSUPPORTED" });
    await state.set("task-checkpoint:broken", "not-an-execution");
    expect(await store.inspect("broken")).toMatchObject({ status: "CHECKPOINT_CORRUPT" });
    sqlite.prepare("UPDATE state SET value = ? WHERE key = ?").run("{not-json", "task-checkpoint:broken");
    expect(await store.inspect("broken")).toMatchObject({ status: "CHECKPOINT_CORRUPT" });
    expect(await store.inspect("missing")).toEqual({ status: "CHECKPOINT_NOT_FOUND" });
    sqlite.close();
  });

  it("reports checkpoint IO errors instead of treating them as absence", async () => {
    const database = openDatabase(":memory:");
    const store = new StateTaskCheckpointStore(new StateStore(database.db));
    database.sqlite.close();
    expect(await store.inspect("io")).toMatchObject({ status: "CHECKPOINT_IO_ERROR" });
    await expect(store.get("io")).rejects.toMatchObject({ status: "CHECKPOINT_IO_ERROR" });
  });

  it("does not charge process downtime against the resumed task duration budget", async () => {
    const { db, sqlite } = openDatabase(":memory:");
    const store = new StateTaskCheckpointStore(new StateStore(db));
    const saved: TaskExecution = {
      id: "downtime-execution", task: task(), plan: plan(), state: "WAITING",
      budget: { ...DEFAULT_TASK_BUDGET, maxDurationMs: 1_000 },
      usage: { steps: 0, toolInvocations: 0, retries: 0, replans: 0, durationMs: 100, monetaryCostUsd: 0, shadowCostUsd: 0, consecutiveFailures: 0, noProgressSteps: 0 },
      checkpoints: [], steps: [], startedAt: new Date(0).toISOString()
    };
    let now = 86_400_000;
    let calls = 0;
    const resumed = new AutonomousTaskExecutor({ toolExecutor: new ToolExecutor(new ToolRegistry().register(definition(() => { calls++; }))), checkpointStore: store, now: () => now });
    const outcome = await resumed.resume({ execution: saved, economicState: "normal", completionCriteria: { expectedText: "ok" } });
    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.execution.usage.durationMs).toBe(100);
    expect(calls).toBe(2);
    sqlite.close();
  });

  it("allows exactly one execution owner across independent SQLite connections", async () => {
    const directory = await mkdtemp(join(tmpdir(), "beyonder-lease-"));
    const path = join(directory, "runtime.sqlite");
    const firstDb = openDatabase(path);
    const secondDb = openDatabase(path);
    const firstLease = new StateTaskExecutionLeaseStore(new StateStore(firstDb.db));
    const secondLease = new StateTaskExecutionLeaseStore(new StateStore(secondDb.db));
    let releaseTool!: () => void;
    const held = new Promise<void>((resolve) => { releaseTool = resolve; });
    let calls = 0;
    const slow = definition(() => { calls++; });
    slow.execute = async () => { calls++; await held; return { output: "ok" }; };
    const first = new AutonomousTaskExecutor({ toolExecutor: new ToolExecutor(new ToolRegistry().register(slow)), executionLeaseStore: firstLease });
    const second = new AutonomousTaskExecutor({ toolExecutor: new ToolExecutor(new ToolRegistry().register(definition(() => { calls++; }))), executionLeaseStore: secondLease });
    const firstRun = first.execute({ task: task(), plan: plan(), economicState: "normal" });
    while (calls === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    await expect(second.execute({ task: task(), plan: plan(), economicState: "normal" })).rejects.toBeInstanceOf(ExecutionLeaseConflictError);
    releaseTool();
    await expect(firstRun).resolves.toMatchObject({ status: "COMPLETED" });
    expect(calls).toBe(2);
    firstDb.sqlite.close(); secondDb.sqlite.close();
  });

  it("rejects a second execution owner in another process and recovers a dead-owner lease", async () => {
    const directory = await mkdtemp(join(tmpdir(), "beyonder-process-lease-"));
    const path = join(directory, "runtime.sqlite");
    const fixture = fileURLToPath(new URL("./lease-owner-fixture.ts", import.meta.url));
    const child = spawn(process.execPath, ["--import", "tsx", fixture, path, "cross-process-task"], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`lease owner did not start: ${stderr}`)), 10_000);
      child.stdout.on("data", (chunk) => { if (String(chunk).includes("LEASE_ACQUIRED")) { clearTimeout(timer); resolve(); } });
      child.once("error", reject);
    });
    const contenderDb = openDatabase(path);
    const contender = new StateTaskExecutionLeaseStore(new StateStore(contenderDb.db));
    await expect(contender.acquire("cross-process-task", "contender")).rejects.toBeInstanceOf(ExecutionLeaseConflictError);
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
    const recovered = await contender.acquire("cross-process-task", "recovered");
    expect(recovered.executionId).toBe("recovered");
    await contender.release(recovered);
    contenderDb.sqlite.close();
  }, 20_000);

  it("blocks an interrupted side effect as reconciliation required and never retries it", async () => {
    const { db, sqlite } = openDatabase(":memory:");
    let calls = 0;
    const external = definition(() => { calls++; });
    external.id = "external";
    external.sideEffects = ToolSideEffect.EXTERNAL_ACTION;
    const store = new StateTaskCheckpointStore(new StateStore(db));
    const execution: TaskExecution = {
      id: "ambiguous", task: task(), plan: { ...plan(), steps: [{ id: "one", description: "external", status: "RUNNING", action: { id: "external-call", tool: "external", arguments: {} } }] }, state: "RUNNING",
      budget: DEFAULT_TASK_BUDGET, usage: { steps: 1, toolInvocations: 0, retries: 0, replans: 0, durationMs: 1, monetaryCostUsd: 0, shadowCostUsd: 0, consecutiveFailures: 0, noProgressSteps: 0 }, checkpoints: [], startedAt: new Date().toISOString(),
      steps: [{ id: "running", stepId: "one", attempt: 1, status: "RUNNING", startedAt: new Date().toISOString(), toolCall: { id: "external-call", tool: "external", arguments: {} }, toolSideEffects: [ToolSideEffect.EXTERNAL_ACTION] }]
    };
    const executor = new AutonomousTaskExecutor({ toolExecutor: new ToolExecutor(new ToolRegistry().register(external)), checkpointStore: store, getAvailableTools: async () => new ToolRegistry().register(external).getAvailableTools() });
    const outcome = await executor.resume({ execution, economicState: "normal" });
    expect(outcome).toMatchObject({ status: "BLOCKED", success: false, execution: { reconciliationRequired: { reason: "OUTCOME_UNKNOWN", tool: "external" } } });
    expect(calls).toBe(0);
    expect((await store.get("resume-task"))?.state).toBe("BLOCKED");
    sqlite.close();
  });

  it("does not blindly retry a side effect when its response is lost", async () => {
    let calls = 0;
    const external = definition(() => undefined);
    external.id = "external-timeout";
    external.sideEffects = ToolSideEffect.EXTERNAL_ACTION;
    external.execute = async () => { calls++; throw new Error("response lost after dispatch"); };
    const registry = new ToolRegistry().register(external);
    const executor = new AutonomousTaskExecutor({ toolExecutor: new ToolExecutor(registry, { policy: new DefaultToolPolicy({ allowedSideEffects: [ToolSideEffect.EXTERNAL_ACTION] }) }), getAvailableTools: async () => registry.getAvailableTools() });
    const externalPlan: Plan = { ...plan(), steps: [{ id: "one", description: "external", status: "PENDING", action: { id: "call", tool: external.id, arguments: {} } }] };
    const outcome = await executor.execute({ task: task(), plan: externalPlan, economicState: "normal" });
    expect(outcome).toMatchObject({ status: "BLOCKED", success: false, execution: { reconciliationRequired: { reason: "OUTCOME_UNKNOWN", tool: external.id }, usage: { retries: 0 } } });
    expect(calls).toBe(1);
  });
});
