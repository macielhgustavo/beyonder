import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRuntime, DEFAULT_TASK_BUDGET, loadConfig, ModelRouter, LlmPlanner, normalizeOpportunity, ToolSideEffect, type TaskExecution } from "@beyonder/runtime";
import { queueControlObjective, runControlCommand } from "../control/commands";
import { markInterruptedTasks } from "../control/heartbeat";
import { CapacityAwareDashboardDataSource } from "../data/capacity-aware";
import { LocalDashboardDataSource, safeExternalUrl } from "../data/local";
import { validateCommand } from "../control/validation";
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "control-hardening-"));
  vi.stubEnv("BEYONDER_DB_PATH", path.join(dir, "runtime.sqlite"));
  vi.stubEnv("BEYONDER_PROVIDER_STATE_PATH", path.join(dir, "providers.json"));
  vi.stubEnv("BEYONDER_MODEL_PROVIDER", "none");
  vi.stubEnv("BEYONDER_CONTROL_FIXTURE", "0");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

describe("real operation honesty", () => {
  it("keeps intermediate execution failure live until objective verification is persisted", async () => {
    const runtime = createRuntime(loadConfig());
    try {
      const taskId = "task_verification_boundary";
      await runtime.state.set("control-center:tasks:index", [taskId]);
      const execution = { id: taskId, task: { id: taskId, input: "Explain a concept" }, state: "FAILED", executionPhase: "EXECUTING", plan: { objective: "Explain a concept", steps: [] }, usage: {}, steps: [], startedAt: new Date().toISOString() };
      await runtime.state.set(`control-center:task:${taskId}`, execution);
      const source = new LocalDashboardDataSource(process.env.BEYONDER_DB_PATH);
      expect(await source.getTask(taskId)).toMatchObject({ status: "running", humanStatus: "Verificando o resultado antes de encerrar a missão.", resultVerified: false });
      await runtime.state.set(`control-center:task:${taskId}`, { ...execution, state: "BLOCKED", objectiveStatus: "NEEDS_CAPABILITY", executionPhase: "EXECUTION_FINISHED", completedAt: new Date().toISOString() });
      expect(await source.getTask(taskId)).toMatchObject({ status: "blocked", objectiveStatus: "NEEDS_CAPABILITY", resultVerified: false });
    } finally { runtime.sqlite.close(); }
  });
  it("persists a mission identity before asynchronous execution and preserves it through completion", async () => {
    vi.stubEnv("BEYONDER_CONTROL_FIXTURE", "1");
    const queued = await queueControlObjective("Execute a persistent fixture mission");
    expect(queued.response).toMatchObject({ ok: true, status: "PLANNING", taskId: expect.stringMatching(/^task_/) });
    const source = new LocalDashboardDataSource(process.env.BEYONDER_DB_PATH);
    expect(await source.getTask(queued.response.taskId)).toMatchObject({ status: "planning", taskId: queued.response.taskId, resultVerified: false });
    const completed = await queued.run();
    expect(completed).toMatchObject({ ok: true, status: "COMPLETED", taskId: queued.response.taskId });
    expect(await source.getTask(queued.response.taskId)).toMatchObject({ status: "succeeded", taskId: queued.response.taskId, resultVerified: true, objectiveStatus: "SUCCEEDED" });
  });
  it("uses the real planner and calculator without unnecessary model inference", async () => {
    const planner = vi.spyOn(LlmPlanner.prototype, "createPlan");
    const completion = vi.spyOn(ModelRouter.prototype, "completeForPlanningCandidate");
    const result = await runControlCommand({ type: "submitObjective", objective: "Calculate 2 plus 3" });
    expect(result).toMatchObject({ ok: true, status: "COMPLETED" });
    expect(planner).toHaveBeenCalledOnce(); expect(completion).not.toHaveBeenCalled();
    const source = new LocalDashboardDataSource(process.env.BEYONDER_DB_PATH);
    const tasks = await source.getTasks();
    expect(tasks).toHaveLength(1); expect(tasks[0].result).toBe("5"); expect(tasks[0].fixture).toBe(false);
    const events = await source.getAuditEvents({ limit: 100 });
    expect(events.some((event) => event.event === "plan.created")).toBe(true);
    expect(events.some((event) => event.event === "tool.completed")).toBe(true);
  });
  it("persists planning capacity failure as BLOCKED / NEEDS_CAPABILITY", async () => {
    const queued = await queueControlObjective("Use a calculadora para somar uma lista contendo 16, 28 e 43");
    expect(await queued.run()).toMatchObject({ ok: false, status: "BLOCKED" });
    const mission = await new CapacityAwareDashboardDataSource(new LocalDashboardDataSource(process.env.BEYONDER_DB_PATH)).getTask(queued.response.taskId);
    expect(mission).toMatchObject({ status: "blocked", objectiveStatus: "NEEDS_CAPABILITY", executionPhase: "EXECUTION_FINISHED", resultVerified: false });
    expect(mission?.failureSummary).not.toContain("regras de segurança");
  });
  it("fails visibly without a provider and does not fabricate completion", async () => {
    await expect(runControlCommand({ type: "submitObjective", objective: "Pesquisar dados" })).resolves.toMatchObject({ ok: false, status: "BLOCKED" });
    const tasks = await new CapacityAwareDashboardDataSource(new LocalDashboardDataSource(process.env.BEYONDER_DB_PATH)).getTasks();
    expect(tasks[0].status).toBe("blocked"); expect(tasks[0].objectiveStatus).toBe("NEEDS_CAPABILITY"); expect(tasks[0].result).toBeNull(); expect(tasks[0].failureSummary).toContain("Nenhum modelo disponível");
  });
  it("does not send an application or submission merely because a human approved", async () => {
    const runtime = createRuntime(loadConfig());
    try {
      const opportunity = normalizeOpportunity({ source: "github", sourceItemId: "manual-1", sourceUrl: "https://github.com/example/repo/issues/1", title: "Manual work", description: "Test work", type: "CODING", requiredCapabilities: ["coding"], metadata: { requiresApplication: true, requiresSubmission: true } });
      await runtime.opportunityStore.upsert(opportunity);
      const run = await runtime.workRunManager.prepareApplication((await runtime.workRunManager.start(opportunity.id)).id);
      await runControlCommand({ type: "approveAction", approvalId: run.application!.approvalId! });
      let current = (await runtime.workRunManager.inspect(run.id))!;
      expect(current.state).toBe("MANUAL_APPLICATION_REQUIRED"); expect(current.realizedRewardUsd).toBe(0);
      expect((await runtime.approvals.inspect(run.application!.approvalId!))?.status).toBe("APPROVED");
      await runControlCommand({ type: "confirmApplication", workRunId: run.id, externalReference: "external-app-1" });
      current = (await runtime.workRunManager.inspect(run.id))!;
      expect(current.state).toBe("APPLICATION_SENT"); expect(current.application?.externalEvidence?.executedBy).toBe("HUMAN");
      expect((await runtime.approvals.inspect(run.application!.approvalId!))?.status).toBe("CONSUMED");
      await expect(runControlCommand({ type: "confirmApplication", workRunId: run.id })).rejects.toThrow();
      await runtime.workRunManager.markWorkAvailable(run.id); await runtime.workRunManager.beginExecution(run.id, "manual-task");
      await runtime.workRunManager.completeExecution(run.id, { taskId: "manual-task", status: "COMPLETED", monetaryCostUsd: 0, shadowCostUsd: 0 });
      await runtime.workRunManager.createDeliverable(run.id, { type: "TEXT", summary: "Verified work", text: "Deliverable" });
      await runtime.workRunManager.verifyDeliverable(run.id, "PASS", "Verification passed");
      current = await runtime.workRunManager.requestSubmissionApproval(run.id);
      const approvalId = current.deliverable!.metadata!.submissionApprovalId as string;
      await runControlCommand({ type: "approveAction", approvalId });
      current = (await runtime.workRunManager.inspect(run.id))!;
      expect(current.state).toBe("MANUAL_SUBMISSION_REQUIRED"); expect((await runtime.approvals.inspect(approvalId))?.status).toBe("APPROVED");
      await expect(runControlCommand({ type: "recordSettlement", workRunId: run.id, amount: 5, currency: "USD", source: "bank", externalReference: "pay-1" })).rejects.toThrow();
      await runControlCommand({ type: "confirmSubmission", workRunId: run.id, externalReference: "submission-1" });
      current = (await runtime.workRunManager.inspect(run.id))!; expect(current.state).toBe("AWAITING_SETTLEMENT"); expect(current.realizedRewardUsd).toBe(0);
      await runControlCommand({ type: "recordSettlement", workRunId: run.id, amount: 5, currency: "USD", source: "bank", externalReference: "pay-1" });
      expect((await runtime.workRunManager.inspect(run.id))?.realizedRewardUsd).toBe(5);
      const views = await new LocalDashboardDataSource(process.env.BEYONDER_DB_PATH).getWorkRuns(); expect(views[0].settlement?.evidence.externalReference).toBe("pay-1");
    } finally { runtime.sqlite.close(); }
  });
  it("blocks every new work command while paused", async () => {
    await runControlCommand({ type: "pauseRuntime" });
    for (const command of [{ type: "submitObjective", objective: "Do work" }, { type: "discoverOpportunities" }, { type: "prepareApplication", opportunityId: "any" }, { type: "approveAction", approvalId: "any" }, { type: "confirmApplication", workRunId: "any" }, { type: "confirmSubmission", workRunId: "any" } ] as const) await expect(runControlCommand(command)).rejects.toThrow("paused");
    await runControlCommand({ type: "resumeRuntime" });
    vi.stubEnv("BEYONDER_CONTROL_FIXTURE", "1");
    expect(await runControlCommand({ type: "submitObjective", objective: "Do deterministic work" })).toMatchObject({ ok: true });
  });
  it("never infers READY from an existing database or a pause flag", async () => {
    const runtime = createRuntime(loadConfig());
    try { await runtime.state.set("control-center:state", { paused: true, lastHeartbeatAt: new Date(Date.now() - 70_000).toISOString() });
      expect((await new LocalDashboardDataSource(process.env.BEYONDER_DB_PATH).getRuntimeStatus()).global).toBe("OFFLINE");
      await runtime.state.set("control-center:state", { paused: false, lastHeartbeatAt: new Date(Date.now() - 18_000).toISOString() });
      expect((await new LocalDashboardDataSource(process.env.BEYONDER_DB_PATH).getRuntimeStatus()).global).toBe("DEGRADED");
    } finally { runtime.sqlite.close(); }
  });
  it("surfaces interrupted work and resumes from its checkpoint without repeating completed steps", async () => {
    vi.stubEnv("BEYONDER_CONTROL_FIXTURE", "1");
    const execution = resumableExecution("resume-safe");
    const runtime = createRuntime(loadConfig(), { fixture: true });
    try {
      await runtime.checkpoints.save(execution);
      await runtime.state.set("control-center:tasks:index", [execution.id]);
      await runtime.state.set(`control-center:task:${execution.id}`, execution);
      await markInterruptedTasks(runtime);
    } finally { runtime.sqlite.close(); }
    const before = (await new LocalDashboardDataSource(process.env.BEYONDER_DB_PATH).getTasks())[0];
    expect(before).toMatchObject({ status: "waiting", canResume: true, resumeTaskId: "resume-safe", result: null });
    const result = await runControlCommand({ type: "resumeTask", taskId: "resume-safe" });
    expect(result).toMatchObject({ ok: true, status: "COMPLETED" });
    const after = (await new LocalDashboardDataSource(process.env.BEYONDER_DB_PATH).getTasks())[0];
    expect(after).toMatchObject({ status: "succeeded", canResume: false });
    const resumedRuntime = createRuntime(loadConfig(), { fixture: true });
    try {
      const checkpoint = await resumedRuntime.checkpoints.get("resume-safe");
      expect(checkpoint?.usage.toolInvocations).toBe(2);
      expect(checkpoint?.plan.steps[0].status).toBe("COMPLETED");
    } finally { resumedRuntime.sqlite.close(); }
    await expect(runControlCommand({ type: "resumeTask", taskId: "resume-safe" })).rejects.toThrow("já terminou");
  });
  it("never replays an interrupted action whose tool is unavailable or externally mutating", async () => {
    vi.stubEnv("BEYONDER_CONTROL_FIXTURE", "1");
    const execution = resumableExecution("resume-unsafe");
    execution.plan.steps[1].status = "RUNNING";
    execution.plan.steps[1].action = { id: "external-call", tool: "external.write", arguments: {} };
    execution.steps.push({ id: "in-flight", stepId: "two", attempt: 1, status: "RUNNING", startedAt: new Date().toISOString(), toolCall: execution.plan.steps[1].action });
    const runtime = createRuntime(loadConfig(), { fixture: true });
    try { await runtime.checkpoints.save(execution); } finally { runtime.sqlite.close(); }
    const startup = createRuntime(loadConfig(), { fixture: true });
    try {
      await startup.state.set("control-center:tasks:index", [execution.id]);
      await startup.state.set(`control-center:task:${execution.id}`, execution);
      await markInterruptedTasks(startup);
    } finally { startup.sqlite.close(); }
    const view = (await new LocalDashboardDataSource(process.env.BEYONDER_DB_PATH).getTasks())[0];
    expect(view).toMatchObject({ status: "blocked", canResume: false, result: null });
    expect(view.humanStatus).toContain("RECONCILIATION_REQUIRED");
    await expect(runControlCommand({ type: "resumeTask", taskId: "resume-unsafe" })).rejects.toThrow("já terminou");
    const reader = createRuntime(loadConfig(), { fixture: true });
    try { expect((await reader.checkpoints.get("resume-unsafe"))?.usage.toolInvocations).toBe(1); } finally { reader.sqlite.close(); }
  });
  it("does not offer a false resume action when the process stopped before any checkpoint", async () => {
    const execution = resumableExecution("no-checkpoint");
    const runtime = createRuntime(loadConfig(), { fixture: true });
    try {
      await runtime.state.set("control-center:tasks:index", [execution.id]);
      await runtime.state.set(`control-center:task:${execution.id}`, execution);
      await markInterruptedTasks(runtime);
    } finally { runtime.sqlite.close(); }
    const task = (await new LocalDashboardDataSource(process.env.BEYONDER_DB_PATH).getTasks())[0];
    expect(task).toMatchObject({ status: "blocked", canResume: false, result: null, humanStatus: "Execução interrompida antes de um checkpoint recuperável." });
  });
  it.each([
    ["corrupt", "{broken", "CHECKPOINT_CORRUPT"],
    ["version", JSON.stringify({ version: 99, execution: {} }), "CHECKPOINT_VERSION_UNSUPPORTED"]
  ])("surfaces %s checkpoint truth as blocked attention", async (_name, raw, reason) => {
    const execution = resumableExecution(`checkpoint-${_name}`);
    const runtime = createRuntime(loadConfig(), { fixture: true });
    try {
      await runtime.state.set("control-center:tasks:index", [execution.id]);
      await runtime.state.set(`control-center:task:${execution.id}`, execution);
      runtime.sqlite.prepare("INSERT INTO state(key,value,updated_at) VALUES(?,?,?)").run(`task-checkpoint:${execution.task.id}`, raw, new Date().toISOString());
      await markInterruptedTasks(runtime);
    } finally { runtime.sqlite.close(); }
    const task = (await new LocalDashboardDataSource(process.env.BEYONDER_DB_PATH).getTasks())[0];
    expect(task).toMatchObject({ status: "blocked", canResume: false, result: null });
    expect(task.humanStatus).toContain(reason);
  });
});

