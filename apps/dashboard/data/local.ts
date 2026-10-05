import type { WorkRun, SourceReliability, StepExecution } from "@beyonder/runtime";
import { browserEvidence, discoverOllama } from "@beyonder/runtime";
import type { WorkRunView } from "./types";
import Database from "better-sqlite3";
import { AutopilotStateStore, buildComputeInventory, providers as catalogProviders } from "@beyonder/compute";
import { existsSync } from "node:fs";
import path from "node:path";
import { emptyHealthChecks } from "./empty";
import { redactText, safeJsonObject } from "./redact";
import type {
  ApprovalView,
  AuditEventView,
  AuditQuery,
  ControlCenterState,
  DashboardDataSource,
  EconomySummary,
  HealthCheckView,
  HomeView,
  MemoryKind,
  MemoryQuery,
  MemoryView,
  ModelDecisionView,
  PageQuery,
  ProviderView,
  RuntimeStatusView,
  TaskStepView,
  TaskView
} from "./types";

interface AuditRow { id: string; level: string; event: string; details: string; created_at: string; }
interface MemoryRow { id: string; kind: string; content: string; importance: number; confidence: number; utility: number; created_at: string; last_accessed_at: string | null; access_count: number; source: string | null; task_id: string | null; keywords: string; }
interface LedgerRow { type: string; amount_usd: number; created_at: string; }

const CONTROL_STATE_KEY = "control-center:state";
const TASK_INDEX_KEY = "control-center:tasks:index";

export class LocalDashboardDataSource implements DashboardDataSource {
  readonly provenance = "local" as const;

  constructor(
    private readonly dbPath = resolveDashboardDbPath(),
    private readonly providerStatePath = resolveProviderStatePath()
  ) {}

  async isDeveloperMode() { return this.readControlState().developerMode; }

  async getHome(): Promise<HomeView> {
    if (!this.isAvailable()) return emptyHome();
    const [status, approvals, tasks, economy, audit] = await Promise.all([
      this.getRuntimeStatus(),
      this.getApprovals({ limit: 20 }),
      this.getTasks({ limit: 20 }),
      this.getEconomySummary(),
      this.getAuditEvents({ limit: 6 })
    ]);
    const activeTask = tasks.find((task) => task.status === "running" || task.status === "planning" || task.status === "queued") ?? null;
    const todayPrefix = new Date().toISOString().slice(0, 10);
    return {
      status,
      healthChecks: await this.getHealthChecks(status),
      needsYouCount: approvals.filter((approval) => approval.status === "PENDING").length,
      activeTask,
      recentMissions: tasks.slice(0, 5),
      today: {
        completedTasks: tasks.filter((task) => task.status === "succeeded" && task.completedAt?.startsWith(todayPrefix)).length,
        realMoneySpentUsd: economy.realMoneySpentUsd,
        realRevenueUsd: economy.realRevenueUsd,
        simulatedRevenueUsd: economy.simulatedRevenueUsd
      },
      economy,
      firstRun: !this.readControlState().firstRunComplete,
      recentAudit: audit,
      provenance: this.provenance
    };
  }

  async getRuntimeStatus(): Promise<RuntimeStatusView> {
    if (!this.isAvailable()) return emptyHomeStatus();
    const state = this.readControlState();
    const approvals = await this.getApprovals({ limit: 200 });
    const latestError = (await this.getAuditEvents({ level: "error", limit: 1 }))[0];
    const tasks = await this.getTasks({ limit: 20 });
    const activeTask = tasks.find((task) => task.status === "running" || task.status === "planning" || task.status === "queued");
    const age = state.lastHeartbeatAt ? Date.now() - Date.parse(state.lastHeartbeatAt) : Infinity;
    const heartbeat = age > 60_000 ? "OFFLINE" : age > 10_000 ? "DEGRADED" : state.paused ? "PAUSED" : "ONLINE";
    if (heartbeat === "OFFLINE" || heartbeat === "DEGRADED") return { global: heartbeat, heartbeat, label: heartbeat === "OFFLINE" ? "Offline" : "Degradado", detail: heartbeat === "OFFLINE" ? "Beyonder não está em execução." : `Runtime não respondeu há ${Math.floor(age / 1000)} segundos.`, lastHeartbeatAt: state.lastHeartbeatAt, currentActivity: null };

    if (state.paused) {
      return { global: "PAUSED", heartbeat, label: "Pausado", detail: "Nenhuma nova tarefa ou acao externa sera iniciada.", lastHeartbeatAt: state.lastHeartbeatAt, currentActivity: state.currentActivity };
    }
    if (approvals.some((approval) => approval.status === "PENDING")) {
      return { global: "WAITING_FOR_YOU", heartbeat, label: "Esperando voce", detail: "Existe uma decisao aguardando aprovacao.", lastHeartbeatAt: state.lastHeartbeatAt, currentActivity: state.currentActivity };
    }
    if (tasks.some((task) => task.status === "waiting")) return { global: "WAITING_FOR_YOU", heartbeat, label: "Esperando você", detail: "Uma tarefa aguarda retomada.", lastHeartbeatAt: state.lastHeartbeatAt, currentActivity: state.currentActivity };
    const blockedTask = tasks.find((task) => task.status === "blocked");
    if (blockedTask) return { global: "ATTENTION_REQUIRED", heartbeat, label: "Precisa de atenção", detail: blockedTask.humanStatus, lastHeartbeatAt: state.lastHeartbeatAt, currentActivity: state.currentActivity };
    if (activeTask) {
      return { global: "WORKING", heartbeat, label: "Trabalhando", detail: activeTask.humanStatus, lastHeartbeatAt: state.lastHeartbeatAt, currentActivity: state.currentActivity ?? activeTask.title };
    }
    if (latestError) {
      return { global: "ATTENTION_REQUIRED", heartbeat, label: "Precisa de atencao", detail: latestError.humanEvent, lastHeartbeatAt: state.lastHeartbeatAt, currentActivity: state.currentActivity };
    }
    return { global: "READY", heartbeat, label: "Pronto", detail: "Beyonder esta livre. Nenhuma tarefa em execucao.", lastHeartbeatAt: state.lastHeartbeatAt, currentActivity: state.currentActivity };
  }

