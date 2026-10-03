import { describe, expect, it } from "vitest";
import { ShadowCostCalculator } from "./shadow-cost.js";
import { getEconomicRoutingPolicy } from "./router-config.js";
import type { QuotaSnapshot } from "./adaptive-types.js";

const baseQuota: QuotaSnapshot = {
  provider: "test",
  model: "model",
  requestsPerMinute: 30,
  requestsPerDay: 1000,
  tokensPerMinute: "unknown",
  tokensPerDay: "unknown",
  requestQuotaTotal: 1000,
  requestQuotaRemaining: 500,
  tokenQuotaTotal: "unknown",
  tokenQuotaRemaining: "unknown",
  resetAt: "unknown",
  health: "healthy",
  lastUpdatedAt: "unknown"
};

describe("ShadowCostCalculator", () => {
  it("increases shadow cost as known quota becomes scarce", () => {
    const calculator = new ShadowCostCalculator();
    const abundant = calculator.calculate({ quota: { ...baseQuota, requestQuotaRemaining: 900 }, economicState: "normal", alternativesAvailable: 2 });
    const scarce = calculator.calculate({ quota: { ...baseQuota, requestQuotaRemaining: 50 }, economicState: "normal", alternativesAvailable: 2 });
    expect(scarce.shadowCostUsd).toBeGreaterThan(abundant.shadowCostUsd);
    expect(scarce.scarcity).toBeGreaterThan(abundant.scarcity);
  });

  it("does not invent unknown remaining quota and applies a conservative penalty", () => {
    const calculator = new ShadowCostCalculator();
    const result = calculator.calculate({
      quota: { ...baseQuota, requestQuotaRemaining: "unknown", requestQuotaTotal: 1000 },
      economicState: "normal",
      alternativesAvailable: 0
    });
    expect(result.quotaRatio).toBe("unknown");
    expect(result.shadowCostUsd).toBeGreaterThan(0);
    expect(result.reason).toContain("unknown");
  });

  it("makes survival more quota-sensitive than normal", () => {
    const calculator = new ShadowCostCalculator();
    const normal = calculator.calculate({ quota: baseQuota, economicState: "normal", alternativesAvailable: 0 });
    const survival = calculator.calculate({ quota: baseQuota, economicState: "survival", alternativesAvailable: 0 });
    expect(survival.shadowCostUsd).toBeGreaterThan(normal.shadowCostUsd);
    expect(getEconomicRoutingPolicy("survival").maxAttempts).toBe(1);
    expect(getEconomicRoutingPolicy("halted").allowInference).toBe(false);
  });
});
