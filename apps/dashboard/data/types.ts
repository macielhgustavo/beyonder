export type RuntimeStatus = "online" | "degraded" | "offline" | "unknown";
export type EconomicState = "growth" | "normal" | "defensive" | "survival" | "halted" | "unknown";
export type ProviderStatus = "READY" | "HUMAN_GATE" | "UNHEALTHY" | "RATE_LIMITED" | "DISABLED" | "KEYLESS" | "UNKNOWN";
export type MemoryKind = "working" | "episodic" | "semantic" | "procedural" | "economic";
export type Capability = "coding" | "reasoning" | "planning" | "tool-use" | "structured" | "extraction" | "compression" | "memory";
export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";
export type DataProvenance = "local" | "mock" | "empty";

export interface PageQuery {
  limit?: number;
  offset?: number;
}

export interface Overview {
  runtimeStatus: RuntimeStatus;
  economicState: EconomicState;
  capitalUsd: number | null;
  balanceUsd: number | null;
  readyProviders: number;
  totalProviders: number;
  currentTask: TaskView | null;
  requestsToday: number | null;
  monetaryCostUsd: number | null;
  effectiveResourceCost: number | null;
  memoryCount: number | null;
  successRate: number | null;
  freeResources: number | null;
  recentDecisions: ModelDecisionView[];
  recentErrors: AuditEventView[];
  modelUsage: Array<{ label: string; value: number }>;
  provenance: DataProvenance;
}

export interface EconomyPoint {
  at: string;
  balanceUsd: number;
  revenueUsd: number;
  expensesUsd: number;
}

export interface EconomyView {
  balanceUsd: number | null;
  capitalUsd: number | null;
  revenueUsd: number | null;
  expensesUsd: number | null;
  runwayDays: number | null;
  monetarySpendUsd: number | null;
  shadowSpend: number | null;
  quotas: Array<{ label: string; used: number | null; limit: number | null; unit: string }>;
  economicState: EconomicState;
  history: EconomyPoint[];
  provenance: DataProvenance;
}

export interface ProviderView {
  id: string;
  name: string;
  status: ProviderStatus;
  models: number | null;
  quota: string | null;
  latencyMs: number | null;
  health: number | null;
  auth: "key" | "keyless" | "unknown";
  lastCheckAt: string | null;
  note?: string;
  provenance: DataProvenance;
}

export interface ModelView {
  id: string;
  name: string;
  provider: string;
  capabilities: Partial<Record<Capability, number>>;
  usage: number | null;
  latencyMs: number | null;
  successRate: number | null;
  effectiveCost: number | null;
  benchmarkAvailable: boolean;
  provenance: DataProvenance;
}

export interface DecisionFactor {
  label: string;
  value: number | string;
}

export interface ModelDecisionAlternative {
  label: string;
  utility: number | null;
}

export interface ModelDecisionView {
  id: string;
  selectedLabel: string;
  utility: number | null;
  reasons: DecisionFactor[];
  penalties: DecisionFactor[];
  alternatives: ModelDecisionAlternative[];
  decidedAt: string | null;
  taskId?: string;
  provenance: DataProvenance;
}

export interface MemoryView {
  id: string;
  kind: MemoryKind;
  content: string;
  importance: number | null;
  utility: number | null;
  confidence: number | null;
  createdAt: string;
  lastAccessedAt: string | null;
  accessCount: number;
  source?: string;
  taskId?: string;
  keywords: string[];
  provenance: DataProvenance;
}

export interface MemoryQuery extends PageQuery {
  search?: string;
  kind?: MemoryKind | "all";
}

export interface TaskStepView {
  label: string;
  detail?: string;
  state: "complete" | "active" | "pending" | "failed";
}

export interface TaskView {
  id: string;
  title: string;
  type: string | null;
  complexity: string | null;
  provider: string | null;
  model: string | null;
  attempts: number | null;
  evaluation: number | null;
  costUsd: number | null;
  durationMs: number | null;
  status: TaskStatus;
  createdAt: string | null;
  steps: TaskStepView[];
  provenance: DataProvenance;
}

export interface AuditEventView {
  id: string;
  level: "debug" | "info" | "warn" | "error" | "unknown";
  event: string;
  details: Record<string, unknown>;
  createdAt: string;
  provenance: DataProvenance;
}

export interface AuditQuery extends PageQuery {
  level?: AuditEventView["level"] | "all";
  search?: string;
}