  async getWorkRuns(): Promise<WorkRunView[]> {
    if (!this.isAvailable()) return [];
    const db = this.open();
    try { return readState<string[]>(db, "work-runs:index", []).flatMap((id) => {
      const run = readState<WorkRun | undefined>(db, `work-run:${id}`, undefined);
      if (!run) return [];
      const opportunity = readState<Record<string, unknown>>(db, `opportunity:item:${run.opportunityId}`, {});
      return [{ ...run, title: stringField(opportunity, "title"), sourceUrl: safeExternalUrl(stringField(opportunity, "sourceUrl")), fixture: isFixtureRun(run) }];
    }); } finally { db.close(); }
  }
  async getSourceHealth(): Promise<SourceReliability[]> {
    if (!this.isAvailable()) return [];
    const db = this.open();
    try { return readState<SourceReliability[]>(db, "opportunity-sources:reliability", []); } finally { db.close(); }
  }
  async getTasks(query: PageQuery = {}): Promise<TaskView[]> {
    if (!this.isAvailable()) return [];
    const db = this.open();
    try {
      const ids = readState<string[]>(db, TASK_INDEX_KEY, []);
      const checkpoints = (db.prepare("SELECT key, value FROM state WHERE key LIKE 'task-checkpoint:%'").all() as Array<{ key: string; value: string }>).map((row) => ({ id: row.key.slice("task-checkpoint:".length), execution: checkpointExecution(row.value) }));
      const allIds = [...new Set([...ids, ...checkpoints.map((row) => row.id)])];
      const seenTasks = new Set<string>();
      const rows = allIds.flatMap((id) => {
        const execution = readState<Record<string, unknown> | undefined>(db, `control-center:task:${id}`, undefined);
        const value = execution ?? checkpoints.find((row) => row.id === id)?.execution;
        if (!value) return [];
        const taskId = stringField(objectField(value, "task"), "id") || id;
        if (seenTasks.has(taskId)) return [];
        seenTasks.add(taskId);
        return [taskView({ ...value, attempts: readState(db, `task-attempts:${taskId}`, value.attempts ?? []) }, this.provenance)];
      });
      return page(rows.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "")), query);
    } finally {
      db.close();
    }
  }

  async getTask(taskId: string): Promise<TaskView | null> {
    const tasks = await this.getTasks({ limit: 200 });
    return tasks.find((task) => task.taskId === taskId || task.technicalId === taskId || task.resumeTaskId === taskId || task.id === taskId) ?? null;
  }

  async getOpportunities(query: PageQuery = {}) {
    if (!this.isAvailable()) return [];
    const db = this.open();
    try {
      const ids = readState<string[]>(db, "opportunities:index", []);
      const views = ids.flatMap((id) => {
        const opportunity = readState<Record<string, unknown> | undefined>(db, `opportunity:item:${id}`, undefined);
        return opportunity ? [opportunityView(opportunity, this.provenance)] : [];
      });
      return page(views.sort((a, b) => a.title.localeCompare(b.title)), query);
    } finally {
      db.close();
    }
  }

  async getApprovals(query: PageQuery = {}): Promise<ApprovalView[]> {
    if (!this.isAvailable()) return [];
    const db = this.open();
    try {
      const opportunityById = opportunityMap(db);
      const ids = readState<string[]>(db, "approvals:index", []);
      const approvals = ids.flatMap((id) => {
        const approval = readState<Record<string, unknown> | undefined>(db, `approval:${id}`, undefined);
        return approval ? [approvalView(approval, opportunityById, this.provenance)] : [];
      });
      return page(approvals.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), query);
    } finally {
      db.close();
    }
  }

  async getProviders(query: PageQuery = {}): Promise<ProviderView[]> {
    const state = await new AutopilotStateStore(this.providerStatePath).read();
    const inventory = buildComputeInventory(state);
    const byId = new Map(inventory.map((item) => [item.providerId, item]));
    const db = this.isAvailable() ? this.open() : undefined;
    const healthById = new Map([...catalogProviders, { id: "ollama" }].map((provider) => [provider.id, db ? readState<{ samples?: number; failures?: number; latencyMs?: number; lastSuccessAt?: string; lastFailureAt?: string; cooldown?: { reason: string; until: string } }>(db, `provider-health:${provider.id}`, {}) : {}]));
    db?.close();
    const views: ProviderView[] = catalogProviders.map((provider) => {
      const item = byId.get(provider.id);
      const observed = healthById.get(provider.id)!;
      const cooldown = observed.cooldown && Date.parse(observed.cooldown.until) > Date.now() ? observed.cooldown : undefined;
      const configured = provider.authType === "keyless" || (provider.credentialEnvVars.some((name) => !name.endsWith("ACCOUNT_ID") && Boolean(process.env[name])) && (!provider.credentialEnvVars.includes("CLOUDFLARE_ACCOUNT_ID") || Boolean(process.env.CLOUDFLARE_ACCOUNT_ID)));
      const catalogStatus = providerStatus(item?.status);
      const status: ProviderView["status"] = cooldown ? /RATE|QUOTA/.test(cooldown.reason) ? "RATE_LIMITED" : "UNHEALTHY" : !configured && catalogStatus === "READY" ? "HUMAN_GATE" : catalogStatus;
      const verified = Boolean((observed.samples && (observed.failures ?? 0) < observed.samples) || state.providers[provider.id]?.validation?.status === "validated");
      return {
        id: provider.id,
        name: provider.name,
        placement: provider.id === "ollama" ? "LOCAL" as const : "CLOUD" as const,
        status,
        runway: { state: "UNKNOWN" as const, label: "Quota atual não conhecida" },
        latencyMs: typeof observed.latencyMs === "number" ? observed.latencyMs : null,
        health: observed.samples ? Math.max(0, 1 - (observed.failures ?? 0) / observed.samples) : null,
        configured,
        verified,
        setupEnvVar: provider.credentialEnvVars[0],
        lastCheckAt: observed.lastFailureAt && (!observed.lastSuccessAt || observed.lastFailureAt > observed.lastSuccessAt) ? observed.lastFailureAt : observed.lastSuccessAt ?? item?.lastCheckedAt ?? null,
        note: cooldown ? `Temporariamente indisponível (${cooldown.reason}) até ${cooldown.until}.` : !configured && catalogStatus === "READY" ? "Credencial não está disponível neste processo; configure/desbloqueie antes de usar." : !verified && (status === "READY" || status === "KEYLESS") ? "Configuração conhecida; inferência ainda não verificada. Quota desconhecida." : humanProviderNote(status),
        provenance: this.provenance
      };
    });
    const local = await discoverOllama(process.env.OLLAMA_BASE_URL ?? "http://localhost:11434");
    if (local.length) {
      const observed = healthById.get("ollama")!;
      const verified = Boolean(observed.samples && (observed.failures ?? 0) < observed.samples);
      const cooldown = observed.cooldown && Date.parse(observed.cooldown.until) > Date.now();
      views.push({ id: "ollama", name: "Ollama (local)", placement: "LOCAL", status: cooldown ? "UNHEALTHY" : verified ? "READY" : "UNKNOWN", runway: { state: "UNKNOWN", label: "Não consome quota cloud; recursos locais não medidos" }, latencyMs: observed.latencyMs ?? null, health: observed.samples ? Math.max(0, 1 - (observed.failures ?? 0) / observed.samples) : null, configured: true, verified, lastCheckAt: observed.lastFailureAt && (!observed.lastSuccessAt || observed.lastFailureAt > observed.lastSuccessAt) ? observed.lastFailureAt : observed.lastSuccessAt ?? new Date().toISOString(), note: `LOCAL_EMERGENCY · ${local.reduce((sum, item) => sum + item.models.length, 0)} modelo(s) observado(s). A disponibilidade não comprova adequação ao quality floor.`, provenance: this.provenance });
    }
    return page(views, query);
  }

  async getModelDecisions(query: PageQuery = {}): Promise<ModelDecisionView[]> {
    if (!this.isAvailable()) return [];
    const db = this.open();
    try {
      return page(readRouterDecisionSnapshot(db), query);
    } finally {
      db.close();
    }
  }

  async getMemories(query: MemoryQuery = {}): Promise<MemoryView[]> {
    if (!this.isAvailable()) return [];
    const db = this.open();
    try {
      if (!tableExists(db, "memories")) return [];
      const { limit, offset } = pageArgs(query);
      const where: string[] = [];
      const args: Array<string | number> = [];
      if (query.kind && query.kind !== "all") {
        where.push("kind = ?");
        args.push(query.kind);
      }
      if (query.search?.trim()) {
        where.push("(content LIKE ? OR keywords LIKE ? OR source LIKE ?)");
        const pattern = `%${query.search.trim()}%`;
        args.push(pattern, pattern, pattern);
      }
      args.push(limit, offset);
      const sql = `SELECT id, kind, content, importance, confidence, utility, created_at, last_accessed_at, access_count, source, task_id, keywords FROM memories ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      return (db.prepare(sql).all(...args) as MemoryRow[]).flatMap((row) => {
        const kind = normalizeMemoryKind(row.kind);
        if (!kind) return [];
        return [{
          id: row.id,
          kind,
          content: redactText(row.content),
          importance: row.importance,
          utility: row.utility,
          confidence: row.confidence,
          createdAt: row.created_at,
          lastAccessedAt: row.last_accessed_at,
          accessCount: row.access_count,
          source: row.source ? redactText(row.source) : undefined,
          taskId: row.task_id ?? undefined,
          keywords: parseJson<string[]>(row.keywords, []).map(redactText),
          provenance: this.provenance
        }];
      });
    } finally {
      db.close();
    }
  }

  async getAuditEvents(query: AuditQuery = {}): Promise<AuditEventView[]> {
    if (!this.isAvailable()) return [];
    const db = this.open();
    try {
      if (!tableExists(db, "audit_events")) return [];
      const { limit, offset } = pageArgs(query);
      const where: string[] = [];
      const args: Array<string | number> = [];
      if (query.level && query.level !== "all") {
        where.push("level = ?");
        args.push(query.level);
      }
      if (query.search?.trim()) {
        where.push("(event LIKE ? OR details LIKE ?)");
        const pattern = `%${query.search.trim()}%`;
        args.push(pattern, pattern);
      }
      args.push(limit, offset);
      const sql = `SELECT id, level, event, details, created_at FROM audit_events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      return (db.prepare(sql).all(...args) as AuditRow[]).map((row) => auditView(row, this.provenance));
    } finally {
      db.close();
    }
  }

  async getEconomySummary(): Promise<EconomySummary> {
    if (!this.isAvailable()) return { realMoneySpentUsd: 0, realRevenueUsd: 0, simulatedRevenueUsd: 0, shadowCostUsd: 0, computeConsumed: "0 tokens", monetaryCostTodayUsd: 0 };
    const db = this.open();
    try {
      let expenses = 0;
      let revenue = 0;
      if (tableExists(db, "ledger_entries")) {
        const rows = db.prepare("SELECT type, amount_usd, created_at FROM ledger_entries").all() as LedgerRow[];
        for (const row of rows) {
          if (row.type === "expense") expenses += row.amount_usd;
          if (row.type === "revenue") revenue += row.amount_usd;
        }
      }
      const runs = readState<string[]>(db, "work-runs:index", []).flatMap((id) => {
        const run = readState<Record<string, unknown> | undefined>(db, `work-run:${id}`, undefined);
        return run ? [run] : [];
      });
      const simulatedRevenueUsd = runs.reduce((sum, run) => sum + numberField(run, "simulatedRewardUsd"), 0);
      const realRevenueUsd = revenue + runs.filter((run) => !isFixtureRun(run) && objectField(run, "settlement").evidence).reduce((sum, run) => sum + numberField(run, "realizedRewardUsd"), 0);
      const shadowCostUsd = runs.reduce((sum, run) => sum + numberField(run, "shadowCostUsd"), 0);
      const taskShadow = (await this.getTasks({ limit: 200 })).reduce((sum, task) => sum + task.shadowCostUsd, 0);
      return {
        estimatedRevenueUsd: runs.filter((run) => !isFixtureRun(run) && !objectField(run, "settlement").evidence).reduce((sum, run) => sum + numberField(run, "estimatedRewardUsd"), 0),
        realMoneySpentUsd: expenses,
        realRevenueUsd,
        simulatedRevenueUsd,
        shadowCostUsd: shadowCostUsd + taskShadow,
        computeConsumed: "ver Recursos",
        monetaryCostTodayUsd: expenses
      };
    } finally {
      db.close();
    }
  }

  private async getHealthChecks(status: RuntimeStatusView): Promise<HealthCheckView[]> {
    const checks = emptyHealthChecks();
    checks[0] = { label: "Banco de dados", status: this.isAvailable() ? "pass" : "fail", detail: this.isAvailable() ? "SQLite local acessivel." : "SQLite local nao encontrado." };
    checks[1] = { label: "Runtime", status: status.heartbeat === "ONLINE" ? "pass" : status.heartbeat === "PAUSED" ? "warn" : "warn", detail: status.detail };
    checks[2] = { label: "Browser", status: "warn", detail: "BrowserAgent sera iniciado apenas quando uma tarefa precisar dele." };
    const providers = await this.getProviders();
    const verified = providers.filter((provider) => provider.verified && (provider.status === "READY" || provider.status === "KEYLESS")).length;
    const unverifiedKeyless = providers.filter((provider) => provider.status === "KEYLESS" && !provider.verified).length;
    checks[3] = {
      label: "Compute",
      status: verified > 0 ? "pass" : "warn",
      detail: verified > 0
        ? `${verified} provider(s) verificados e disponíveis.`
        : unverifiedKeyless > 0
          ? `${unverifiedKeyless} provider(s) keyless conhecidos, mas nenhuma inferência foi verificada ainda.`
          : "Nenhum provider verificado. Configure e valide um modelo para executar tarefas."
    };
    return checks;
  }

  private readControlState(): ControlCenterState {
    if (!this.isAvailable()) return defaultControlState();
    const db = this.open();
    try {
      return readState<ControlCenterState>(db, CONTROL_STATE_KEY, defaultControlState());
    } finally {
      db.close();
    }
  }

  private isAvailable() {
    return existsSync(this.dbPath);
  }

  private open() {
    return new Database(this.dbPath, { readonly: true, fileMustExist: true });
  }
}

