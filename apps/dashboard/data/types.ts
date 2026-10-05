import type { WorkRun, SourceReliability } from "@beyonder/runtime";
export type WorkRunView = WorkRun & { title: string; sourceUrl?: string; fixture: boolean };
export type DataProvenance = "local" | "mock" | "empty";
export type GlobalStatus = "OFFLINE" | "READY" | "WORKING" | "WAITING_FOR_YOU" | "ATTENTION_REQUIRED" | "PAUSED" | "DEGRADED" | "STARTING";
export type HeartbeatStatus = "ONLINE" | "OFFLINE" | "STARTING" | "PAUSED" | "DEGRADED";
export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "planning" | "waiting" | "blocked" | "unknown";
export type ProviderStatus = "READY" | "HUMAN_GATE" | "UNHEALTHY" | "RATE_LIMITED" | "DISABLED" | "KEYLESS" | "UNKNOWN";
export type MemoryKind = "working" | "episodic" | "semantic" | "procedural" | "economic";

export interface PageQuery {
  limit?: number;
  offset?: number;
}

export interface ControlCenterState {
  paused: boolean;
  developerMode: boolean;
  firstRunComplete: boolean;
  lastHeartbeatAt: string | null;
  currentActivity: string | null;
  safeShutdownRequestedAt?: string;
  emergencyStopRequestedAt?: string;
}

export interface RuntimeStatusView {
  global: GlobalStatus;
  heartbeat: HeartbeatStatus;
  label: string;
  detail: string;
  lastHeartbeatAt: string | null;
  currentActivity: string | null;
}

export interface HealthCheckView {
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface EconomySummary {
  estimatedRevenueUsd?: number;
  realMoneySpentUsd: number;
  realRevenueUsd: number;
  simulatedRevenueUsd: number;
  shadowCostUsd: number;
  computeConsumed: string;
  monetaryCostTodayUsd: number;
}

export interface HomeView {
  status: RuntimeStatusView;
  healthChecks: HealthCheckView[];
  needsYouCount: number;
  activeTask: TaskView | null;
  recentMissions: TaskView[];
  today: {
    completedTasks: number;
    realMoneySpentUsd: number;
    realRevenueUsd: number;
    simulatedRevenueUsd: number;
  };
  economy: EconomySummary;
  firstRun: boolean;
  recentAudit: AuditEventView[];
  provenance: DataProvenance;
}

export interface TaskStepView {
  label: string;
  detail?: string;
  state: "complete" | "active" | "pending" | "failed";
}

export interface TaskView {
  canResume?: boolean;
  resumeTaskId?: string;
  failureSummary?: string;
  attempts?: Array<{ phase: string; provider: string; model: string; status: string; failureClass?: string; httpStatus?: number; error?: string }>;
  current?: string;
  next?: string;
  tool?: string;
  fixture?: boolean;
  id: string;
  taskId?: string;
  title: string;
  humanStatus: string;
  status: TaskStatus;
  result: string | null;
  resultVerified: boolean;
  objectiveStatus?: string;
  executionPhase?: string;
  confidence: number | null;
  evidenceSources: string[];
  provider: string | null;
  model: string | null;
  costUsd: number;
  shadowCostUsd: number;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  steps: TaskStepView[];
  why: string[];
  technicalId?: string;
  provenance: DataProvenance;
}

export interface OpportunityView {
  externalActionMode?: "AUTOMATED_REAL" | "MANUAL_REQUIRED" | "FIXTURE";
  sourceUrl?: string;
  fixture?: boolean;
  id: string;
  title: string;
  source: string;
  rewardLabel: string;
  deadlineLabel: string;
  feasibility: string;
  estimatedSuccessLabel: string;
  estimatedCostLabel: string;
  riskLabel: string;
  decisionLabel: string;
  confidenceLabel: string;
  humanSummary: string;
  why: string[];
  canPrepareApplication: boolean;
  technicalId?: string;
  provenance: DataProvenance;
}

export interface ApprovalView {
  id: string;
  title: string;
  destination: string;
  opportunityTitle: string;
  rewardLabel: string;
  payloadPreview: string;
  riskLabel: string;
  risks: string[];
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CONSUMED";
  createdAt: string;
  expiresAt: string | null;
  authorizationScope: string[];
  technicalId?: string;
  provenance: DataProvenance;
}

export interface ProviderView {
  placement?: "CLOUD" | "LOCAL";
  id: string;
  name: string;
  status: ProviderStatus;
  runway: { state: "KNOWN" | "ESTIMATED" | "UNKNOWN"; label: string };
  latencyMs: number | null;
  health: number | null;
  configured: boolean;
  verified: boolean;
  setupEnvVar?: string;
  lastCheckAt: string | null;
  note?: string;
  provenance: DataProvenance;
}

export interface ModelDecisionView {
  id: string;
  selectedLabel: string;
  utility: number | null;
  reasons: Array<{ label: string; value: number | string }>;
  penalties: Array<{ label: string; value: number | string }>;
  alternatives: Array<{ label: string; utility: number | null }>;
  decidedAt: string | null;
  taskId?: string;
  humanWhy: string[];
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

export interface AuditEventView {
  id: string;
  level: "debug" | "info" | "warn" | "error" | "unknown";
  event: string;
  humanEvent: string;
  details: Record<string, unknown>;
  createdAt: string;
  category: "jobs" | "opportunities" | "decisions" | "errors" | "all";
  provenance: DataProvenance;
}

export interface AuditQuery extends PageQuery {
  level?: AuditEventView["level"] | "all";
  search?: string;
}

export interface DashboardDataSource {
  readonly provenance: DataProvenance;
  isDeveloperMode(): Promise<boolean>;
  getHome(): Promise<HomeView>;
  getRuntimeStatus(): Promise<RuntimeStatusView>;
  getWorkRuns(): Promise<WorkRunView[]>;
  getSourceHealth(): Promise<SourceReliability[]>;
  getTasks(query?: PageQuery): Promise<TaskView[]>;
  getTask(taskId: string): Promise<TaskView | null>;
  getOpportunities(query?: PageQuery): Promise<OpportunityView[]>;
  getApprovals(query?: PageQuery): Promise<ApprovalView[]>;
  getProviders(query?: PageQuery): Promise<ProviderView[]>;
  getModelDecisions(query?: PageQuery): Promise<ModelDecisionView[]>;
  getMemories(query?: MemoryQuery): Promise<MemoryView[]>;
  getAuditEvents(query?: AuditQuery): Promise<AuditEventView[]>;
  getEconomySummary(): Promise<EconomySummary>;
}
