import { Vault, providers, CredentialBroker, validateProviderDetailed, AutopilotStateStore } from "@beyonder/compute";
import {
  createRuntime,
  DEFAULT_TASK_BUDGET,
  classifyEconomicState,
  findReconciliationRequired,
  loadConfig,
  validatePlan,
  type Plan,
  type IntelligenceTask,
  type TaskExecution,
  type ToolDescriptor
} from "@beyonder/runtime";
import { nanoid } from "nanoid";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { defaultControlState, resolveDashboardDbPath, resolveProviderStatePath } from "../data/local";
import type { ControlCenterState } from "../data/types";

export type ControlCommand =
  | { type: "submitObjective"; objective: string }
  | { type: "resumeTask"; taskId: string }
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
  | { type: "confirmApplication" | "confirmSubmission"; workRunId: string; externalReference?: string; notes?: string }
  | { type: "recordSettlement"; workRunId: string; amount: number; currency: "USD" | "USDC"; source: string; externalReference: string }
  | { type: "setSecret"; providerId: string; envVar: string; value: string; vaultPassword: string };

const root = globalThis as typeof globalThis & { beyonderControl?: { stopping: boolean; emergency: boolean; shutdownResponseSent: boolean; active: number; controllers: Set<AbortController>; browsers: Set<ReturnType<typeof createRuntime>["browser"]>; serial: Promise<void> } };
const lifecycle = root.beyonderControl ??= { stopping: false, emergency: false, shutdownResponseSent: false, active: 0, controllers: new Set(), browsers: new Set(), serial: Promise.resolve() };
export function shutdownReady() { return lifecycle.stopping && lifecycle.shutdownResponseSent && lifecycle.active === 0; }
export function markShutdownResponseSent() { lifecycle.shutdownResponseSent = true; }
export function loadControlConfig() { return loadConfig({ BEYONDER_DB_PATH: resolveDashboardDbPath(), BEYONDER_PROVIDER_STATE_PATH: resolveProviderStatePath(), BEYONDER_TOOLS_ENABLED: process.env.BEYONDER_TOOLS_ENABLED ?? "1", BEYONDER_BROWSER_ENABLED: process.env.BEYONDER_BROWSER_ENABLED ?? "1" }); }
function controlRuntime() { const runtime = createRuntime(loadControlConfig(), { fixture: process.env.BEYONDER_CONTROL_FIXTURE === "1", onProgress: async (execution) => {
  const writer = createRuntime(loadControlConfig());
  try { await saveTask(writer, execution); } finally { writer.sqlite.close(); }
}, isPaused: async () => {
  const reader = createRuntime(loadControlConfig());
  try { const state = await reader.state.get<ControlCenterState>("control-center:state", defaultControlState()); return state.paused && !state.safeShutdownRequestedAt && !state.emergencyStopRequestedAt && !lifecycle.stopping; } finally { reader.sqlite.close(); }
}, beforeStep: async () => {
  const reader = createRuntime(loadControlConfig());
  try { await assertNotPaused(reader); } finally { reader.sqlite.close(); }
} }); lifecycle.browsers.add(runtime.browser); return runtime; }
async function closeRuntime(runtime: ReturnType<typeof createRuntime>) { try { await runtime.browser.closeAll(); } finally { lifecycle.browsers.delete(runtime.browser); runtime.sqlite.close(); } }

const CONTROL_STATE_KEY = "control-center:state";
const TASK_INDEX_KEY = "control-center:tasks:index";

