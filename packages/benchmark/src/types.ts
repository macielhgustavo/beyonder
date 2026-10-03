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
  quality: number;
  success: boolean;
  latencyMs: number;
  monetaryCost: number;
  tokens?: number;
  attempts: number;
  error?: string;
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
  samples: number;
  successes: number;
  avgQuality: number;
  avgLatency: number;
  avgCost: number;
  medianLatency: number;
  lastTestedAt: Date;
}

export interface BenchmarkModelClient {
  complete(target: ModelTarget, messages: BenchmarkModelMessage[]): Promise<BenchmarkModelResponse>;
}

export interface TelemetrySink {
  emit(event: string, details: Record<string, unknown>): void | Promise<void>;
}
