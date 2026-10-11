/**
 * Beyonder Compute Economy — Cost Estimator
 *
 * Estimates worst-case inference request cost using pricing snapshots and
 * token estimates. This is used for budget reservation before paid inference.
 */

import type { Microdollars } from "./money.js";
import { addMicros, ZERO_MICROS } from "./money.js";
import type { PricingSnapshot } from "./pricing-registry.js";

export interface CostEstimateInput {
  pricing: PricingSnapshot;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  /** Optional: cached input tokens (reduces input cost). */
  cachedInputTokens?: number;
}

export interface CostEstimate {
  /** Estimated cost using expected output tokens. */
  estimatedCostMicros: Microdollars;
  /** Worst-case cost using max output tokens. */
  worstCaseCostMicros: Microdollars;
  /** Breakdown for observability. */
  breakdown: {
    inputCostMicros: Microdollars;
    outputCostMicros: Microdollars;
    cacheCostMicros: Microdollars;
    requestFeeMicros: Microdollars;
  };
  pricingSnapshotId: string;
}

export interface CostEstimator {
  /** Estimate cost for an inference request. */
  estimate(input: CostEstimateInput): CostEstimate;

  /** Quick worst-case cost calculation. */
  worstCase(input: CostEstimateInput): Microdollars;
}

export class DefaultCostEstimator implements CostEstimator {
  estimate(input: CostEstimateInput): CostEstimate {
    const { pricing, estimatedInputTokens, maxOutputTokens, cachedInputTokens } = input;

    const effectiveInputTokens = Math.max(0, estimatedInputTokens - (cachedInputTokens ?? 0));
    const cachedTokens = cachedInputTokens ?? 0;

    // Cost per token = price per million / 1,000,000
    // But since pricing is already in microdollars per million,
    // cost in microdollars = tokens * pricePerMillion / 1,000,000
    const inputCostMicros = Math.round(effectiveInputTokens * pricing.inputPerMillion / 1_000_000) as Microdollars;
    const outputCostMicros = Math.round(maxOutputTokens * pricing.outputPerMillion / 1_000_000) as Microdollars;
    const cacheCostMicros = Math.round(cachedTokens * pricing.cacheReadPerMillion / 1_000_000) as Microdollars;
    const requestFeeMicros = pricing.requestFee;

    const worstCaseCostMicros = addMicros(
      addMicros(addMicros(inputCostMicros, outputCostMicros), cacheCostMicros),
      requestFeeMicros
    );

    // Estimated cost uses half of max output tokens as a rough expected value.
    const estimatedOutputCost = Math.round((maxOutputTokens / 2) * pricing.outputPerMillion / 1_000_000) as Microdollars;
    const estimatedCostMicros = addMicros(
      addMicros(addMicros(inputCostMicros, estimatedOutputCost), cacheCostMicros),
      requestFeeMicros
    );

    return {
      estimatedCostMicros,
      worstCaseCostMicros,
      breakdown: {
        inputCostMicros,
        outputCostMicros,
        cacheCostMicros,
        requestFeeMicros
      },
      pricingSnapshotId: pricing.id
    };
  }

  worstCase(input: CostEstimateInput): Microdollars {
    if (input.pricing.inputPerMillion === 0 && input.pricing.outputPerMillion === 0 && input.pricing.requestFee === 0) {
      return ZERO_MICROS;
    }
    return this.estimate(input).worstCaseCostMicros;
  }
}
