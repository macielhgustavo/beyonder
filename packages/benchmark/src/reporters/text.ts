import { BENCHMARK_CATEGORIES } from "../cases/index.js";
import type { BenchmarkCategory, BenchmarkResult, BenchmarkSummary } from "../types.js";
import { rankSummaries, summarizeResults } from "../scoring/index.js";

export function formatBenchmarkReport(resultsOrSummaries: BenchmarkResult[] | BenchmarkSummary[]): string {
  const summaries = isResults(resultsOrSummaries) ? summarizeResults(resultsOrSummaries) : resultsOrSummaries;
  if (!summaries.length) return "MODEL PERFORMANCE\n\nNo benchmark results available.";
  const modelKeys = unique(summaries.map((summary) => `${summary.model} / ${summary.provider}`));
  const lines = ["MODEL PERFORMANCE", ""];
  for (const key of modelKeys) {
    lines.push(key, "");
    const [model, provider] = key.split(" / ");
    for (const category of BENCHMARK_CATEGORIES) {
      const summary = summaries.find((entry) => entry.model === model && entry.provider === provider && entry.category === category);
      lines.push(`${category.padEnd(22)} ${formatScore(summary?.avgQuality ?? 0)}`);
    }
    lines.push("");
  }
  const cost = summaries.reduce((sum, summary) => sum + summary.avgCost * summary.samples, 0);
  lines.push(`monetary cost: $${cost.toFixed(2)}`);
  return lines.join("\n").trimEnd();
}

export function formatRanking(category: BenchmarkCategory, summaries: BenchmarkSummary[]): string {
  const ranked = rankSummaries(summaries, category);
  const lines = [category.toUpperCase(), ""];
  if (!ranked.length) {
    lines.push("No benchmark results available.");
    return lines.join("\n");
  }
  ranked.forEach((summary, index) => {
    lines.push(`${index + 1}. ${summary.model} / ${summary.provider}`);
    lines.push(`   quality: ${formatScore(summary.avgQuality)}`);
    lines.push(`   success: ${Math.round((summary.successes / summary.samples) * 100)}%`);
    lines.push(`   median latency: ${(summary.medianLatency / 1000).toFixed(1)}s`);
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

function isResults(input: BenchmarkResult[] | BenchmarkSummary[]): input is BenchmarkResult[] {
  return Boolean(input[0] && "caseId" in input[0]);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function formatScore(score: number): string {
  return score.toFixed(2);
}
