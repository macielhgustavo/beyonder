import { describe, expect, it } from "vitest";
import { rankSummaries, summarizeResults } from "./index.js";
import type { BenchmarkResult } from "../types.js";

describe("benchmark scoring", () => {
  it("summarizes and ranks by category", () => {
    const summaries = summarizeResults([
      result("a", "coding", 1, true, 200),
      result("a", "coding", 0.5, false, 100),
      result("b", "coding", 0.9, true, 50)
    ]);
    expect(summaries).toHaveLength(2);
    expect(rankSummaries(summaries, "coding")[0].model).toBe("b");
  });
});

function result(model: string, category: BenchmarkResult["category"], quality: number, success: boolean, latencyMs: number): BenchmarkResult {
  return {
    caseId: "case",
    provider: "provider",
    model,
    category,
    quality,
    success,
    latencyMs,
    monetaryCost: 0,
    attempts: 1,
    timestamp: new Date()
  };
}
