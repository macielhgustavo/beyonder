import { describe, expect, it } from "vitest";
import { predictCapability } from "./capability-source.js";
import type { HistoricalPerformance } from "./adaptive-types.js";

function performance(samples: number, score: number, successRate: number): HistoricalPerformance {
  return {
    provider: "p",
    model: "m",
    taskType: "coding",
    samples,
    successes: Math.round(samples * successRate),
    failures: samples - Math.round(samples * successRate),
    successRate,
    avgEvaluationScore: score,
    avgLatencyMs: 100,
    avgMonetaryCostUsd: 0,
    avgShadowCostUsd: 0.001,
    avgAttempts: 1
  };
}

describe("predicted capability", () => {
  it("falls back to metadata when no benchmark prior or real outcomes exist", () => {
    expect(predictCapability({ performance: performance(0, 0.5, 0.5), metadataQualityClass: "medium" })).toBeCloseTo(0.64);
  });

  it("blends a future benchmark prior with accumulating real-world outcomes", () => {
    const priorOnly = predictCapability({ benchmarkPrior: 0.9, performance: performance(0, 0.5, 0.5), metadataQualityClass: "unknown" });
    const learned = predictCapability({ benchmarkPrior: 0.9, performance: performance(20, 0.6, 0.6), metadataQualityClass: "unknown" });
    expect(priorOnly).toBeCloseTo(0.9);
    expect(learned).toBeLessThan(priorOnly);
    expect(learned).toBeGreaterThan(0.6);
  });

  it("uses real outcomes alone when no BIB prior exists", () => {
    const predicted = predictCapability({ benchmarkPrior: null, performance: performance(10, 0.8, 0.8), metadataQualityClass: "unknown" });
    expect(predicted).toBeGreaterThan(0.5);
  });

  it("lets real-world evidence dominate as samples grow", () => {
    const few = predictCapability({ benchmarkPrior: 0.95, performance: performance(1, 0.4, 0.4), metadataQualityClass: "unknown" });
    const many = predictCapability({ benchmarkPrior: 0.95, performance: performance(100, 0.4, 0.4), metadataQualityClass: "unknown" });
    expect(few).toBeGreaterThan(many);
    expect(many).toBeCloseTo(0.51);
  });
});
