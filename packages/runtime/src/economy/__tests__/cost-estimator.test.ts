import { describe, it, expect } from 'vitest';
import { DefaultCostEstimator } from '../cost-estimator.js';
import { PricingSnapshot } from '../pricing-registry.js';
import { Microdollars, microsToUsd, ZERO_MICROS } from '../money.js';

describe('DefaultCostEstimator', () => {
  const estimator = new DefaultCostEstimator();

  const paidPricing: PricingSnapshot = {
    id: 'snap-paid-1',
    provider: 'openrouter',
    model: 'anthropic/claude-3.5-sonnet',
    currency: 'USD',
    inputPerMillion: Microdollars.fromNumber(3_000_000), // $3.00 / M tokens
    outputPerMillion: Microdollars.fromNumber(15_000_000), // $15.00 / M tokens
    cacheReadPerMillion: ZERO_MICROS,
    cacheWritePerMillion: ZERO_MICROS,
    requestFee: ZERO_MICROS,
    source: 'operator_override',
    confidence: 'high',
    effectiveAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
  };

  const freePricing: PricingSnapshot = {
    id: 'snap-free-1',
    provider: 'gemini',
    model: 'gemini-1.5-flash',
    currency: 'USD',
    inputPerMillion: ZERO_MICROS,
    outputPerMillion: ZERO_MICROS,
    cacheReadPerMillion: ZERO_MICROS,
    cacheWritePerMillion: ZERO_MICROS,
    requestFee: ZERO_MICROS,
    source: 'static_metadata',
    confidence: 'high',
    effectiveAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
  };

  it('estimates worst-case cost based on input and max output tokens', () => {
    // 1000 input tokens * $3/M = $0.003 = 3000 micros
    // 2000 max output tokens * $15/M = $0.030 = 30000 micros
    // total = 33000 micros
    const worstCase = estimator.worstCase({
      pricing: paidPricing,
      estimatedInputTokens: 1000,
      maxOutputTokens: 2000,
    });

    expect(worstCase).toBe(33_000);
    expect(microsToUsd(worstCase)).toBe(0.033);
  });

  it('calculates zero cost for free pricing snapshot', () => {
    const worstCase = estimator.worstCase({
      pricing: freePricing,
      estimatedInputTokens: 50_000,
      maxOutputTokens: 4_096,
    });

    expect(worstCase).toBe(ZERO_MICROS);
  });

  it('provides a detailed breakdown in estimate()', () => {
    const estimate = estimator.estimate({
      pricing: paidPricing,
      estimatedInputTokens: 1000,
      maxOutputTokens: 2000,
    });

    expect(estimate.pricingSnapshotId).toBe('snap-paid-1');
    expect(estimate.worstCaseCostMicros).toBe(33_000);
    expect(estimate.breakdown.inputCostMicros).toBe(3_000);
    expect(estimate.breakdown.outputCostMicros).toBe(30_000);
    expect(estimate.breakdown.cacheCostMicros).toBe(0);
    expect(estimate.breakdown.requestFeeMicros).toBe(0);
    // Expected output uses half maxOutputTokens (1000 * 15 = 15000 micros)
    expect(estimate.estimatedCostMicros).toBe(3_000 + 15_000);
  });

  it('handles cached tokens reducing input cost and applying cache read price', () => {
    const cachePricing: PricingSnapshot = {
      ...paidPricing,
      id: 'snap-cache-1',
      cacheReadPerMillion: Microdollars.fromNumber(300_000), // $0.30 / M tokens
    };

    // Total 5000 input tokens of which 4000 are cached
    // effectiveInputTokens = 1000 * $3/M = 3000 micros
    // cachedTokens = 4000 * $0.30/M = 1200 micros
    // output = 500 tokens * $15/M = 7500 micros
    // worstCase = 3000 + 1200 + 7500 = 11700 micros
    const estimate = estimator.estimate({
      pricing: cachePricing,
      estimatedInputTokens: 5000,
      cachedInputTokens: 4000,
      maxOutputTokens: 500,
    });

    expect(estimate.breakdown.inputCostMicros).toBe(3_000);
    expect(estimate.breakdown.cacheCostMicros).toBe(1_200);
    expect(estimate.breakdown.outputCostMicros).toBe(7_500);
    expect(estimate.worstCaseCostMicros).toBe(11_700);
  });
});
