import type { BenchmarkCategory, BenchmarkResult, BenchmarkSummary } from "../types.js";

export function summarizeResults(results: BenchmarkResult[]): BenchmarkSummary[] {
  const groups = new Map<string, BenchmarkResult[]>();
  for (const result of results) {
    const key = `${result.provider}\u0000${result.model}\u0000${result.category}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }

  return [...groups.values()].map((items) => {
    const [first] = items;
    const sortedLatency = items.map((item) => item.latencyMs).sort((a, b) => a - b);
    return {
      provider: first.provider,
      model: first.model,
      category: first.category,
      samples: items.length,
      successes: items.filter((item) => item.success).length,
      avgQuality: average(items.map((item) => item.quality)),
      avgLatency: average(items.map((item) => item.latencyMs)),
      avgCost: average(items.map((item) => item.monetaryCost)),
      medianLatency: sortedLatency[Math.floor(sortedLatency.length / 2)] ?? 0,
      lastTestedAt: new Date(Math.max(...items.map((item) => item.timestamp.getTime())))
    };
  });
}

export function rankSummaries(summaries: BenchmarkSummary[], category: BenchmarkCategory): BenchmarkSummary[] {
  return summaries
    .filter((summary) => summary.category === category)
    .sort((a, b) => b.avgQuality - a.avgQuality || b.successes / b.samples - a.successes / a.samples || a.medianLatency - b.medianLatency);
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
