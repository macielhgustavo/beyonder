import type {
  ApprovalView,
  AuditEventView,
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

export class EmptyDashboardDataSource implements DashboardDataSource {
  readonly provenance = "empty" as const;

  async getWorkRuns() { return []; }
  async getSourceHealth() { return []; }
  async isDeveloperMode() { return false; }

  async getHome(): Promise<HomeView> {
    return {
      status: await this.getRuntimeStatus(),
      healthChecks: emptyHealthChecks(),
      needsYouCount: 0,
      activeTask: null,
      today: { completedTasks: 0, realMoneySpentUsd: 0, realRevenueUsd: 0, simulatedRevenueUsd: 0 },
      economy: await this.getEconomySummary(),
      firstRun: true,
      recentAudit: [],
      provenance: this.provenance
    };
  }

  async getRuntimeStatus(): Promise<RuntimeStatusView> {
    return {
      global: "OFFLINE",
      heartbeat: "OFFLINE",
      label: "Desligado",
      detail: "O runtime local ainda nao publicou um heartbeat.",
      lastHeartbeatAt: null,
      currentActivity: null
    };
  }

  async getTasks(_query?: PageQuery): Promise<TaskView[]> { return []; }
  async getOpportunities(_query?: PageQuery) { return []; }
  async getApprovals(_query?: PageQuery): Promise<ApprovalView[]> { return []; }
  async getProviders(_query?: PageQuery): Promise<ProviderView[]> { return []; }
  async getModelDecisions(_query?: PageQuery): Promise<ModelDecisionView[]> { return []; }
  async getMemories(_query?: MemoryQuery): Promise<MemoryView[]> { return []; }
  async getAuditEvents(): Promise<AuditEventView[]> { return []; }
  async getEconomySummary(): Promise<EconomySummary> {
    return { realMoneySpentUsd: 0, realRevenueUsd: 0, simulatedRevenueUsd: 0, shadowCostUsd: 0, computeConsumed: "0 tokens", monetaryCostTodayUsd: 0 };
  }
}

export function emptyHealthChecks(): HealthCheckView[] {
  return [
    { label: "Banco de dados", status: "warn", detail: "Aguardando primeira inicializacao local." },
    { label: "Runtime", status: "warn", detail: "Sem heartbeat ainda." },
    { label: "Browser", status: "warn", detail: "Nao verificado nesta sessao." },
    { label: "Compute", status: "warn", detail: "Providers aparecem em Recursos quando configurados." }
  ];
}
