import type {
  ApprovalView,
  AuditEventView,
  AuditQuery,
  DashboardDataSource,
  EconomySummary,
  HealthCheckView,
  HomeView,
  MemoryQuery,
  MemoryView,
  ModelDecisionView,
  PageQuery,
  ProviderView,
  RuntimeStatusView,
  TaskView
} from "./types";
import type { WorkRunView } from "./types";
import type { SourceReliability } from "@beyonder/runtime";

const NEEDS_CAPABILITY_MESSAGE = "Modelos adequados para esta missão estão indisponíveis. O compute local disponível está abaixo da qualidade mínima exigida.";
const CAPACITY_REDUCED_MESSAGE = "Capacidade reduzida: clouds adequados estão indisponíveis. Beyonder está usando compute local de emergência somente porque ele atende ao quality floor desta missão.";

export class CapacityAwareDashboardDataSource implements DashboardDataSource {
  readonly provenance;

  constructor(private readonly inner: DashboardDataSource) {
    this.provenance = inner.provenance;
  }

  isDeveloperMode() { return this.inner.isDeveloperMode(); }

  async getHome(): Promise<HomeView> {
    const [home, audit] = await Promise.all([
      this.inner.getHome(),
      this.inner.getAuditEvents({ limit: 200 })
    ]);
    const recentMissions = home.recentMissions.map((task) => decorateTaskCapacity(task, audit));
    const activeTask = home.activeTask ? decorateTaskCapacity(home.activeTask, audit) : null;
    const capabilityBlocked = [activeTask, ...recentMissions].find((task) => task?.objectiveStatus === "NEEDS_CAPABILITY");
    const capacityReduced = [activeTask, ...recentMissions].find((task) => task && hasCapacityEvent(task, audit, "router.capacity_reduced"));
    return {
      ...home,
      activeTask,
      recentMissions,
      status: capabilityBlocked
        ? capacityStatus(home.status, "NEEDS_CAPABILITY")
        : capacityReduced && capacityReduced.status !== "succeeded"
          ? capacityStatus(home.status, "CAPACITY_REDUCED")
          : home.status
    };
  }

  async getRuntimeStatus(): Promise<RuntimeStatusView> {
    const [status, tasks, audit] = await Promise.all([
      this.inner.getRuntimeStatus(),
      this.inner.getTasks({ limit: 100 }),
      this.inner.getAuditEvents({ limit: 200 })
    ]);
    const decorated = tasks.map((task) => decorateTaskCapacity(task, audit));
    if (decorated.some((task) => task.objectiveStatus === "NEEDS_CAPABILITY" && task.status === "blocked")) {
      return capacityStatus(status, "NEEDS_CAPABILITY");
    }
    if (decorated.some((task) => task.status === "running" && hasCapacityEvent(task, audit, "router.capacity_reduced"))) {
      return capacityStatus(status, "CAPACITY_REDUCED");
    }
    return status;
  }

  async getWorkRuns(): Promise<WorkRunView[]> { return this.inner.getWorkRuns(); }
  async getSourceHealth(): Promise<SourceReliability[]> { return this.inner.getSourceHealth(); }

  async getTasks(query?: PageQuery): Promise<TaskView[]> {
    const [tasks, audit] = await Promise.all([
      this.inner.getTasks(query),
      this.inner.getAuditEvents({ limit: 300 })
    ]);
    return tasks.map((task) => decorateTaskCapacity(task, audit));
  }

  async getTask(taskId: string): Promise<TaskView | null> {
    const [task, audit] = await Promise.all([
      this.inner.getTask(taskId),
      this.inner.getAuditEvents({ limit: 300 })
    ]);
    return task ? decorateTaskCapacity(task, audit) : null;
  }

  getOpportunities(query?: PageQuery) { return this.inner.getOpportunities(query); }
  getApprovals(query?: PageQuery): Promise<ApprovalView[]> { return this.inner.getApprovals(query); }
  getProviders(query?: PageQuery): Promise<ProviderView[]> { return this.inner.getProviders(query); }

  async getModelDecisions(query?: PageQuery): Promise<ModelDecisionView[]> {
    const [decisions, audit] = await Promise.all([
      this.inner.getModelDecisions(query),
      this.inner.getAuditEvents({ limit: 500 })
    ]);
    return decisions.map((decision) => decorateModelDecisionCapacity(decision, audit));
  }

  getMemories(query?: MemoryQuery): Promise<MemoryView[]> { return this.inner.getMemories(query); }
  getAuditEvents(query?: AuditQuery): Promise<AuditEventView[]> { return this.inner.getAuditEvents(query); }
  getEconomySummary(): Promise<EconomySummary> { return this.inner.getEconomySummary(); }
}

