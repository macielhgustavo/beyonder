import { Vault } from "@beyonder/compute";
import {
  createRuntime,
  DEFAULT_TASK_BUDGET,
  loadConfig,
  validatePlan,
  type Plan
} from "@beyonder/runtime";
import { nanoid } from "nanoid";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { defaultControlState } from "../data/local";
import type { ControlCenterState } from "../data/types";

export type ControlCommand =
  | { type: "submitObjective"; objective: string }
  | { type: "discoverOpportunities"; fixture?: boolean }
  | { type: "prepareApplication"; opportunityId: string }
  | { type: "approveAction"; approvalId: string }
  | { type: "rejectAction"; approvalId: string; reason?: string }
  | { type: "pauseRuntime" }
  | { type: "resumeRuntime" }
  | { type: "safeShutdown" }
  | { type: "emergencyStop" }
  | { type: "completeFirstRun" }
  | { type: "setDeveloperMode"; enabled: boolean }
  | { type: "setStartup"; enabled: boolean }
  | { type: "setSecret"; providerId: string; envVar: string; value: string; vaultPassword: string };

const CONTROL_STATE_KEY = "control-center:state";
const TASK_INDEX_KEY = "control-center:tasks:index";

export async function runControlCommand(command: ControlCommand) {
  switch (command.type) {
    case "submitObjective":
      return submitObjective(command.objective);
    case "discoverOpportunities":
      return discoverOpportunities(command.fixture ?? process.env.BEYONDER_CONTROL_FIXTURE === "1");
    case "prepareApplication":
      return prepareApplication(command.opportunityId);
    case "approveAction":
      return approveAction(command.approvalId);
    case "rejectAction":
      return rejectAction(command.approvalId, command.reason);
    case "pauseRuntime":
      return updateControlState({ paused: true, currentActivity: null }, "control.paused");
    case "resumeRuntime":
      return updateControlState({ paused: false, currentActivity: null }, "control.resumed");
    case "safeShutdown":
      return updateControlState({ paused: true, safeShutdownRequestedAt: new Date().toISOString(), currentActivity: "Safe shutdown requested" }, "control.safe_shutdown_requested");
    case "emergencyStop":
      return updateControlState({ paused: true, emergencyStopRequestedAt: new Date().toISOString(), currentActivity: "Emergency stop requested" }, "control.emergency_stop_requested");
    case "completeFirstRun":
      return updateControlState({ firstRunComplete: true }, "control.first_run_completed");
    case "setDeveloperMode":
      return updateControlState({ developerMode: command.enabled }, "control.developer_mode_changed");
    case "setStartup":
      return setStartup(command.enabled);
    case "setSecret":
      return setSecret(command);
  }
}

async function setStartup(enabled: boolean) {
  const target = `${homedir()}/.config/autostart/beyonder-control-center.desktop`;
  if (enabled) {
    const repoRoot = resolve(/*turbopackIgnore: true*/ process.cwd(), "../..");
    const exec = `bash -lc 'cd ${shellQuote(repoRoot)} && pnpm control-center:launch'`;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `[Desktop Entry]\nType=Application\nName=Beyonder\nComment=Start Beyonder Control Center\nExec=${exec}\nTerminal=false\nCategories=Development;Utility;\nStartupNotify=false\n`, { mode: 0o644 });
  } else {
    try {
      await unlink(target);
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
    }
  }
  const runtime = createRuntime(loadConfig());
  try {
    await runtime.audit.record("info", "control.startup_changed", { enabled });
  } finally {
    runtime.sqlite.close();
  }
  return { ok: true, startup: enabled ? "enabled" : "disabled" };
}