export async function runControlCommand(command: ControlCommand) {
  const serial = ["resumeTask", "prepareApplication", "approveAction", "confirmApplication", "confirmSubmission", "recordSettlement", "setSecret", "setStartup"].includes(command.type);
  const tracked = serial || command.type === "discoverOpportunities";
  const previous = lifecycle.serial;
  let release = () => {};
  if (serial) lifecycle.serial = new Promise<void>((resolve) => { release = resolve; });
  if (tracked) lifecycle.active++;
  try {
    if (serial) await previous;
    if (lifecycle.stopping && command.type !== "safeShutdown") throw new Error("Beyonder está encerrando.");
    return await dispatch(command);
  } finally { if (tracked) lifecycle.active--; release(); }
}
async function dispatch(command: ControlCommand) {
  switch (command.type) {
    case "submitObjective":
      return submitObjective(command.objective);
    case "resumeTask":
      return resumeTask(command.taskId);
    case "discoverOpportunities":
      return discoverOpportunities(process.env.BEYONDER_CONTROL_FIXTURE === "1");
    case "prepareApplication":
      return prepareApplication(command.opportunityId);
    case "approveAction":
      return approveAction(command.approvalId);
    case "rejectAction":
      return rejectAction(command.approvalId, command.reason);
    case "pauseRuntime":
      return updateControlState({ paused: true, currentActivity: null }, "control.paused");
    case "resumeRuntime":
      lifecycle.emergency = false;
      return updateControlState({ paused: false, emergencyStopRequestedAt: undefined, currentActivity: null }, "control.resumed");
    case "safeShutdown":
      lifecycle.stopping = true;
      return updateControlState({ paused: true, safeShutdownRequestedAt: new Date().toISOString(), currentActivity: "Safe shutdown requested" }, "control.safe_shutdown_requested");
    case "emergencyStop": {
      lifecycle.emergency = true;
      const result = await updateControlState({ paused: true, emergencyStopRequestedAt: new Date().toISOString(), currentActivity: "Parada de emergência solicitada" }, "control.emergency_stop_requested");
      for (const controller of lifecycle.controllers) controller.abort();
      await Promise.allSettled([...lifecycle.browsers].map((browser) => browser.closeAll()));
      return result;
    }
    case "completeFirstRun":
      return updateControlState({ firstRunComplete: true }, "control.first_run_completed");
    case "setDeveloperMode":
      return updateControlState({ developerMode: command.enabled }, "control.developer_mode_changed");
    case "setStartup":
      return setStartup(command.enabled);
    case "confirmApplication":
    case "confirmSubmission":
    case "recordSettlement":
      return recordEvidence(command);
    case "setSecret":
      return setSecret(command);
  }
}

/** Persist a mission identity before its potentially long execution begins. */
export async function queueControlObjective(objective: string) {
  if (lifecycle.stopping) throw new Error("Beyonder está encerrando.");
  const normalized = normalizeObjective(objective);
  const runtime = controlRuntime();
  try {
    await assertNotPaused(runtime);
    const inspection = await runtime.intelligence.inspect(normalized);
    const task: IntelligenceTask = { ...inspection.task, id: `task_${nanoid()}` };
    await saveTask(runtime, { id: task.id, task, state: "PLANNING", executionPhase: "EXECUTING", startedAt: new Date().toISOString(), plan: { objective: normalized, steps: [] }, usage: {}, steps: [] });
    await runtime.audit.record("info", "mission.created", { taskId: task.id, objective: normalized, goalContract: task.goalContract });
    return {
      response: { ok: true, taskId: task.id, status: "PLANNING" },
      run: () => submitObjective(normalized, task)
    };
  } finally {
    await closeRuntime(runtime);
  }
}