export function decorateTaskCapacity(task: TaskView, audit: AuditEventView[]): TaskView {
  const taskEvents = eventsForTask(task, audit);
  const needsCapability = task.objectiveStatus === "NEEDS_CAPABILITY"
    || task.attempts?.some((attempt) => attempt.failureClass === "NEEDS_CAPABILITY")
    || taskEvents.some((event) => event.event === "router.needs_capability");
  if (needsCapability) {
    return {
      ...task,
      status: "blocked",
      humanStatus: NEEDS_CAPABILITY_MESSAGE,
      failureSummary: NEEDS_CAPABILITY_MESSAGE,
      why: unique([NEEDS_CAPABILITY_MESSAGE, ...task.why])
    };
  }

  const reduced = taskEvents.find((event) => event.event === "router.capacity_reduced");
  if (!reduced) return task;
  const selected = typeof reduced.details.selected === "string" ? reduced.details.selected : undefined;
  const detail = selected ? `${CAPACITY_REDUCED_MESSAGE} Airbag selecionado: ${selected}.` : CAPACITY_REDUCED_MESSAGE;
  return {
    ...task,
    humanStatus: task.status === "succeeded" ? `Concluído com capacidade reduzida. ${detail}` : detail,
    why: unique([detail, ...task.why])
  };
}

export function decorateModelDecisionCapacity(decision: ModelDecisionView, audit: AuditEventView[]): ModelDecisionView {
  if (!decision.taskId) return decision;
  const events = audit.filter((event) => event.details.taskId === decision.taskId);
  const selected = events.find((event) => event.event === "router.selected");
  const floor = events.find((event) => event.event === "router.quality_floor_resolved");
  const rejected = events.filter((event) => event.event === "router.candidate_rejected");
  const capabilityFit = objectField(selected?.details.capabilityFit);
  const additions: ModelDecisionView["reasons"] = [];
  if (typeof selected?.details.computeTier === "string") additions.push({ label: "fallback tier", value: selected.details.computeTier });
  if (typeof capabilityFit.overall === "number") additions.push({ label: "capability fit", value: capabilityFit.overall });
  if (typeof floor?.details.level === "string") additions.push({ label: "quality floor", value: `${floor.details.level} / ${formatNumber(floor.details.minimumOverall)}` });
  if (rejected.length) additions.push({ label: "candidatos rejeitados", value: rejected.length });

  const humanWhy = [...decision.humanWhy];
  if (typeof selected?.details.computeTier === "string") humanWhy.unshift(`Tier de compute: ${selected.details.computeTier}.`);
  if (typeof floor?.details.level === "string") humanWhy.push(`Quality floor da missão: ${floor.details.level} (${formatNumber(floor.details.minimumOverall)}).`);
  if (rejected.length) humanWhy.push(`${rejected.length} candidato(s) foram rejeitados por capacidade, saúde ou política; os motivos completos permanecem no audit técnico.`);

  return {
    ...decision,
    reasons: mergeReasons(decision.reasons, additions),
    humanWhy: unique(humanWhy)
  };
}

function capacityStatus(base: RuntimeStatusView, mode: "NEEDS_CAPABILITY" | "CAPACITY_REDUCED"): RuntimeStatusView {
  return {
    ...base,
    global: "DEGRADED",
    label: mode === "NEEDS_CAPABILITY" ? "Capacidade insuficiente" : "Capacidade reduzida",
    detail: mode === "NEEDS_CAPABILITY" ? NEEDS_CAPABILITY_MESSAGE : CAPACITY_REDUCED_MESSAGE
  };
}

function hasCapacityEvent(task: TaskView, audit: AuditEventView[], eventName: string): boolean {
  return eventsForTask(task, audit).some((event) => event.event === eventName);
}

function eventsForTask(task: TaskView, audit: AuditEventView[]): AuditEventView[] {
  const ids = new Set([task.taskId, task.technicalId].filter((value): value is string => Boolean(value)));
  return audit.filter((event) => typeof event.details.taskId === "string" && ids.has(event.details.taskId));
}

function objectField(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function formatNumber(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "desconhecido";
}

function mergeReasons(current: ModelDecisionView["reasons"], additions: ModelDecisionView["reasons"]): ModelDecisionView["reasons"] {
  const byLabel = new Map(current.map((item) => [item.label, item]));
  for (const addition of additions) byLabel.set(addition.label, addition);
  return [...byLabel.values()];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export { CAPACITY_REDUCED_MESSAGE, NEEDS_CAPABILITY_MESSAGE };
