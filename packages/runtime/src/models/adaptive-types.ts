import type { EconomicState } from "../types.js";
import type { IntelligenceTask, IntelligenceTaskType } from "../intelligence/contracts.js";
import type { ModelCapabilityEvidence } from "./capability-source.js";

export type ProviderHealth = "healthy" | "keyless" | "unhealthy" | "unknown";
export type QuotaValue = number | "unknown";

export interface QuotaSnapshot {
  provider: string;
  model?: string;
  requestsPerMinute: QuotaValue;
  requestsPerDay: QuotaValue;
  tokensPerMinute: QuotaValue;
  tokensPerDay: QuotaValue;
  requestQuotaTotal: QuotaValue;
  requestQuotaRemaining: QuotaValue;
  tokenQuotaTotal: QuotaValue;
  tokenQuotaRemaining: QuotaValue;
  resetAt: string | "unknown";
  health: ProviderHealth;
  lastUpdatedAt: string | "unknown";
}

export interface HistoricalPerformance {
  provider: string;
  model: string;
  taskType: IntelligenceTaskType;
  samples: number;
  successes: number;
  failures: number;
  successRate: number;
  avgEvaluationScore: number;
  avgLatencyMs: number;
  avgMonetaryCostUsd: number;
  avgShadowCostUsd: number;
  avgAttempts: number;
  updatedAt?: string;
}

export interface CapabilityPredictionEvidence {
  bibScore: number | null;
  bibSamples: number;
  realScore: number | null;
  realSamples: number;
  predictedScore: number;
  source: "metadata" | "BIB" | "outcomes" | "BIB + outcomes";
}

export interface CandidateExplanation {
  positives: Array<{ signal: string; value: number | string }>;
  penalties: Array<{ signal: string; value: number | string }>;
  constraints: string[];
}

export interface ModelCandidate {
  local?: boolean;
  externalQuotaConsumption?: boolean;
  costClass?: "FREE_CONFIRMED" | "FREE_TIER_ELIGIBLE" | "UNKNOWN_COST" | "PAID";
  structuredOutput?: "native" | "prompted" | "unsupported" | "unknown";
  provider: string;
  model: string;
  capabilities: string[];
  contextWindow: number | "unknown";
  toolCalling: "yes" | "no" | "unknown";
  predictedQuality: number;
  historicalSuccess: number;
  reliability: number;
  monetaryCostUsd: number;
  shadowCostUsd: number;
  latencyPenalty: number;
  failureRisk: number;
  effectiveResourceCost: number;
  utility: number;
  quota: QuotaSnapshot;
  performance: HistoricalPerformance;
  benchmarkCapability: ModelCapabilityEvidence | null;
  capabilityEvidence: CapabilityPredictionEvidence;
  explanation: CandidateExplanation;
}

export interface RouteDecision {
  task: IntelligenceTask;
  economicState: EconomicState;
  candidates: ModelCandidate[];
  selected?: ModelCandidate;
  explored: boolean;
  reason: string;
}

export interface RouterTelemetry {
  record(level: "debug" | "info" | "warn" | "error", event: string, details?: Record<string, unknown>): Promise<void>;
}

export interface RouteContext {
  task: IntelligenceTask;
  economicState: EconomicState;
}
