/**
 * Beyonder Compute Economy — Pricing Registry
 *
 * Stores and retrieves per-model per-provider pricing snapshots.
 * Answers "what does this model cost?" with source, confidence, and freshness.
 *
 * @see docs/adr/003-unknown-price-blocks-billable.md
 */

import type { Microdollars } from "./money.js";
import { isValidMicros, ZERO_MICROS } from "./money.js";

export type PricingSource = "provider_api" | "static_metadata" | "openrouter_api" | "operator_override";
export type PricingConfidence = "high" | "medium" | "low";

export interface PricingSnapshot {
  id: string;
  provider: string;
  model: string;
  currency: string;
  /** Microdollars per 1 million input tokens. */
  inputPerMillion: Microdollars;
  /** Microdollars per 1 million output tokens. */
  outputPerMillion: Microdollars;
  /** Microdollars per 1 million cached read tokens. */
  cacheReadPerMillion: Microdollars;
  /** Microdollars per 1 million cached write tokens. */
  cacheWritePerMillion: Microdollars;
  /** Fixed per-request fee in microdollars. */
  requestFee: Microdollars;
  source: PricingSource;
  confidence: PricingConfidence;
  effectiveAt: string;
  fetchedAt: string;
}

/** Default maximum age for a pricing snapshot to be considered fresh (24 hours). */
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface PricingRegistry {
  /** Get best known pricing for a provider+model. Returns null if unknown. */
  getPrice(provider: string, model: string): PricingSnapshot | null;

  /** Record or update a pricing snapshot. */
  recordPrice(snapshot: PricingSnapshot): void;

  /** Check if a pricing snapshot is fresh enough to trust for cost estimation. */
  isFresh(snapshot: PricingSnapshot, maxAgeMs?: number): boolean;

  /** List all known pricing snapshots. */
  listAll(): PricingSnapshot[];
}

/**
 * In-memory pricing registry backed by a Map.
 * In Phase 2+, this will be backed by SQLite for persistence across restarts.
 */
export class InMemoryPricingRegistry implements PricingRegistry {
  private readonly snapshots = new Map<string, PricingSnapshot>();

  private key(provider: string, model: string): string {
    return `${provider}::${model}`;
  }

  getPrice(provider: string, model: string): PricingSnapshot | null {
    return this.snapshots.get(this.key(provider, model)) ?? null;
  }

  recordPrice(snapshot: PricingSnapshot): void {
    validateSnapshot(snapshot);
    const key = this.key(snapshot.provider, snapshot.model);
    const existing = this.snapshots.get(key);
    // Keep the newer snapshot based on fetchedAt.
    if (existing && existing.fetchedAt > snapshot.fetchedAt) return;
    this.snapshots.set(key, snapshot);
  }

  isFresh(snapshot: PricingSnapshot, maxAgeMs: number = DEFAULT_MAX_AGE_MS): boolean {
    const fetchedAt = Date.parse(snapshot.fetchedAt);
    if (Number.isNaN(fetchedAt)) return false;
    return Date.now() - fetchedAt < maxAgeMs;
  }

  listAll(): PricingSnapshot[] {
    return Array.from(this.snapshots.values());
  }
}

function validateSnapshot(snapshot: PricingSnapshot): void {
  if (!snapshot.provider) throw new Error("PricingSnapshot: provider is required");
  if (!snapshot.model) throw new Error("PricingSnapshot: model is required");
  if (!snapshot.id) throw new Error("PricingSnapshot: id is required");
  if (!isValidMicros(snapshot.inputPerMillion)) {
    throw new Error(`PricingSnapshot: invalid inputPerMillion: ${snapshot.inputPerMillion}`);
  }
  if (!isValidMicros(snapshot.outputPerMillion)) {
    throw new Error(`PricingSnapshot: invalid outputPerMillion: ${snapshot.outputPerMillion}`);
  }
}

/**
 * Create a pricing snapshot indicating a confirmed free model.
 * Free models have all pricing fields set to zero.
 */
export function freePricingSnapshot(provider: string, model: string, id: string): PricingSnapshot {
  const now = new Date().toISOString();
  return {
    id,
    provider,
    model,
    currency: "USD",
    inputPerMillion: ZERO_MICROS,
    outputPerMillion: ZERO_MICROS,
    cacheReadPerMillion: ZERO_MICROS,
    cacheWritePerMillion: ZERO_MICROS,
    requestFee: ZERO_MICROS,
    source: "static_metadata",
    confidence: "high",
    effectiveAt: now,
    fetchedAt: now
  };
}
