import type { BenchmarkCategory, BenchmarkResult, BenchmarkSummary, ProviderOperationalStats } from "../types.js";

const EVALUATED_STATUSES = new Set(["PASS", "FAIL"]);

export function summarizeResults(results: BenchmarkResult[]): BenchmarkSummary[] {
  const groups = new Map<string, BenchmarkResult[]>();
  for (const result of results) {
    const key = `${result.provider}\u0000${result.model}\u0000${result.category}\u0000${result.inferenceProfile ?? "legacy"}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }

  return [...groups.values()].map((items) => {
    const [first] = items;
    const evaluated = items.filter((item) => isEvaluated(item));
    const operationalFailures = items.filter((item) => !isEvaluated(item));
    const sortedLatency = evaluated
      .map((item) => item.latencyMs)
      .filter((latency): latency is number => typeof latency === "number")
      .sort((a, b) => a - b);
    const latestFailure = operationalFailures.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
    return {
      provider: first.provider,
      inferenceProfile: first.inferenceProfile,
      structuredOutputMode: evaluated.length && evaluated.every(item => item.structuredOutputMode === evaluated[0]!.structuredOutputMode) ? evaluated[0]!.structuredOutputMode : undefined,
      model: first.model,
      category: first.category,
      evaluatedSamples: evaluated.length,
      distinctEvaluatedCases: new Set(evaluated.map(item => item.caseId)).size,
      operationalFailures: operationalFailures.length,
      successes: evaluated.filter((item) => item.success).length,
      avgQuality: evaluated.length ? average(evaluated.map((item) => item.quality ?? 0)) : null,
      avgLatency: sortedLatency.length ? average(sortedLatency) : null,
      avgCost: average(items.map((item) => item.monetaryCost)),
      medianLatency: sortedLatency[Math.floor(sortedLatency.length / 2)] ?? null,
      latestOperationalStatus: latestFailure?.status,
      latestFailureReason: latestFailure?.failureReason,
      latestHttpStatus: latestFailure?.httpStatus,
      lastTestedAt: new Date(Math.max(...items.map((item) => item.timestamp.getTime()))),
      lastEvaluatedAt: evaluated.length ? new Date(Math.max(...evaluated.map(item => item.timestamp.getTime()))) : undefined
    };
  });
}

export function rankSummaries(summaries: BenchmarkSummary[], category: BenchmarkCategory): BenchmarkSummary[] {
  return summaries
    .filter((summary) => summary.category === category && summary.evaluatedSamples > 0 && summary.avgQuality !== null)
    .sort(
      (a, b) =>
        (b.avgQuality ?? 0) - (a.avgQuality ?? 0) ||
        b.successes / b.evaluatedSamples - a.successes / a.evaluatedSamples ||
        (a.medianLatency ?? Number.MAX_SAFE_INTEGER) - (b.medianLatency ?? Number.MAX_SAFE_INTEGER)
    );
}

export function notEvaluatedSummaries(summaries: BenchmarkSummary[], category: BenchmarkCategory): BenchmarkSummary[] {
  return summaries.filter((summary) => summary.category === category && summary.evaluatedSamples === 0 && summary.operationalFailures > 0);
}

export function summarizeProviderOperations(results: BenchmarkResult[]): ProviderOperationalStats[] {
  const groups = new Map<string, BenchmarkResult[]>();
  for (const result of results) {
    const key = `${result.provider}\u0000${result.model}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  return [...groups.values()].map((items) => {
    const [first] = items;
    const successfulRequests = items.filter((item) => isEvaluated(item)).length;
    return {
      provider: first.provider,
      model: first.model,
      requests: items.length,
      successfulRequests,
      rateLimited: countStatus(items, "RATE_LIMITED"),
      timeouts: countStatus(items, "TIMEOUT"),
      providerErrors: countStatus(items, "PROVIDER_ERROR"),
      authErrors: countStatus(items, "AUTH_ERROR"),
      quotaExhausted: countStatus(items, "QUOTA_EXHAUSTED"),
      billingRequired: countStatus(items, "BILLING_REQUIRED"),
      invalidEndpoint: countStatus(items, "INVALID_ENDPOINT"),
      modelUnavailable: countStatus(items, "MODEL_UNAVAILABLE"),
      unavailable: countStatus(items, "UNAVAILABLE"),
      unsupported: countStatus(items, "UNSUPPORTED"),
      unknown: countStatus(items, "UNKNOWN"),
      skipped: countStatus(items, "SKIPPED"),
      availabilityRate: items.length ? successfulRequests / items.length : 0
    };
  });
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isEvaluated(result: BenchmarkResult): boolean {
  return EVALUATED_STATUSES.has(result.status);
}

function countStatus(items: BenchmarkResult[], status: BenchmarkResult["status"]): number {
  return items.filter((item) => item.status === status).length;
}
