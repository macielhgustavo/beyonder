import type { DashboardDataSource } from "./source";
import type { AuditQuery, MemoryQuery, PageQuery } from "./types";

export class EmptyDashboardDataSource implements DashboardDataSource {
  readonly provenance = "empty" as const;

  async getOverview() {
    return {
      runtimeStatus: "unknown" as const,
      economicState: "unknown" as const,
      capitalUsd: null,
      balanceUsd: null,
      readyProviders: 0,
      totalProviders: 0,
      currentTask: null,
      requestsToday: null,
      monetaryCostUsd: null,
      effectiveResourceCost: null,
      memoryCount: null,
      successRate: null,
      freeResources: null,
      recentDecisions: [],
      recentErrors: [],
      modelUsage: [],
      provenance: this.provenance
    };
  }

  async getEconomy() {
    return {
      balanceUsd: null,
      capitalUsd: null,
      revenueUsd: null,
      expensesUsd: null,
      runwayDays: null,
      monetarySpendUsd: null,
      shadowSpend: null,
      quotas: [],
      economicState: "unknown" as const,
      history: [],
      provenance: this.provenance
    };
  }

  async getProviders(_query?: PageQuery) { return []; }
  async getModels(_query?: PageQuery) { return []; }
  async getTasks(_query?: PageQuery) { return []; }
  async getMemories(_query?: MemoryQuery) { return []; }
  async getAuditEvents(_query?: AuditQuery) { return []; }
}