async function resumeTask(taskId: string) {
  const runtime = controlRuntime();
  const controller = new AbortController();
  lifecycle.controllers.add(controller);
  try {
    await assertNotPaused(runtime);
    const lookup = await runtime.checkpoints.inspect(taskId);
    if (lookup.status === "CHECKPOINT_NOT_FOUND") throw new Error("Checkpoint de recuperação não encontrado para esta tarefa.");
    if (lookup.status === "CHECKPOINT_CORRUPT") throw new Error("Checkpoint corrompido. A tarefa foi bloqueada e não será reiniciada do zero.");
    if (lookup.status === "CHECKPOINT_VERSION_UNSUPPORTED") throw new Error(`Versão de checkpoint não suportada: ${String(lookup.version)}.`);
    if (lookup.status === "CHECKPOINT_IO_ERROR") throw new Error("Falha de armazenamento ao ler o checkpoint. A tarefa não será reiniciada.");
    const checkpoint = lookup.execution;
    assertSafeToResume(checkpoint, await runtime.getAvailableTools({ taskId }));
    await writeHeartbeat(runtime, `Retomando: ${checkpoint.plan.objective}`);
    await runtime.audit.record("info", "control.task_resume_started", { taskId, executionId: checkpoint.id });
    const summary = await runtime.ledger.summary(loadControlConfig().monthlyFixedCostUsd);
    const outcome = await runtime.taskExecutor.resume({
      execution: checkpoint,
      economicState: classifyEconomicState(summary),
      signal: controller.signal
    });
    await saveTask(runtime, outcome.execution);
    await runtime.audit.record(outcome.success ? "info" : "warn", outcome.success ? "control.task_resume_completed" : "control.task_resume_failed", { taskId, executionId: outcome.execution.id, status: outcome.status });
    return { ok: outcome.success, taskId, status: outcome.status, result: outcome.result ?? null, error: outcome.success ? undefined : humanFailure(outcome.failureReason) };
  } finally {
    lifecycle.controllers.delete(controller);
    await writeHeartbeat(runtime, null);
    await closeRuntime(runtime);
  }
}

function assertSafeToResume(execution: TaskExecution, availableTools: readonly ToolDescriptor[]) {
  if (["COMPLETED", "FAILED", "BLOCKED", "BUDGET_EXHAUSTED", "CANCELLED"].includes(execution.state)) throw new Error("Esta tarefa já terminou e não pode ser retomada.");
  const reconciliation = findReconciliationRequired(execution, availableTools);
  if (reconciliation) throw new Error("O resultado da ação externa interrompida é desconhecido. Reconciliação ou evidência do operador é obrigatória antes de nova tentativa.");
}

async function setStartup(enabled: boolean) {
  const target = `${homedir()}/.config/autostart/beyonder-control-center.desktop`;
  if (enabled) {
    const repoRoot = process.env.BEYONDER_REPO_ROOT;
    if (!repoRoot || !process.env.BEYONDER_NODE_PATH) throw new Error("Inicie pelo launcher instalado para configurar início automático.");
    const quote = (value: string) => `"${value.replaceAll("%", "%%").replace(/[\\"`$]/g, "\\$&")}"`;
    const exec = `${quote(process.env.BEYONDER_NODE_PATH)} ${quote(resolve(repoRoot, "apps/dashboard/bin/launch-control-center.mjs"))}`;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `[Desktop Entry]\nType=Application\nName=Beyonder\nComment=Start Beyonder Control Center\nExec=${exec}\nTerminal=false\nCategories=Development;Utility;\nStartupNotify=false\n`, { mode: 0o644 });
  } else {
    try {
      await unlink(target);
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
    }
  }
  const runtime = controlRuntime();
  try {
    await runtime.audit.record("info", "control.startup_changed", { enabled });
  } finally {
    await closeRuntime(runtime);
  }
  return { ok: true, startup: enabled ? "enabled" : "disabled" };
}

