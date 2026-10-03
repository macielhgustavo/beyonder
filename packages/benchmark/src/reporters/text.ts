import { BENCHMARK_CATEGORIES } from "../cases/index.js";
import type { BenchmarkCategory, BenchmarkResult, BenchmarkSummary } from "../types.js";
import { notEvaluatedSummaries, rankSummaries, summarizeResults } from "../scoring/index.js";

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
      lines.push(`${category.padEnd(22)} ${summary?.avgQuality == null ? "N/A" : formatScore(summary.avgQuality)}`);
      if (summary?.evaluatedSamples === 0 && summary.operationalFailures > 0) {
        lines.push(`${"status".padEnd(22)} ${summary.latestOperationalStatus}${summary.latestHttpStatus ? ` (HTTP ${summary.latestHttpStatus})` : ""}`);
      }
    }
    const evaluated = summaries
      .filter((summary) => summary.model === model && summary.provider === provider)
      .reduce((sum, summary) => sum + summary.evaluatedSamples, 0);
    const operationalFailures = summaries
      .filter((summary) => summary.model === model && summary.provider === provider)
      .reduce((sum, summary) => sum + summary.operationalFailures, 0);
    lines.push("");
    lines.push(`evaluated: ${evaluated} cases`);
    lines.push(`operational failures: ${operationalFailures}`);
    lines.push("");
  }
  const cost = summaries.reduce((sum, summary) => sum + summary.avgCost * (summary.evaluatedSamples + summary.operationalFailures), 0);
  lines.push(`monetary cost: $${cost.toFixed(2)}`);
  return lines.join("\n").trimEnd();
}

export function formatRanking(category: BenchmarkCategory, summaries: BenchmarkSummary[]): string {
  const ranked = rankSummaries(summaries, category);
  const lines = [category.toUpperCase(), ""];
  const notEvaluated = notEvaluatedSummaries(summaries, category);
  if (!ranked.length && !notEvaluated.length) {
    lines.push("No benchmark results available.");
    return lines.join("\n");
  }
  ranked.forEach((summary, index) => {
    lines.push(`${index + 1}. ${summary.model} / ${summary.provider}`);
    lines.push(`   quality: ${formatScore(summary.avgQuality ?? 0)}`);
    lines.push(`   success: ${Math.round((summary.successes / summary.evaluatedSamples) * 100)}%`);
    lines.push(`   evaluated: ${summary.evaluatedSamples} cases`);
    lines.push(`   median latency: ${summary.medianLatency == null ? "N/A" : `${(summary.medianLatency / 1000).toFixed(1)}s`}`);
    lines.push("");
  });
  if (notEvaluated.length) {
    lines.push("NOT EVALUATED", "");
    for (const summary of notEvaluated) {
      lines.push(`${summary.model} / ${summary.provider}`);
      lines.push(`   ${summary.latestOperationalStatus}${summary.latestHttpStatus ? ` (HTTP ${summary.latestHttpStatus})` : ""}`);
      lines.push("");
    }
  }
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
