/**
 * Beyonder Compute Economy — Price Fetcher & Discovery
 *
 * Implements dynamic price parsing and discovery for external provider catalogs
 * (such as OpenRouter's /api/v1/models endpoint).
 *
 * @see docs/adr/003-unknown-price-blocks-billable.md
 */

import { usdToMicros, ZERO_MICROS } from "./money.js";
import type { PricingSnapshot } from "./pricing-registry.js";

export interface OpenRouterRawModel {
  id: string;
  name?: string;
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
    request?: string | number;
    image?: string | number;
  };
}

/**
 * Parses an OpenRouter model object from their /api/v1/models endpoint into a PricingSnapshot.
 */
export function parseOpenRouterModelPricing(raw: OpenRouterRawModel): PricingSnapshot | null {
  if (!raw.id || !raw.pricing) return null;

  const promptPerToken = Number(raw.pricing.prompt ?? 0);
  const completionPerToken = Number(raw.pricing.completion ?? 0);
  const requestFee = Number(raw.pricing.request ?? 0);

  if (!Number.isFinite(promptPerToken) || !Number.isFinite(completionPerToken) || promptPerToken < 0 || completionPerToken < 0) {
    return null;
  }

  const promptPerMillionUsd = promptPerToken * 1_000_000;
  const completionPerMillionUsd = completionPerToken * 1_000_000;

  const now = new Date().toISOString();
  return {
    id: `openrouter_${raw.id.replace(/[^a-zA-Z0-9]/g, "_")}`,
    provider: "openrouter",
    model: raw.id,
    currency: "USD",
    inputPerMillion: usdToMicros(promptPerMillionUsd),
    outputPerMillion: usdToMicros(completionPerMillionUsd),
    cacheReadPerMillion: ZERO_MICROS,
    cacheWritePerMillion: ZERO_MICROS,
    requestFee: usdToMicros(requestFee),
    source: "openrouter_api",
    confidence: "high",
    effectiveAt: now,
    fetchedAt: now
  };
}