async function submitObjective(objective: string, preparedTask?: IntelligenceTask) {
  const normalized = normalizeObjective(objective);
  const runtime = controlRuntime();
  const controller = new AbortController();
  lifecycle.controllers.add(controller);
  lifecycle.active++;
  let taskId: string | undefined;
  try {
    await assertNotPaused(runtime);
    await writeHeartbeat(runtime, `Executando: ${normalized}`);
    await runtime.audit.record("info", "control.objective.started", { objective: normalized });
    const inspection = preparedTask ? undefined : await runtime.intelligence.inspect(normalized);
    const task: IntelligenceTask = preparedTask ?? { ...inspection!.task, id: `task_${nanoid()}` };
    taskId = task.id;
    if (!preparedTask) {
      await saveTask(runtime, { id: task.id, task, state: "PLANNING", executionPhase: "EXECUTING", startedAt: new Date().toISOString(), plan: { objective: normalized, steps: [] }, usage: {}, steps: [] });
      await runtime.audit.record("info", "mission.created", { taskId: task.id, objective: normalized, goalContract: task.goalContract });
    }
    const availableTools = (await runtime.getAvailableTools({ taskId: task.id, economicState: "normal" })).filter((tool) => process.env.BEYONDER_CONTROL_FIXTURE === "1" || tool.id !== "safe-objective");
    const fixturePlan = (): Plan => ( {
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
    });
    const plan = process.env.BEYONDER_CONTROL_FIXTURE === "1" ? fixturePlan() : await runtime.planner.createPlan({ objective: normalized, task, memoryContext: await runtime.memory.retrieve({ query: normalized, taskType: task.type, limit: 6 }), availableTools, budget: DEFAULT_TASK_BUDGET, economicState: "normal" });
    await runtime.audit.record("info", "plan.created", { taskId: task.id, steps: plan.steps.length, provider: runtime.planner.lastResult?.provider, model: runtime.planner.lastResult?.model });
    const validation = validatePlan(plan, { availableTools, budget: DEFAULT_TASK_BUDGET });
    if (!validation.valid) throw new Error(`Control Center plan is invalid: ${validation.issues.map((issue) => issue.message).join("; ")}`);
    const outcome = await runtime.taskExecutor.execute({
      task,
      plan,
      economicState: "normal",
      signal: controller.signal,
      initialUsage: { monetaryCostUsd: runtime.planner.lastResult?.monetaryCostUsd ?? 0, shadowCostUsd: runtime.planner.lastResult?.shadowCostUsd ?? 0 },
      ...(process.env.BEYONDER_CONTROL_FIXTURE === "1" ? { completionCriteria: { expectedText: normalized.slice(0, Math.min(24, normalized.length)) } } : {}),
      budget: { maxMonetaryCostUsd: 0, maxShadowCostUsd: 0.02, maxDurationMs: 30_000 }
    });
    await saveTask(runtime, outcome.execution);
    await runtime.audit.record(outcome.success ? "info" : "warn", outcome.success ? "control.objective.completed" : "control.objective.failed", { taskId: task.id, objective: normalized, status: outcome.status });
    await writeHeartbeat(runtime, null);
    return { ok: outcome.success, taskId: task.id, status: outcome.status, result: outcome.result ?? null, error: outcome.success ? undefined : humanFailure(outcome.failureReason ?? (outcome.status === "BLOCKED" ? "policy blocked" : undefined)) };
  } catch (error) {
    const message = humanFailure(error instanceof Error ? error.message : "Falha na execução.");
    if (taskId) {
      await saveTask(runtime, { id: taskId, task: preparedTask ?? { id: taskId, input: normalized }, state: "FAILED", objectiveStatus: "FAILED", executionPhase: "EXECUTION_FINISHED", error: message, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), plan: { objective: normalized, steps: [] }, usage: {}, steps: [] });
      await runtime.audit.record("warn", "control.objective.failed", { taskId, objective: normalized, status: "FAILED", reason: message });
      return { ok: false, taskId, status: "FAILED", result: null, error: message };
    }
    throw new Error(message);
  } finally {
    lifecycle.controllers.delete(controller);
    await writeHeartbeat(runtime, null);
    try { await closeRuntime(runtime); } finally { lifecycle.active--; }
  }
}

function normalizeObjective(objective: string) {
  const normalized = objective.trim().replace(/\s+/g, " ");
  if (normalized.length < 3) throw new Error("Objective is too short.");
  return normalized;
}

async function discoverOpportunities(fixture: boolean) {
  const runtime = controlRuntime();
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
    await closeRuntime(runtime);
  }
}

