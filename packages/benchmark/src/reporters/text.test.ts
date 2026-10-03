import { describe, expect, it } from "vitest";
import { formatBenchmarkReport, formatRanking } from "./text.js";
import type { BenchmarkSummary } from "../types.js";

describe("benchmark text reporters", () => {
  it("prints per-capability report and category ranking", () => {
    const summaries: BenchmarkSummary[] = [
      summary("a", 0.9),
      summary("b", 0.7)
    ];
    expect(formatBenchmarkReport(summaries)).toContain("coding");
    expect(formatRanking("coding", summaries)).toContain("1. a / groq");
  });

  it("prints not evaluated models separately", () => {
    const output = formatRanking("coding", [notEvaluated("ovh-model")]);
    expect(output).toContain("NOT EVALUATED");
    expect(output).toContain("RATE_LIMITED (HTTP 429)");
    expect(output).not.toContain("quality: 0.00");
  });
});

function summary(model: string, avgQuality: number | null): BenchmarkSummary {
  return {
    provider: "groq",
    model,
    category: "coding",
    evaluatedSamples: 2,
    operationalFailures: 0,
    successes: 2,
    avgQuality,
    avgLatency: 100,
    avgCost: 0,
    medianLatency: 100,
    lastTestedAt: new Date()
  };
}

function notEvaluated(model: string): BenchmarkSummary {
  return {
    provider: "ovh",
    model,
    category: "coding",
    evaluatedSamples: 0,
    operationalFailures: 1,
    successes: 0,
    avgQuality: null,
    avgLatency: null,
    avgCost: 0,
    medianLatency: null,
    latestOperationalStatus: "RATE_LIMITED",
    latestHttpStatus: 429,
    latestFailureReason: "HTTP 429",
    lastTestedAt: new Date()
  };
}
