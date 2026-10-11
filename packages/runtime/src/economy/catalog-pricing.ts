/**
 * Beyonder Compute Economy — Catalog Pricing Definitions
 *
 * Provides static trusted pricing snapshots for known models and providers,
 * used to seed the PricingRegistry when live provider billing APIs are not queried.
 *
 * @see docs/v06-compute-economy-architecture.md
 * @see docs/adr/003-unknown-price-blocks-billable.md
 * @see docs/adr/004-free-compute-normal-candidate.md
 */

import { usdToMicros, ZERO_MICROS } from "./money.js";
import type { PricingRegistry, PricingSnapshot } from "./pricing-registry.js";
import { freePricingSnapshot } from "./pricing-registry.js";

export interface KnownModelPrice {
  provider: string;
  model: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  cacheReadPerMillionUsd?: number;
  requestFeeUsd?: number;
  source: "static_metadata" | "openrouter_api" | "provider_api";
  confidence: "high" | "medium";
}

export const CATALOG_PRICING: readonly KnownModelPrice[] = [
  // --- Confirmed Free Models ---
  { provider: "gemini", model: "gemini-2.5-flash", inputPerMillionUsd: 0, outputPerMillionUsd: 0, source: "static_metadata", confidence: "high" },
  { provider: "gemini", model: "gemini-2.5-flash-lite", inputPerMillionUsd: 0, outputPerMillionUsd: 0, source: "static_metadata", confidence: "high" },
  { provider: "gemini", model: "gemini-1.5-flash", inputPerMillionUsd: 0, outputPerMillionUsd: 0, source: "static_metadata", confidence: "high" },
  { provider: "groq", model: "llama-3.3-70b-versatile", inputPerMillionUsd: 0, outputPerMillionUsd: 0, source: "static_metadata", confidence: "high" },
  { provider: "groq", model: "moonshotai/kimi-k2-instruct", inputPerMillionUsd: 0, outputPerMillionUsd: 0, source: "static_metadata", confidence: "high" },
  { provider: "groq", model: "openai/gpt-oss-120b", inputPerMillionUsd: 0, outputPerMillionUsd: 0, source: "static_metadata", confidence: "high" },
  { provider: "cerebras", model: "llama-3.3-70b", inputPerMillionUsd: 0, outputPerMillionUsd: 0, source: "static_metadata", confidence: "high" },
  { provider: "cerebras", model: "qwen-3-235b-a22b", inputPerMillionUsd: 0, outputPerMillionUsd: 0, source: "static_metadata", confidence: "high" },
  { provider: "pollinations", model: "openai", inputPerMillionUsd: 0, outputPerMillionUsd: 0, source: "static_metadata", confidence: "high" },
  { provider: "pollinations", model: "mistral", inputPerMillionUsd: 0, outputPerMillionUsd: 0, source: "static_metadata", confidence: "high" },
  { provider: "openrouter", model: "openrouter/auto", inputPerMillionUsd: 0, outputPerMillionUsd: 0, source: "static_metadata", confidence: "high" },
  { provider: "openrouter", model: "deepseek/deepseek-r1:free", inputPerMillionUsd: 0, outputPerMillionUsd: 0, source: "static_metadata", confidence: "high" },
  { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free", inputPerMillionUsd: 0, outputPerMillionUsd: 0, source: "static_metadata", confidence: "high" },

  // --- Paid Models (OpenRouter routes) ---
  // High efficiency / cheap paid candidates
  { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct", inputPerMillionUsd: 0.12, outputPerMillionUsd: 0.30, source: "openrouter_api", confidence: "high" },
  { provider: "openrouter", model: "deepseek/deepseek-chat", inputPerMillionUsd: 0.14, outputPerMillionUsd: 0.28, source: "openrouter_api", confidence: "high" },
  { provider: "openrouter", model: "deepseek/deepseek-r1", inputPerMillionUsd: 0.55, outputPerMillionUsd: 2.19, source: "openrouter_api", confidence: "high" },
  { provider: "openrouter", model: "openai/gpt-4o-mini", inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.60, source: "openrouter_api", confidence: "high" },
  { provider: "openrouter", model: "qwen/qwen-2.5-72b-instruct", inputPerMillionUsd: 0.35, outputPerMillionUsd: 0.40, source: "openrouter_api", confidence: "high" },

  // Premium candidates (high capability, higher cost)
  { provider: "openrouter", model: "anthropic/claude-3.5-sonnet", inputPerMillionUsd: 3.00, outputPerMillionUsd: 15.00, source: "openrouter_api", confidence: "high" },
  { provider: "openrouter", model: "openai/gpt-4o", inputPerMillionUsd: 2.50, outputPerMillionUsd: 10.00, source: "openrouter_api", confidence: "high" },

  // --- Direct Gemini Paid Tier ---
  { provider: "gemini", model: "gemini-1.5-pro", inputPerMillionUsd: 1.25, outputPerMillionUsd: 5.00, source: "provider_api", confidence: "high" },
  { provider: "gemini", model: "gemini-2.0-flash", inputPerMillionUsd: 0.10, outputPerMillionUsd: 0.40, source: "provider_api", confidence: "high" },

  // --- Direct Groq Paid Tier ---
  { provider: "groq", model: "llama-3.3-70b-versatile-paid", inputPerMillionUsd: 0.59, outputPerMillionUsd: 0.79, source: "provider_api", confidence: "high" }
] as const;

/**
 * Seed a PricingRegistry with the standard catalogue pricing snapshots.
 */
export function seedCatalogPricing(registry: PricingRegistry): void {
  const now = new Date().toISOString();
  for (const item of CATALOG_PRICING) {
    if (item.inputPerMillionUsd === 0 && item.outputPerMillionUsd === 0) {
      registry.recordPrice(freePricingSnapshot(item.provider, item.model, `free_${item.provider}_${item.model.replace(/[^a-zA-Z0-9]/g, "_")}`));
    } else {
      registry.recordPrice({
        id: `seed_${item.provider}_${item.model.replace(/[^a-zA-Z0-9]/g, "_")}`,
        provider: item.provider,
        model: item.model,
        currency: "USD",
        inputPerMillion: usdToMicros(item.inputPerMillionUsd),
        outputPerMillion: usdToMicros(item.outputPerMillionUsd),
        cacheReadPerMillion: usdToMicros(item.cacheReadPerMillionUsd ?? 0),
        cacheWritePerMillion: ZERO_MICROS,
        requestFee: usdToMicros(item.requestFeeUsd ?? 0),
        source: item.source,
        confidence: item.confidence,
        effectiveAt: now,
        fetchedAt: now
      });
    }
  }
}