async function prepareApplication(opportunityId: string) {
  const runtime = controlRuntime();
  try {
    await assertNotPaused(runtime);
    const realId = await resolveOpportunityId(runtime, opportunityId);
    const created = await runtime.workRunManager.start(realId);
    const prepared = await runtime.workRunManager.prepareApplication(created.id);
    await runtime.audit.record("info", "control.application_prepared", { workRunId: prepared.id, opportunityId: realId, approvalId: prepared.application?.approvalId });
    return { ok: true, workRunId: prepared.id, approvalId: prepared.application?.approvalId };
  } finally {
    await closeRuntime(runtime);
  }
}

async function approveAction(approvalId: string) {
  const runtime = controlRuntime();
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
        const sent = await runtime.workRunManager.sendApplication(run.id);
        consumed = sent.state === "APPLICATION_SENT";
      }
    }
    if (request?.action === "SUBMIT_DELIVERABLE") {
      const run = (await runtime.workRunManager.list()).find((candidate) => candidate.deliverable?.metadata?.submissionApprovalId === realId);
      if (run) { const sent = await runtime.workRunManager.submit(run.id); consumed = sent.state === "AWAITING_SETTLEMENT"; }
    }
    await runtime.audit.record("info", "control.approval_decided", { approvalId: realId, status: consumed ? "CONSUMED" : "APPROVED" });
    return { ok: true, approvalId: realId, status: consumed ? "CONSUMED" : "APPROVED" };
  } finally {
    await closeRuntime(runtime);
  }
}

async function rejectAction(approvalId: string, reason?: string) {
  const runtime = controlRuntime();
  try {
    const realId = await resolveApprovalId(runtime, approvalId);
    await runtime.approvals.reject(realId, reason);
    await runtime.audit.record("info", "control.approval_decided", { approvalId: realId, status: "REJECTED" });
    return { ok: true, approvalId: realId, status: "REJECTED" };
  } finally {
    await closeRuntime(runtime);
  }
}

async function setSecret(command: Extract<ControlCommand, { type: "setSecret" }>) {
  if (!providers.find((provider) => provider.id === command.providerId)?.credentialEnvVars.includes(command.envVar)) throw new Error("Credencial incompatível com o provider.");
  if (!command.value.trim()) throw new Error("Secret value is required.");
  const repoRoot = process.env.BEYONDER_REPO_ROOT ?? resolve(process.cwd(), "../..");
  const vault = new Vault(resolve(repoRoot, ".providers-vault/vault.json"));
  await vault.set(command.providerId, command.envVar, command.value, command.vaultPassword);
  const provider = providers.find((provider) => provider.id === command.providerId)!;
  const broker = new CredentialBroker(await vault.read(command.vaultPassword), { ...process.env, [command.envVar]: command.value });
  const report = process.env.BEYONDER_CONTROL_FIXTURE === "1" ? null : await validateProviderDetailed(provider, broker);
  const validated = report?.status;
  await vault.markValidation(command.providerId, command.envVar, validated?.validationStatus ?? "skipped", command.vaultPassword);
  const ready = validated?.validationStatus === "validated";
  if (ready) for (const record of broker.getProviderSecrets(provider.id)) process.env[record.envVar] = record.value;
  const stateStore = new AutopilotStateStore(loadControlConfig().model.providerStatePath);
  await stateStore.update(provider, ready ? "READY" : "HUMAN_GATE", { validation: { status: validated?.validationStatus ?? "skipped", models: report?.models, modelCount: report?.modelCount, latencyMs: report?.latencyMs, rateLimitHeaders: report?.rateLimitHeaders, message: ready ? "Credencial validada." : "Credencial não validada. Verifique a chave e a conexão." } });
  const runtime = controlRuntime();
  try {
    await runtime.audit.record("info", "control.secret_set", { providerId: command.providerId, envVar: command.envVar, status: ready ? "READY" : "INVALID" });
    if (ready) await runtime.modelRouter.operationalHealth.credentialValidated(provider.id);
  } finally {
    await closeRuntime(runtime);
  }
  return { ok: true, providerId: command.providerId, envVar: command.envVar, status: ready ? "READY" : "INVALID" };
}