describe("fixture isolation", () => {
  it("excludes deterministic objective tools and fixture sources from the real runtime", async () => {
    const real = createRuntime(loadConfig());
    const fixture = createRuntime(loadConfig(), { fixture: true });
    try {
      expect((await real.getAvailableTools()).some((tool) => tool.id === "safe-objective")).toBe(false);
      expect((await real.opportunities.discover({ source: "fixture" })).opportunities).toHaveLength(0);
      expect((await fixture.getAvailableTools()).some((tool) => tool.id === "safe-objective")).toBe(true);
      expect((await fixture.opportunities.discover({ source: "fixture" })).opportunities.length).toBeGreaterThan(0);
    } finally { real.sqlite.close(); fixture.sqlite.close(); }
  });
});

describe("strict command boundaries", () => {
  it("rejects malformed values, surplus fields and arbitrary credential env vars", () => {
    for (const payload of [{ type: "submitObjective", objective: [] }, { type: "submitObjective", objective: "x".repeat(8001) }, { type: "resumeTask" }, { type: "resumeTask", taskId: "x", extra: true }, { type: "pauseRuntime", path: "/etc/passwd" }, { type: "approveAction" }, { type: "setSecret", providerId: "groq", envVar: "PATH", value: "key", vaultPassword: "password-1234" }, { type: "discoverOpportunities", fixture: true }]) expect(() => validateCommand(payload)).toThrow();
  });
  it("allows only persisted HTTP(S) opportunity URLs", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeUndefined(); expect(safeExternalUrl("file:///etc/passwd")).toBeUndefined(); expect(safeExternalUrl("https://example.com/work")).toBe("https://example.com/work");
  });
});

