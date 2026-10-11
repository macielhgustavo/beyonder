import { describe, expect, it, beforeEach } from "vitest";
import { openDatabase } from "../../db/client.js";
import {
  freePricingSnapshot,
  SqlitePricingRegistry,
  type PricingSnapshot
} from "../pricing-registry.js";
import { seedCatalogPricing } from "../catalog-pricing.js";
import { parseOpenRouterModelPricing } from "../price-fetcher.js";
import { usdToMicros, ZERO_MICROS } from "../money.js";

describe("SqlitePricingRegistry and Dynamic Pricing", () => {
  let sqlite: ReturnType<typeof openDatabase>["sqlite"];

  beforeEach(() => {
    sqlite = openDatabase(":memory:").sqlite;
  });

  it("persists and retrieves pricing snapshots from SQLite", () => {
    const registry = new SqlitePricingRegistry(sqlite);
    const snapshot: PricingSnapshot = {
      id: "snap_sqlite_1",
      provider: "openrouter",
      model: "deepseek/deepseek-chat",
      currency: "USD",
      inputPerMillion: usdToMicros(0.14),
      outputPerMillion: usdToMicros(0.28),
      cacheReadPerMillion: ZERO_MICROS,
      cacheWritePerMillion: ZERO_MICROS,
      requestFee: ZERO_MICROS,
      source: "openrouter_api",
      confidence: "high",
      effectiveAt: new Date().toISOString(),
      fetchedAt: new Date().toISOString()
    };

    registry.recordPrice(snapshot);

    const retrieved = registry.getPrice("openrouter", "deepseek/deepseek-chat");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe("snap_sqlite_1");
    expect(retrieved?.inputPerMillion).toBe(140_000);
    expect(retrieved?.outputPerMillion).toBe(280_000);
  });

  it("seeds catalog pricing snapshots and lists by provider", () => {
    const registry = new SqlitePricingRegistry(sqlite);
    seedCatalogPricing(registry);

    const all = registry.listAll();
    expect(all.length).toBeGreaterThan(10);

    const openrouterPrices = registry.listForProvider("openrouter");
    expect(openrouterPrices.length).toBeGreaterThan(4);
    expect(openrouterPrices.some(p => p.model === "anthropic/claude-3.5-sonnet")).toBe(true);

    const claudePrice = registry.getPrice("openrouter", "anthropic/claude-3.5-sonnet");
    expect(claudePrice).not.toBeNull();
    expect(claudePrice?.inputPerMillion).toBe(3_000_000); // $3 / 1M
    expect(claudePrice?.outputPerMillion).toBe(15_000_000); // $15 / 1M
  });

  it("parses OpenRouter dynamic pricing correctly", () => {
    const raw = {
      id: "openai/gpt-4o",
      name: "GPT-4o",
      pricing: {
        prompt: "0.0000025",
        completion: "0.00001",
        request: "0"
      }
    };

    const parsed = parseOpenRouterModelPricing(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.provider).toBe("openrouter");
    expect(parsed?.model).toBe("openai/gpt-4o");
    expect(parsed?.inputPerMillion).toBe(2_500_000); // $2.50 / 1M
    expect(parsed?.outputPerMillion).toBe(10_000_000); // $10.00 / 1M
  });

  it("rejects malformed OpenRouter pricing", () => {
    expect(parseOpenRouterModelPricing({ id: "" })).toBeNull();
    expect(parseOpenRouterModelPricing({ id: "test", pricing: { prompt: "invalid" } })).toBeNull();
  });
});
