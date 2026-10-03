import type { WebEvalMetrics, WebEvalResult } from "./types.js";

export type CapabilityProjectionMetric = keyof Pick<
  WebEvalMetrics,
  "toolSelectionAccuracy" | "argumentValidity" | "executionSuccess" | "taskCompletion" | "policyCompliance"
>;

export interface BenchmarkProjectionTarget {
  provider: string;
  model: string;
}

export interface BenchmarkCompatibleResult {
  caseId: string;
  provider: string;
  model: string;
  category: "tool-use" | "extraction";
  status: "PASS" | "FAIL" | "TIMEOUT" | "UNAVAILABLE";
  quality: number | null;
  success: boolean | null;
  latencyMs: number;
  monetaryCost: number;
  attempts: number;
  failureReason?: string;
  timestamp: Date;
  sourceMetric: CapabilityProjectionMetric;
}

/**
 * Projects exactly one web-eval metric into the scalar BIB shape.
 *
 * Deliberately does not blend tool selection, argument quality, execution,
 * completion and policy into one score. Callers must state which capability
 * dimension they want to feed into a scalar benchmark consumer.
 */
export function projectWebEvalToBenchmark(
  result: WebEvalResult,
  target: BenchmarkProjectionTarget,
  metric: CapabilityProjectionMetric
): BenchmarkCompatibleResult {
  if (result.status === "NOT_EVALUATED") {
    return {
      caseId: `${result.caseId}:${metric}`,
      provider: target.provider,
      model: target.model,
      category: benchmarkCategory(result),
      status: "UNAVAILABLE",
      quality: null,
      success: null,
      latencyMs: result.metrics.latency,
      monetaryCost: result.metrics.monetaryCost,
      attempts: 1,
      failureReason: stringDetail(result, "reason") ?? "web/tool infrastructure unavailable",
      timestamp: result.timestamp,
      sourceMetric: metric
    };
  }

  if (result.status === "TIMEOUT") {
    return {
      caseId: `${result.caseId}:${metric}`,
      provider: target.provider,
      model: target.model,
      category: benchmarkCategory(result),
      status: "TIMEOUT",
      quality: null,
      success: null,
      latencyMs: result.metrics.latency,
      monetaryCost: result.metrics.monetaryCost,
      attempts: 1,
      failureReason: stringDetail(result, "reason") ?? "web eval timeout",
      timestamp: result.timestamp,
      sourceMetric: metric
    };
  }

  const quality = result.metrics[metric];
  if (quality == null) {
    return {
      caseId: `${result.caseId}:${metric}`,
      provider: target.provider,
      model: target.model,
      category: benchmarkCategory(result),
      status: "UNAVAILABLE",
      quality: null,
      success: null,
      latencyMs: result.metrics.latency,
      monetaryCost: result.metrics.monetaryCost,
      attempts: 1,
      failureReason: `metric ${metric} is not applicable to this case`,
      timestamp: result.timestamp,
      sourceMetric: metric
    };
  }

  return {
    caseId: `${result.caseId}:${metric}`,
    provider: target.provider,
    model: target.model,
    category: benchmarkCategory(result),
    status: quality === 1 ? "PASS" : "FAIL",
    quality,
    success: quality === 1,
    latencyMs: result.metrics.latency,
    monetaryCost: result.metrics.monetaryCost,
    attempts: 1,
    timestamp: result.timestamp,
    sourceMetric: metric
  };
}

function benchmarkCategory(result: WebEvalResult): "tool-use" | "extraction" {
  return result.category === "information-extraction" ? "extraction" : "tool-use";
}

function stringDetail(result: WebEvalResult, key: string): string | undefined {
  const value = result.details[key];
  return typeof value === "string" ? value : undefined;
}