function resumableExecution(taskId: string): TaskExecution {
  const startedAt = new Date().toISOString();
  return {
    id: `exec-${taskId}`,
    task: { id: taskId, input: "Resume safely", type: "tool-use", complexity: 0.1, risk: 0, estimatedTokens: 20, requirements: { toolUse: true } },
    plan: { id: `plan-${taskId}`, taskId, objective: "Resume safely", createdAt: startedAt, revision: 1, steps: [
      { id: "one", description: "Already completed", status: "COMPLETED", action: { id: "one-call", tool: "safe-objective", arguments: { objective: "Already completed" } } },
      { id: "two", description: "Continue safely", status: "PENDING", dependencies: ["one"], action: { id: "two-call", tool: "safe-objective", arguments: { objective: "Resume safely" } } }
    ] },
    state: "RUNNING",
    budget: { ...DEFAULT_TASK_BUDGET, maxMonetaryCostUsd: 0 },
    usage: { steps: 1, toolInvocations: 1, retries: 0, replans: 0, durationMs: 10, monetaryCostUsd: 0, shadowCostUsd: 0, consecutiveFailures: 0, noProgressSteps: 0 },
    checkpoints: [],
    steps: [{ id: "completed", stepId: "one", attempt: 1, status: "COMPLETED", startedAt, completedAt: startedAt, toolCall: { id: "one-call", tool: "safe-objective", arguments: { objective: "Already completed" } }, toolResult: { success: true, output: "ok", durationMs: 1, sideEffects: [ToolSideEffect.NONE] }, observationSummary: "ok" }],
    startedAt
  };
}
