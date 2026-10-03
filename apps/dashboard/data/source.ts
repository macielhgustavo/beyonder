import type {
  AuditEventView,
  AuditQuery,
  EconomyView,
  MemoryQuery,
  MemoryView,
  ModelView,
  Overview,
  PageQuery,
  ProviderView,
  TaskView
} from "./types";

export interface DashboardDataSource {
  readonly provenance: "local" | "mock" | "empty";
  getOverview(): Promise<Overview>;
  getEconomy(): Promise<EconomyView>;
  getProviders(query?: PageQuery): Promise<ProviderView[]>;
  getModels(query?: PageQuery): Promise<ModelView[]>;
  getTasks(query?: PageQuery): Promise<TaskView[]>;
  getMemories(query?: MemoryQuery): Promise<MemoryView[]>;
  getAuditEvents(query?: AuditQuery): Promise<AuditEventView[]>;
}