async function updateControlState(patch: Partial<ControlCenterState>, event: string) {
  const runtime = controlRuntime();
  try {
    const next = await runtime.state.update<ControlCenterState>(CONTROL_STATE_KEY, defaultControlState(), (current) => ({ ...current, ...patch }));
    await runtime.audit.record("info", event, { paused: next.paused, developerMode: next.developerMode });
    return { ok: true, state: next };
  } finally {
    await closeRuntime(runtime);
  }
}

async function writeHeartbeat(runtime: ReturnType<typeof createRuntime>, currentActivity: string | null) {
  await runtime.state.update<ControlCenterState>(CONTROL_STATE_KEY, defaultControlState(), (current) => ({ ...current, currentActivity }));
}

async function assertNotPaused(runtime: ReturnType<typeof createRuntime>) {
  const state = await runtime.state.get<ControlCenterState>(CONTROL_STATE_KEY, defaultControlState());
  if (lifecycle.stopping || state.safeShutdownRequestedAt) throw new Error("Beyonder está encerrando.");
  if (lifecycle.emergency || state.paused) throw new Error("Beyonder is paused. Resume before starting new work.");
}

async function saveTask(runtime: ReturnType<typeof createRuntime>, execution: unknown) {
  const id = typeof execution === "object" && execution && typeof (execution as { id?: unknown }).id === "string" ? (execution as { id: string }).id : `exec_${nanoid()}`;
  const executionTaskId = (execution as { task?: { id?: string } }).task?.id;
  await runtime.state.update<string[]>(TASK_INDEX_KEY, [], (current) => { const index = current.filter((existing) => existing !== executionTaskId || id === executionTaskId); return index.includes(id) ? index : [id, ...index]; });
  await runtime.state.set(`control-center:task:${id}`, { ...(execution as object), fixture: process.env.BEYONDER_CONTROL_FIXTURE === "1" });
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

function humanFailure(reason?: string) {
  if (/No compatible candidates/i.test(reason ?? "")) return "Não consegui iniciar esta etapa porque nenhum modelo compatível está disponível.";
  if (/HTTP 400/i.test(reason ?? "")) return "Um serviço de inteligência recusou a solicitação. Consulte as tentativas nos detalhes do trabalho.";
  if (/HTTP 4\d\d|HTTP 5\d\d|Inference deadline|fetch failed/i.test(reason ?? "")) return "Não consegui concluir esta tarefa porque um serviço de inteligência não respondeu como esperado. Consulte os detalhes do trabalho.";
  if (/policy|blocked|prohibited|denied/i.test(reason ?? "")) return "Esta ação foi bloqueada pelas regras de segurança.";
  if (/browser|playwright/i.test(reason ?? "")) return "O navegador não conseguiu executar a ação. Verifique a instalação e tente novamente.";
  return reason ?? "A tarefa falhou. Consulte o histórico operacional.";
}
async function recordEvidence(command: Extract<ControlCommand, { workRunId: string }>) {
  const runtime = controlRuntime();
  try {
    await assertNotPaused(runtime);
    const run = await runtime.workRunManager.inspect(command.workRunId);
    if (!run) throw new Error("Trabalho não encontrado.");
    if (command.type === "recordSettlement" && (run.source === "fixture" || run.application?.mode === "FIXTURE")) throw new Error("Trabalhos de teste não registram receita real.");
    if (command.type === "recordSettlement") return { ok: true, run: await runtime.workRunManager.recordSettlement(run.id, { type: "MANUAL_CONFIRMED", amount: command.amount, currency: command.currency, source: command.source, externalReference: command.externalReference, observedAt: new Date().toISOString() }) };
    const evidence = { executedBy: "HUMAN" as const, source: run.source, timestamp: new Date().toISOString(), externalReference: command.externalReference, notes: command.notes };
    return { ok: true, run: command.type === "confirmApplication" ? await runtime.workRunManager.recordManualApplication(run.id, evidence) : await runtime.workRunManager.recordManualSubmission(run.id, evidence) };
  } finally { await closeRuntime(runtime); }
}
