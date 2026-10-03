export type BenchmarkCategory =
  | "reasoning"
  | "coding"
  | "planning"
  | "tool-use"
  | "structured-output"
  | "extraction"
  | "compression"
  | "instruction-following";

export type BenchmarkEvaluator = "exact" | "json-schema" | "contains" | "code-test" | "heuristic";

export type BenchmarkMode = "smoke" | "standard";

export type BenchmarkExecutionStatus =
  | "PASS"
  | "FAIL"
  | "RATE_LIMITED"
  | "AUTH_ERROR"
  | "QUOTA_EXHAUSTED"
  | "BILLING_REQUIRED"
  | "PROVIDER_ERROR"
  | "INVALID_ENDPOINT"
  | "MODEL_UNAVAILABLE"
  | "TIMEOUT"
  | "UNAVAILABLE"
  | "UNSUPPORTED"
  | "UNKNOWN"
  | "SKIPPED";

export interface BenchmarkCase {
  id: string;
  category: BenchmarkCategory;
  prompt: string;
  difficulty: number;
  evaluator: BenchmarkEvaluator;
  expected?: unknown;
  smoke?: boolean;
}

export interface EvaluationResult {
  quality: number;
  success: boolean;
  details: Record<string, unknown>;
}

export interface BenchmarkResult {
  id?: string;
  caseId: string;
  provider: string;
  model: string;
  category: BenchmarkCategory;
  status: BenchmarkExecutionStatus;
  quality: number | null;
  success: boolean | null;
  latencyMs?: number;
  monetaryCost: number;
  tokens?: number;
  attempts: number;
  httpStatus?: number;
  errorCode?: string;
  failureReason?: string;
  timestamp: Date;
}

export interface ModelTarget {
  provider: string;
  providerName: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  accountId?: string;
  rateLimitDelayMs?: number;
}

export interface BenchmarkModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface BenchmarkModelResponse {
  content: string;
  provider: string;
  model: string;
  estimatedCostUsd: number;
  raw?: unknown;
  tokens?: number;
}

export interface BenchmarkSummary {
  provider: string;
  model: string;
  category: BenchmarkCategory;
  evaluatedSamples: number;
  operationalFailures: number;
  successes: number;
  avgQuality: number | null;
  avgLatency: number | null;
  avgCost: number;
  medianLatency: number | null;
  latestOperationalStatus?: BenchmarkExecutionStatus;
  latestFailureReason?: string;
  latestHttpStatus?: number;
  lastTestedAt: Date;
}

export interface ProviderOperationalStats {
  provider: string;
  model: string;
  requests: number;
  successfulRequests: number;
  rateLimited: number;
  timeouts: number;
  providerErrors: number;
  authErrors: number;
  quotaExhausted: number;
  billingRequired: number;
  invalidEndpoint: number;
  modelUnavailable: number;
  unavailable: number;
  unsupported: number;
  unknown: number;
  skipped: number;
  availabilityRate: number;
}

export interface BenchmarkModelClient {
  complete(target: ModelTarget, messages: BenchmarkModelMessage[]): Promise<BenchmarkModelResponse>;
}

export interface TelemetrySink {
  emit(event: string, details: Record<string, unknown>): void | Promise<void>;
}
