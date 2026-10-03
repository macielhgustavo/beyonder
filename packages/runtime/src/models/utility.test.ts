import { describe, expect, it } from "vitest";
import { calculateEffectiveResourceCost, calculateUtility, intelligenceEfficiency } from "./utility.js";

describe("adaptive router utility", () => {
  it("rewards predicted quality and historical success", () => {
    const weak = calculateUtility({
      predictedQuality: 0.5,
      historicalSuccess: 0.5,
      reliability: 0.7,
      monetaryCostUsd: 0,
      shadowCostUsd: 0.001,
      latencyPenalty: 0.1,
      failureRisk: 0.2
    }, "normal");
    const strong = calculateUtility({
      predictedQuality: 0.9,
      historicalSuccess: 0.85,
      reliability: 0.95,
      monetaryCostUsd: 0,
      shadowCostUsd: 0.001,
      latencyPenalty: 0.1,
      failureRisk: 0.05
    }, "normal");
    expect(strong).toBeGreaterThan(weak);
  });

  it("penalizes scarce shadow resources even when monetary cost is zero", () => {
    const cheapQuota = calculateUtility({
      predictedQuality: 0.8,
      historicalSuccess: 0.8,
      reliability: 0.9,
      monetaryCostUsd: 0,
      shadowCostUsd: 0.0002,
      latencyPenalty: 0.1,
      failureRisk: 0.1
    }, "defensive");
    const scarceQuota = calculateUtility({
      predictedQuality: 0.8,
      historicalSuccess: 0.8,
      reliability: 0.9,
      monetaryCostUsd: 0,
      shadowCostUsd: 0.008,
      latencyPenalty: 0.1,
      failureRisk: 0.1
    }, "defensive");
    expect(cheapQuota).toBeGreaterThan(scarceQuota);
  });

  it("keeps effective resource cost components observable", () => {
    const cost = calculateEffectiveResourceCost({ monetaryCostUsd: 0, shadowCostUsd: 0.002, latencyPenalty: 0.5, retryCount: 1 });
    expect(cost).toBeGreaterThan(0.002);
    expect(intelligenceEfficiency(0.8, cost)).toBeGreaterThan(0);
  });
});
