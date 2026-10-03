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
});

function summary(model: string, avgQuality: number): BenchmarkSummary {
  return {
    provider: "groq",
    model,
    category: "coding",
    samples: 2,
    successes: 2,
    avgQuality,
    avgLatency: 100,
    avgCost: 0,
    medianLatency: 100,
    lastTestedAt: new Date()
  };
}