export function resolveDashboardDbPath(): string {
  const repoRoot = process.env.BEYONDER_REPO_ROOT ?? path.resolve(process.cwd(), "../..");
  const configured = process.env.BEYONDER_DB_PATH ?? "./data/beyonder.sqlite";
  return path.isAbsolute(configured) ? configured : path.resolve(/*turbopackIgnore: true*/ repoRoot, configured);
}

export function resolveProviderStatePath(): string {
  const repoRoot = process.env.BEYONDER_REPO_ROOT ?? path.resolve(process.cwd(), "../..");
  const configured = process.env.BEYONDER_PROVIDER_STATE_PATH ?? ".providers-vault/autopilot-state.json";
  return path.isAbsolute(configured) ? configured : path.resolve(/*turbopackIgnore: true*/ repoRoot, configured);
}

export function defaultControlState(): ControlCenterState {
  return { paused: false, developerMode: false, firstRunComplete: false, lastHeartbeatAt: null, currentActivity: null };
}

export function readState<T>(db: Database.Database, key: string, fallback: T): T {
  if (!tableExists(db, "state")) return fallback;
  const row = db.prepare("SELECT value FROM state WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? parseJson<T>(row.value, fallback) : fallback;
}

function emptyHome(): HomeView {
  return {
    status: emptyHomeStatus(),
    healthChecks: emptyHealthChecks(),
    needsYouCount: 0,
    activeTask: null,
    recentMissions: [],
    today: { completedTasks: 0, realMoneySpentUsd: 0, realRevenueUsd: 0, simulatedRevenueUsd: 0 },
    economy: { realMoneySpentUsd: 0, realRevenueUsd: 0, simulatedRevenueUsd: 0, shadowCostUsd: 0, computeConsumed: "0 tokens", monetaryCostTodayUsd: 0 },
    firstRun: true,
    recentAudit: [],
    provenance: "empty"
  };
}

function emptyHomeStatus(): RuntimeStatusView {
  return { global: "OFFLINE", heartbeat: "OFFLINE", label: "Desligado", detail: "Control Center aberto, runtime ainda sem heartbeat.", lastHeartbeatAt: null, currentActivity: null };
}

function taskView(execution: Record<string, unknown>, provenance: "local"): TaskView {
  const usage = objectField(execution, "usage");
  const plan = objectField(execution, "plan");
  const task = objectField(execution, "task");
  const state = stringField(execution, "state");
  const steps = Array.isArray(plan.steps) ? plan.steps as Record<string, unknown>[] : [];
  const stepExecutions = Array.isArray(execution.steps) ? execution.steps as Record<string, unknown>[] : [];
  const latestStep = stepExecutions.at(-1);
  const verification = objectField(execution, "objectiveVerification");
  const objectiveStatus = stringField(execution, "objectiveStatus");
  const verifying = Boolean(execution.executionPhase) && !objectiveStatus && !execution.interruptionReason
    && ["FAILED", "BLOCKED", "CANCELLED", "EXECUTION_FINISHED"].includes(state);
  const evidenceSources = browserSources(stepExecutions);
  const latestTool = stepExecutions.map((step) => stringField(objectField(step, "toolCall"), "tool")).filter(Boolean).at(-1);
  const attempts = (Array.isArray(execution.attempts) ? execution.attempts : []) as NonNullable<TaskView["attempts"]>;
  const inferenceAttempts = attempts.filter((attempt) => attempt.phase !== "TOOL_EXECUTION");
  const resultAttempt = inferenceAttempts.filter((attempt) => attempt.phase === "DIRECT_RESPONSE" && attempt.status === "SUCCEEDED").at(-1)
    ?? inferenceAttempts.filter((attempt) => attempt.phase !== "OBJECTIVE_VERIFICATION" && attempt.status === "SUCCEEDED").at(-1)
    ?? inferenceAttempts.filter((attempt) => attempt.phase !== "OBJECTIVE_VERIFICATION").at(-1);
  const failureAttempt = inferenceAttempts.filter((attempt) => attempt.status === "FAILED").at(-1);
  const phaseLabels: Record<string, string> = { PLANNING: "criação do plano", REPLANNING: "revisão do plano", ACTION_PLANNING: "escolha da ferramenta", DIRECT_RESPONSE: "resposta ao objetivo", OBJECTIVE_VERIFICATION: "verificação independente do objetivo", TOOL_EXECUTION: "execução da ferramenta" };
  const failureLabels: Record<string, string> = { BAD_REQUEST: "recusou a solicitação", AUTH_REQUIRED: "precisa de credenciais válidas", FORBIDDEN: "negou acesso", MODEL_UNAVAILABLE: "não disponibilizou o modelo", RATE_LIMITED: "atingiu o limite de uso", PROVIDER_UNAVAILABLE: "está indisponível", TIMEOUT: "não respondeu no prazo", NETWORK_ERROR: "não pôde ser acessado", INVALID_OUTPUT: "não produziu uma resposta válida", INVALID_ACTION: "não produziu uma ação válida" };
  return {
    canResume: state === "WAITING" && execution.interruptionReason === "PROCESS_RESTART",
    resumeTaskId: state === "WAITING" && execution.interruptionReason === "PROCESS_RESTART" ? stringField(task, "id") : undefined,
    failureSummary: state === "FAILED" ? failureAttempt?.failureClass ? `${failureAttempt.provider} ${failureLabels[failureAttempt.failureClass] ?? "falhou"} durante a ${phaseLabels[failureAttempt.phase] ?? "execução"}. As tentativas permitidas foram encerradas.` : "Não consegui concluir esta tarefa." : undefined,
    attempts: attempts.map((attempt) => ({ ...attempt, error: attempt.error ? redactText(attempt.error) : undefined })),
    id: humanTaskId(stringField(execution, "id")),
    taskId: stringField(task, "id") || undefined,
    title: stringField(plan, "objective") || stringField(task, "objective") || stringField(task, "input") || "Objetivo sem titulo",
    humanStatus: verifying ? "Verificando o resultado antes de encerrar a missão." : execution.interruptionReason === "PROCESS_RESTART" ? "Execução interrompida; pronta para retomada segura." : execution.interruptionReason === "PROCESS_RESTART_NO_CHECKPOINT" ? "Execução interrompida antes de um checkpoint recuperável." : execution.interruptionReason ? stringField(execution, "error") || String(execution.interruptionReason) : humanTaskStatus(state, latestStep ? stringField(latestStep, "observationSummary") : undefined),
    status: verifying ? "running" : normalizeTaskStatus(state),
    result: typeof execution.result === "string" ? humanTaskResult(redactText(execution.result)) : null,
    resultVerified: state === "COMPLETED" && objectiveStatus === "SUCCEEDED",
    objectiveStatus: objectiveStatus || undefined,
    executionPhase: stringField(execution, "executionPhase") || undefined,
    confidence: numberOrUndefined(verification, "confidence") ?? null,
    evidenceSources,
    provider: resultAttempt?.provider ?? (latestStep ? stringField(objectField(latestStep, "route").selected as Record<string, unknown> | undefined, "provider") || null : null),
    model: resultAttempt?.model ?? (latestStep ? stringField(objectField(latestStep, "route").selected as Record<string, unknown> | undefined, "model") || null : null),
    fixture: execution.fixture === true,
    current: steps.find((step) => step.status === "RUNNING")?.description as string | undefined,
    next: steps.find((step) => step.status === "PENDING")?.description as string | undefined,
    tool: latestTool || undefined,
    costUsd: numberField(usage, "monetaryCostUsd"),
    shadowCostUsd: numberField(usage, "shadowCostUsd"),
    durationMs: execution.interruptionReason ? numberField(usage, "durationMs") || null : !stringField(execution, "completedAt") && stringField(execution, "startedAt") ? Math.max(0, Date.now() - Date.parse(stringField(execution, "startedAt"))) : numberField(usage, "durationMs") || null,
    startedAt: stringField(execution, "startedAt") || null,
    completedAt: stringField(execution, "completedAt") || null,
    steps: steps.map((step, index) => ({
      label: stringField(step, "description") || `Passo ${index + 1}`,
      detail: stringField(step, "expectedOutcome") || undefined,
      state: stepState(stringField(step, "status"))
    })),
    why: latestStep ? modelWhy(latestStep) : ["Execucao ainda nao selecionou um modelo."],
    technicalId: stringField(execution, "id"),
    provenance
  };
}

function opportunityView(opportunity: Record<string, unknown>, provenance: "local") {
  const metadata = objectField(opportunity, "metadata");
  const evaluation = objectField(metadata, "evaluation");
  const reward = rewardLabel(objectField(opportunity, "reward"));
  const decision = stringField(evaluation, "decision") || stringField(opportunity, "status");
  return {
    id: humanTaskId(stringField(opportunity, "id")),
    title: stringField(opportunity, "title") || "Oportunidade sem titulo",
    externalActionMode: stringField(opportunity, "source") === "fixture" ? "FIXTURE" as const : "MANUAL_REQUIRED" as const,
    sourceUrl: safeExternalUrl(stringField(opportunity, "sourceUrl")),
    fixture: stringField(opportunity, "source") === "fixture",
    source: stringField(opportunity, "source") || "Fonte desconhecida",
    rewardLabel: reward,
    deadlineLabel: stringField(opportunity, "deadline") ? new Date(stringField(opportunity, "deadline")).toLocaleDateString("pt-BR") : "Sem prazo informado",
    feasibility: humanFeasibility(stringField(evaluation, "feasibility")),
    estimatedSuccessLabel: percentLabel(numberOrUndefined(evaluation, "estimatedSuccessProbability")),
    estimatedCostLabel: numberOrUndefined(evaluation, "estimatedMonetaryCostUsd") === undefined ? "Não estimado" : usd(numberField(evaluation, "estimatedMonetaryCostUsd")),
    riskLabel: numberOrUndefined(evaluation, "riskScore") === undefined ? "Não estimado" : riskLabel(numberField(evaluation, "riskScore")),
    decisionLabel: humanOpportunityDecision(decision),
    confidenceLabel: percentLabel(numberOrUndefined(evaluation, "confidence")),
    humanSummary: humanOpportunityDecision(decision),
    why: reasons(evaluation).map(humanReason),
    canPrepareApplication: ["QUEUED", "REQUIRES_APPROVAL"].includes(stringField(opportunity, "status")),
    technicalId: stringField(opportunity, "id"),
    provenance
  };
}

function approvalView(approval: Record<string, unknown>, opportunities: Map<string, Record<string, unknown>>, provenance: "local"): ApprovalView {
  const opportunityId = stringField(approval, "opportunityId");
  const opportunity = opportunities.get(opportunityId);
  return {
    id: humanTaskId(stringField(approval, "approvalId")),
    title: humanApprovalAction(stringField(approval, "action")),
    destination: stringField(approval, "destination") || "Destino externo",
    opportunityTitle: opportunity ? stringField(opportunity, "title") : "Oportunidade relacionada",
    rewardLabel: opportunity ? rewardLabel(objectField(opportunity, "reward")) : "Recompensa nao informada",
    payloadPreview: redactText(stringField(approval, "payloadPreview") || "Sem preview disponivel."),
    riskLabel: riskLabel((Array.isArray(approval.risks) ? approval.risks.length : 0) * 0.25),
    risks: Array.isArray(approval.risks) ? approval.risks.map((risk) => humanReason(String(risk))) : [],
    status: approvalStatus(stringField(approval, "status")),
    createdAt: stringField(approval, "createdAt"),
    expiresAt: stringField(approval, "expiresAt") || null,
    authorizationScope: [
      "Autoriza apenas esta acao.",
      "Nao autoriza submissao posterior.",
      "Nao autoriza pagamento, wallet, conta ou outras oportunidades."
    ],
    technicalId: stringField(approval, "approvalId"),
    provenance
  };
}

function auditView(row: AuditRow, provenance: "local"): AuditEventView {
  const details = safeJsonObject(row.details);
  return {
    id: row.id,
    level: auditLevel(row.level),
    event: redactText(row.event),
    humanEvent: humanAuditEvent(row.event, details),
    details,
    createdAt: row.created_at,
    category: auditCategory(row.event, row.level),
    provenance
  };
}

function readRouterDecisionSnapshot(db: Database.Database): ModelDecisionView[] {
  if (!tableExists(db, "audit_events")) return [];
  const selectedRows = db.prepare("SELECT id, level, event, details, created_at FROM audit_events WHERE event = 'router.selected' ORDER BY created_at DESC LIMIT 100").all() as AuditRow[];
  const candidateRows = db.prepare("SELECT id, level, event, details, created_at FROM audit_events WHERE event = 'router.candidate_scored' ORDER BY created_at DESC LIMIT 500").all() as AuditRow[];
  const shadowRows = db.prepare("SELECT id, level, event, details, created_at FROM audit_events WHERE event = 'shadow_cost.calculated' ORDER BY created_at DESC LIMIT 500").all() as AuditRow[];
  return selectedRows.map((row) => {
    const details = safeJsonObject(row.details);
    const taskId = typeof details.taskId === "string" ? details.taskId : undefined;
    const selectedLabel = `${String(details.model ?? "modelo")} / ${String(details.provider ?? "provider")}`;
    const alternatives = candidateRows
      .map((candidate) => safeJsonObject(candidate.details))
      .filter((candidate) => candidate.taskId === taskId && `${String(candidate.model)} / ${String(candidate.provider)}` !== selectedLabel)
      .slice(0, 4)
      .map((candidate) => ({ label: `${String(candidate.model)} / ${String(candidate.provider)}`, utility: numericOrNull(candidate.utility) }));
    const shadow = shadowRows.map((candidate) => safeJsonObject(candidate.details)).find((candidate) => candidate.taskId === taskId && candidate.provider === details.provider && candidate.model === details.model);
    return {
      id: row.id,
      selectedLabel,
      utility: numericOrNull(details.utility),
      reasons: [
        { label: "capability fit", value: numericOrLabel(details.predictedQuality) },
        { label: "historical performance", value: numericOrLabel(details.historicalSuccess) },
        { label: "custo monetário", value: numericOrNull(details.monetaryCostUsd) === null ? "Não há dados suficientes" : usd(Number(details.monetaryCostUsd)) }
      ],
      penalties: [
        { label: "shadow/resource cost", value: numericOrLabel(details.shadowCostUsd) },
        { label: "latency", value: numericOrLabel(details.latencyPenalty) },
        { label: "quota scarcity", value: numericOrLabel(shadow?.scarcity) }
      ],
      alternatives,
      decidedAt: row.created_at,
      taskId,
      humanWhy: [
        `Compatibilidade registrada: ${numericOrLabel(details.predictedQuality)}.`,
        `Custo monetário reportado: ${numericOrNull(details.monetaryCostUsd) === null ? "Não há dados suficientes" : usd(Number(details.monetaryCostUsd))}.`,
        `Histórico registrado: ${numericOrLabel(details.historicalSuccess)}. Latência: ${numericOrLabel(details.latencyPenalty)}.`
      ],
      provenance: "local"
    };
  });
}

function opportunityMap(db: Database.Database) {
  const map = new Map<string, Record<string, unknown>>();
  for (const id of readState<string[]>(db, "opportunities:index", [])) {
    const opportunity = readState<Record<string, unknown> | undefined>(db, `opportunity:item:${id}`, undefined);
    if (opportunity) map.set(id, opportunity);
  }
  return map;
}

function tableExists(db: Database.Database, table: string) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function isFreshHeartbeat(value: string | null) {
  return value ? Date.now() - Date.parse(value) < 30_000 : false;
}

function page<T>(items: T[], query: PageQuery = {}) {
  const { limit, offset } = pageArgs(query);
  return items.slice(offset, offset + limit);
}

function pageArgs(query: PageQuery) {
  return { limit: Math.min(200, Math.max(1, query.limit ?? 50)), offset: Math.max(0, query.offset ?? 0) };
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function objectField(value: unknown, key?: string): Record<string, unknown> {
  const target = key && value && typeof value === "object" ? (value as Record<string, unknown>)[key] : value;
  return target && typeof target === "object" && !Array.isArray(target) ? target as Record<string, unknown> : {};
}

function stringField(value: unknown, key?: string): string {
  const target = key && value && typeof value === "object" ? (value as Record<string, unknown>)[key] : value;
  return typeof target === "string" ? target : "";
}

function numberField(value: unknown, key: string): number {
  const target = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  return typeof target === "number" && Number.isFinite(target) ? target : 0;
}

function numberOrUndefined(value: unknown, key: string): number | undefined {
  const target = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  return typeof target === "number" && Number.isFinite(target) ? target : undefined;
}

function numericOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numericOrLabel(value: unknown): number | string {
  return typeof value === "number" && Number.isFinite(value) ? value : "Não há dados suficientes";
}

function humanTaskId(id: string) {
  return id ? id.slice(0, 8) : "local";
}

function normalizeTaskStatus(state: string): TaskView["status"] {
  if (state === "PLANNING") return "planning";
  if (state === "WAITING") return "waiting";
  if (state === "BLOCKED") return "blocked";
  if (["RUNNING", "READY", "RECOVERING", "REPLANNING", "EXECUTION_FINISHED"].includes(state)) return "running";
  if (state === "COMPLETED") return "succeeded";
  if (["FAILED", "BLOCKED", "BUDGET_EXHAUSTED"].includes(state)) return "failed";
  if (state === "CANCELLED") return "cancelled";
  if (state === "CREATED") return "queued";
  return "unknown";
}

function humanTaskStatus(state: string, observation?: string) {
  if (state === "PLANNING" || state === "CREATED") return "Preparando";
  if (state === "WAITING") return "Esperando você";
  if (state === "CANCELLED") return "Cancelado";
  if (state === "COMPLETED") return "Concluído";
  if (state === "FAILED") return "Falhou. Consulte o resultado e o histórico.";
  if (state === "BLOCKED") return "Bloqueado por politica, verificacao ou entrada humana.";
  if (state === "EXECUTION_FINISHED") return "Verificando se o objetivo foi realmente atendido.";
  if (state === "RUNNING") return observation ? `Agora: ${redactText(observation)}` : "Executando o plano.";
  return "Aguardando execucao.";
}

function browserSources(steps: Record<string, unknown>[]) {
  return browserEvidence(steps as unknown as StepExecution[]).sources.filter((url) => safeExternalUrl(url)).slice(0, 12);
}

function stepState(status: string): TaskStepView["state"] {
  if (status === "COMPLETED") return "complete";
  if (status === "RUNNING") return "active";
  if (["FAILED", "BLOCKED"].includes(status)) return "failed";
  return "pending";
}

function modelWhy(step: Record<string, unknown>) {
  const selected = objectField(objectField(step, "route"), "selected");
  if (!stringField(selected, "model")) return ["Esta etapa usou uma ferramenta local sem selecao de modelo registrada."];
  return [
    `${stringField(selected, "model")} foi selecionado por ${stringField(selected, "provider")}.`,
    `Utility registrada: ${numericOrLabel(selected.utility)}.`,
    `Shadow/resource cost: ${numericOrLabel(selected.shadowCostUsd)}.`
  ];
}

function rewardLabel(reward: Record<string, unknown>) {
  const currency = stringField(reward, "currency") || "USD";
  const amount = numberOrUndefined(reward, "amount");
  const min = numberOrUndefined(reward, "minAmount");
  const max = numberOrUndefined(reward, "maxAmount");
  if (amount !== undefined) return `${usd(amount)} ${currency === "USD" ? "" : currency}`.trim();
  if (min !== undefined && max !== undefined) return `${usd(min)} - ${usd(max)} ${currency === "USD" ? "" : currency}`.trim();
  return "Recompensa nao informada";
}

function usd(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function percentLabel(value: number | undefined) {
  return value === undefined ? "Nao estimado" : `${Math.round(value * 100)}%`;
}

function riskLabel(value: number) {
  if (value >= 0.75) return "Alto";
  if (value >= 0.4) return "Medio";
  return "Baixo";
}

function humanFeasibility(value: string) {
  if (value === "FEASIBLE") return "Executavel";
  if (value === "PARTIALLY_FEASIBLE") return "Parcialmente executavel";
  if (value === "NOT_FEASIBLE") return "Nao executavel";
  return "Nao estimado";
}

function humanOpportunityDecision(value: string) {
  if (value === "QUEUE" || value === "QUEUED") return "Vale a pena analisar.";
  if (value === "IGNORE" || value === "IGNORED") return "Beyonder recomenda ignorar por enquanto.";
  if (value === "REQUIRES_APPROVAL") return "Precisa da sua aprovacao antes de avancar.";
  return "Aguardando avaliacao.";
}

function reasons(value: Record<string, unknown>) {
  return Array.isArray(value.reasons) ? value.reasons.map(String) : ["Sem justificativa registrada ainda."];
}

function humanReason(value: string) {
  return value
    .replace("reward is unknown; no value was invented", "recompensa nao informada; nenhum valor foi inventado")
    .replace("external, identity, payment, account, or capital action requires approval", "exige acao externa, identidade, conta, pagamento ou capital; precisa de aprovacao")
    .replace("deadline has passed", "prazo expirado");
}

function humanApprovalAction(value: string) {
  if (value === "APPLY_TO_OPPORTUNITY") return "Enviar candidatura";
  if (value === "SUBMIT_DELIVERABLE") return "Enviar deliverable";
  if (value === "SEND_EXTERNAL_MESSAGE") return "Enviar mensagem externa";
  if (value === "ACCEPT_TERMS") return "Aceitar termos";
  return "Acao externa";
}

function approvalStatus(value: string): ApprovalView["status"] {
  return ["PENDING", "APPROVED", "REJECTED", "EXPIRED", "CONSUMED"].includes(value) ? value as ApprovalView["status"] : "PENDING";
}

function providerStatus(value?: string): ProviderView["status"] {
  if (value === "healthy") return "READY";
  if (value === "keyless") return "KEYLESS";
  if (value === "human-action-required" || value === "manual-required") return "HUMAN_GATE";
  if (value === "skipped") return "DISABLED";
  if (value === "failed") return "UNHEALTHY";
  if (value === "missing-credential") return "UNKNOWN";
  return "UNKNOWN";
}

function humanProviderNote(status: ProviderView["status"]) {
  if (status === "READY") return "Conectado e pronto.";
  if (status === "KEYLESS") return "Disponivel sem chave.";
  if (status === "HUMAN_GATE") return "Precisa de configuracao humana.";
  if (status === "RATE_LIMITED") return "Limitado temporariamente.";
  if (status === "UNHEALTHY") return "Falhou no ultimo health check.";
  return "Quota atual nao conhecida.";
}

function normalizeMemoryKind(value: string): MemoryKind | undefined {
  return ["working", "episodic", "semantic", "procedural", "economic"].includes(value) ? value as MemoryKind : undefined;
}

function auditLevel(value: string): AuditEventView["level"] {
  return ["debug", "info", "warn", "error"].includes(value) ? value as AuditEventView["level"] : "unknown";
}

function auditCategory(event: string, level: string): AuditEventView["category"] {
  if (level === "error") return "errors";
  if (event.includes("approval")) return "decisions";
  if (event.includes("opportunit") || event.includes("application") || event.includes("source.")) return "opportunities";
  if (event.includes("task") || event.includes("step") || event.includes("tool")) return "jobs";
  return "all";
}

function humanAuditEvent(event: string, details: Record<string, unknown>) {
  if (event === "control.objective.completed") return "Objetivo concluido.";
  if (event === "control.objective.started") return "Objetivo iniciado.";
  if (event === "control.paused") return "Beyonder pausado.";
  if (event === "control.resumed") return "Beyonder retomado.";
  if (event === "approval.requested") return "Uma decisao precisa da sua aprovacao.";
  if (event === "approval.consumed") return "Aprovacao usada uma unica vez.";
  if (event === "source.health_updated") return `Fonte ${String(details.sourceId ?? "externa")} atualizou status.`;
  if (event === "tool.denied") return "Uma acao foi bloqueada por politica.";
  if (event.includes("failed")) return "Uma operacao falhou; detalhes tecnicos disponiveis.";
  return event.replaceAll(".", " ");
}

function checkpointExecution(raw: string): Record<string, unknown> | undefined {
  try {
    const payload = JSON.parse(raw) as { version?: unknown; execution?: unknown } | null;
    return payload?.version === 1 && payload.execution && typeof payload.execution === "object" ? payload.execution as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

export function safeExternalUrl(value: string): string | undefined { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; } }

function humanTaskResult(value: string): string {
  try {
    const data = JSON.parse(value);
    if (typeof data === "string" || typeof data === "number") return String(data);
    if (data.acceptedObjective) return "Objetivo registrado no modo de teste.";
    if (typeof data.value === "number") return String(data.value);
    if (typeof data.text === "string") return data.text;
    if (typeof data.result?.data?.text === "string") return data.result.data.text;
    if (typeof data.result?.observation?.text === "string") return data.result.observation.text;
  } catch { /* Plain text is already a human-readable result. */ }
  return value;
}

function isFixtureRun(value: unknown): boolean {
  const run = objectField(value);
  const submission = objectField(objectField(run, "deliverable"), "metadata").submissionEvidence;
  return run.source === "fixture" || objectField(run, "application").mode === "FIXTURE" || (typeof submission === "string" && submission.startsWith("fixture-")) || objectField(objectField(run, "settlement"), "evidence").source === "fixture";
}