async function submitObjective(objective: string) {
  const normalized = objective.trim().replace(/\s+/g, " ");
  if (normalized.length < 3) throw new Error("Objective is too short.");
  const runtime = createRuntime(loadConfig());
  try {
    await assertNotPaused(runtime);
    await writeHeartbeat(runtime, `Executando: ${normalized}`);
    await runtime.audit.record("info", "control.objective.started", { objective: normalized });
    const inspection = await runtime.intelligence.inspect(normalized);
    const task = { ...inspection.task, id: `task_${nanoid()}` };
    const plan: Plan = {
      id: `plan_${nanoid()}`,
      taskId: task.id,
      objective: normalized,
      createdAt: new Date().toISOString(),
      revision: 1,
      assumptions: ["Control Center fixture-safe objective execution."],
      steps: [{
        id: "record-objective",
        description: "Registrar objetivo de forma segura",
        status: "PENDING",
        expectedOutcome: "Objetivo aceito e registrado",
        allowedToolCapabilities: ["objective-normalization"],
        action: { id: `call_${nanoid()}`, tool: "safe-objective", arguments: { objective: normalized } }
      }]
    };
    const availableTools = await runtime.getAvailableTools({ taskId: task.id, economicState: "normal" });
    const validation = validatePlan(plan, { availableTools, budget: DEFAULT_TASK_BUDGET });
    if (!validation.valid) throw new Error(`Control Center plan is invalid: ${validation.issues.map((issue) => issue.message).join("; ")}`);
    const outcome = await runtime.taskExecutor.execute({
      task,
      plan,
      economicState: "normal",
      completionCriteria: { expectedText: normalized.slice(0, Math.min(24, normalized.length)) },
      budget: { maxMonetaryCostUsd: 0, maxShadowCostUsd: 0.02, maxDurationMs: 30_000 }
    });
    await saveTask(runtime, outcome.execution);
    await runtime.audit.record(outcome.success ? "info" : "warn", outcome.success ? "control.objective.completed" : "control.objective.failed", { taskId: task.id, objective: normalized, status: outcome.status });
    await writeHeartbeat(runtime, null);
    return { ok: true, taskId: task.id, status: outcome.status, result: outcome.result ?? null };
  } finally {
    runtime.sqlite.close();
  }
}

async function discoverOpportunities(fixture: boolean) {
  const runtime = createRuntime(loadConfig());
  try {
    await assertNotPaused(runtime);
    await writeHeartbeat(runtime, "Pesquisando oportunidades...");
    const result = await runtime.opportunities.discover({ source: fixture ? "fixture" : undefined, limit: fixture ? 3 : 10 });
    const evaluations = [];
    for (const opportunity of result.opportunities) {
      evaluations.push(await runtime.opportunityEvaluator.evaluate(opportunity));
    }
    await runtime.audit.record(result.errors.length ? "warn" : "info", "control.opportunities.discovered", { count: result.opportunities.length, errors: result.errors });
    await writeHeartbeat(runtime, null);
    return { ok: true, count: result.opportunities.length, errors: result.errors, evaluations };
  } finally {
    runtime.sqlite.close();
  }
}

async function prepareApplication(opportunityId: string) {
  const runtime = createRuntime(loadConfig());
  try {
    await assertNotPaused(runtime);
    const realId = await resolveOpportunityId(runtime, opportunityId);
    const created = await runtime.workRunManager.start(realId);
    const prepared = await runtime.workRunManager.prepareApplication(created.id);
    await runtime.audit.record("info", "control.application_prepared", { workRunId: prepared.id, opportunityId: realId, approvalId: prepared.application?.approvalId });
    return { ok: true, workRunId: prepared.id, approvalId: prepared.application?.approvalId };
  } finally {
    runtime.sqlite.close();
  }
}

