import { describe, expect, it } from "vitest";
import {
  freePricingSnapshot,
  InMemoryPricingRegistry,
  type PricingSnapshot
} from "../pricing-registry.js";
import { usdToMicros, ZERO_MICROS } from "../money.js";

describe("Compute Economy — Pricing Registry", () => {
  it("records and retrieves a pricing snapshot", () => {
    const registry = new InMemoryPricingRegistry();
    const snapshot: PricingSnapshot = {
      id: "snap_1",
      provider: "openrouter",
      model: "meta-llama/llama-3.3-70b-instruct",
      currency: "USD",
      inputPerMillion: usdToMicros(0.12), // $0.12 / 1M
      outputPerMillion: usdToMicros(0.30), // $0.30 / 1M
      cacheReadPerMillion: ZERO_MICROS,
      cacheWritePerMillion: ZERO_MICROS,
      requestFee: ZERO_MICROS,
      source: "openrouter_api",
      confidence: "high",
      effectiveAt: new Date().toISOString(),
      fetchedAt: new Date().toISOString()
    };

    registry.recordPrice(snapshot);
    const retrieved = registry.getPrice("openrouter", "meta-llama/llama-3.3-70b-instruct");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.inputPerMillion).toBe(120_000);
    expect(retrieved?.outputPerMillion).toBe(300_000);
  });

  it("returns null for unknown provider/model (ADR-003)", () => {
    const registry = new InMemoryPricingRegistry();
    expect(registry.getPrice("unknown", "model")).toBeNull();
  });

  it("checks pricing freshness accurately", () => {
    const registry = new InMemoryPricingRegistry();
    const freshSnapshot = freePricingSnapshot("groq", "llama-3.3-70b-versatile", "free_1");
    expect(registry.isFresh(freshSnapshot)).toBe(true);

    const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48h ago
    const staleSnapshot: PricingSnapshot = {
      ...freshSnapshot,
      fetchedAt: staleDate
    };
    expect(registry.isFresh(staleSnapshot, 24 * 60 * 60 * 1000)).toBe(false);
  });

  it("creates confirmed free pricing snapshot with zero costs", () => {
    const snapshot = freePricingSnapshot("groq", "llama-3.3-70b-versatile", "groq_free");
    expect(snapshot.inputPerMillion).toBe(0);
    expect(snapshot.outputPerMillion).toBe(0);
    expect(snapshot.requestFee).toBe(0);
    expect(snapshot.confidence).toBe("high");
  });
});
