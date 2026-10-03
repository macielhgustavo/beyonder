import { describe, expect, it } from "vitest";
import { rankSummaries, summarizeProviderOperations, summarizeResults } from "./index.js";
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

  it("ignores operational failures in capability scoring", () => {
    const summaries = summarizeResults([
      result("a", "coding", 1, true, 200),
      operational("a", "coding", "RATE_LIMITED", 429),
      operational("b", "coding", "INVALID_ENDPOINT", 404)
    ]);
    const capability = summaries.find((summary) => summary.model === "a");
    const notEvaluated = summaries.find((summary) => summary.model === "b");
    expect(capability?.avgQuality).toBe(1);
    expect(capability?.evaluatedSamples).toBe(1);
    expect(capability?.operationalFailures).toBe(1);
    expect(notEvaluated?.avgQuality).toBeNull();
    expect(rankSummaries(summaries, "coding").map((summary) => summary.model)).toEqual(["a"]);
  });

  it("summarizes provider reliability separately", () => {
    const stats = summarizeProviderOperations([
      result("a", "coding", 1, true, 200),
      operational("a", "coding", "RATE_LIMITED", 429),
      operational("a", "coding", "TIMEOUT")
    ]);
    expect(stats[0]).toMatchObject({
      requests: 3,
      successfulRequests: 1,
      rateLimited: 1,
      timeouts: 1,
      availabilityRate: 1 / 3
    });
  });
});

function result(model: string, category: BenchmarkResult["category"], quality: number, success: boolean, latencyMs: number): BenchmarkResult {
  return {
    caseId: "case",
    provider: "provider",
    model,
    category,
    status: success ? "PASS" : "FAIL",
    quality,
    success,
    latencyMs,
    monetaryCost: 0,
    attempts: 1,
    timestamp: new Date()
  };
}

function operational(
  model: string,
  category: BenchmarkResult["category"],
  status: BenchmarkResult["status"],
  httpStatus?: number
): BenchmarkResult {
  return {
    caseId: "case",
    provider: "provider",
    model,
    category,
    status,
    quality: null,
    success: null,
    latencyMs: 10,
    monetaryCost: 0,
    attempts: 1,
    httpStatus,
    failureReason: status,
    timestamp: new Date()
  };
}