async function approveAction(approvalId: string) {
  const runtime = createRuntime(loadConfig());
  try {
    await assertNotPaused(runtime);
    const realId = await resolveApprovalId(runtime, approvalId);
    await runtime.approvals.approve(realId);
    const request = await runtime.approvals.inspect(realId);
    let consumed = false;
    if (request?.action === "APPLY_TO_OPPORTUNITY") {
      const runs = await runtime.workRunManager.list();
      const run = runs.find((candidate) => candidate.application?.approvalId === realId);
      if (run) {
        await runtime.workRunManager.sendApplication(run.id);
        consumed = true;
      }
    }
    await runtime.audit.record("info", "control.approval_decided", { approvalId: realId, status: consumed ? "CONSUMED" : "APPROVED" });
    return { ok: true, approvalId: realId, status: consumed ? "CONSUMED" : "APPROVED" };
  } finally {
    runtime.sqlite.close();
  }
}

async function rejectAction(approvalId: string, reason?: string) {
  const runtime = createRuntime(loadConfig());
  try {
    const realId = await resolveApprovalId(runtime, approvalId);
    await runtime.approvals.reject(realId, reason);
    await runtime.audit.record("info", "control.approval_decided", { approvalId: realId, status: "REJECTED" });
    return { ok: true, approvalId: realId, status: "REJECTED" };
  } finally {
    runtime.sqlite.close();
  }
}

async function setSecret(command: Extract<ControlCommand, { type: "setSecret" }>) {
  if (!command.value.trim()) throw new Error("Secret value is required.");
  const vault = new Vault();
  await vault.set(command.providerId, command.envVar, command.value, command.vaultPassword);
  const runtime = createRuntime(loadConfig());
  try {
    await runtime.audit.record("info", "control.secret_set", { providerId: command.providerId, envVar: command.envVar, status: "configured" });
  } finally {
    runtime.sqlite.close();
  }
  return { ok: true, providerId: command.providerId, envVar: command.envVar, status: "configured" };
}

async function updateControlState(patch: Partial<ControlCenterState>, event: string) {
  const runtime = createRuntime(loadConfig());
  try {
    const current = await runtime.state.get<ControlCenterState>(CONTROL_STATE_KEY, defaultControlState());
    const next = { ...current, ...patch, lastHeartbeatAt: new Date().toISOString() };
    await runtime.state.set(CONTROL_STATE_KEY, next);
    await runtime.audit.record("info", event, { paused: next.paused, developerMode: next.developerMode });
    return { ok: true, state: next };
  } finally {
    runtime.sqlite.close();
  }
}

async function writeHeartbeat(runtime: ReturnType<typeof createRuntime>, currentActivity: string | null) {
  const current = await runtime.state.get<ControlCenterState>(CONTROL_STATE_KEY, defaultControlState());
  await runtime.state.set(CONTROL_STATE_KEY, { ...current, currentActivity, lastHeartbeatAt: new Date().toISOString() });
}

async function assertNotPaused(runtime: ReturnType<typeof createRuntime>) {
  const state = await runtime.state.get<ControlCenterState>(CONTROL_STATE_KEY, defaultControlState());
  if (state.paused) throw new Error("Beyonder is paused. Resume before starting new work.");
}

async function saveTask(runtime: ReturnType<typeof createRuntime>, execution: unknown) {
  const id = typeof execution === "object" && execution && typeof (execution as { id?: unknown }).id === "string" ? (execution as { id: string }).id : `exec_${nanoid()}`;
  const index = await runtime.state.get<string[]>(TASK_INDEX_KEY, []);
  await runtime.state.set(TASK_INDEX_KEY, index.includes(id) ? index : [id, ...index]);
  await runtime.state.set(`control-center:task:${id}`, execution);
}

async function resolveOpportunityId(runtime: ReturnType<typeof createRuntime>, shortOrFull: string) {
  const all = await runtime.opportunityStore.list();
  return all.find((item) => item.id === shortOrFull || item.id.startsWith(shortOrFull))?.id ?? shortOrFull;
}

async function resolveApprovalId(runtime: ReturnType<typeof createRuntime>, shortOrFull: string) {
  const all = await runtime.approvals.list();
  return all.find((item) => item.approvalId === shortOrFull || item.approvalId.startsWith(shortOrFull))?.approvalId ?? shortOrFull;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
