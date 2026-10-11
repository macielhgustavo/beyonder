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

  /** List all pricing snapshots for a given provider. */
  listForProvider(provider: string): PricingSnapshot[];
}

/**
 * In-memory pricing registry backed by a Map.
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

  listForProvider(provider: string): PricingSnapshot[] {
    return Array.from(this.snapshots.values()).filter(s => s.provider === provider);
  }
}

/**
 * SQLite-backed pricing registry for persistent pricing snapshots across restarts.
 */
export class SqlitePricingRegistry implements PricingRegistry {
  constructor(private readonly sqlite: import("better-sqlite3").Database) {
    this.ensureTable();
  }

  private ensureTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS pricing_snapshots (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        input_per_million INTEGER NOT NULL,
        output_per_million INTEGER NOT NULL,
        cache_read_per_million INTEGER NOT NULL DEFAULT 0,
        cache_write_per_million INTEGER NOT NULL DEFAULT 0,
        request_fee INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL,
        confidence TEXT NOT NULL DEFAULT 'medium',
        effective_at TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pricing_snapshots_provider_model ON pricing_snapshots(provider, model);
    `);
  }

  getPrice(provider: string, model: string): PricingSnapshot | null {
    const row = this.sqlite
      .prepare(`
        SELECT * FROM pricing_snapshots
        WHERE provider = ? AND model = ?
        ORDER BY fetched_at DESC
        LIMIT 1
      `)
      .get(provider, model) as any;

    if (!row) return null;
    return mapRowToSnapshot(row);
  }

  recordPrice(snapshot: PricingSnapshot): void {
    validateSnapshot(snapshot);
    const stmt = this.sqlite.prepare(`
      INSERT INTO pricing_snapshots (
        id, provider, model, currency,
        input_per_million, output_per_million,
        cache_read_per_million, cache_write_per_million,
        request_fee, source, confidence,
        effective_at, fetched_at
      ) VALUES (
        @id, @provider, @model, @currency,
        @inputPerMillion, @outputPerMillion,
        @cacheReadPerMillion, @cacheWritePerMillion,
        @requestFee, @source, @confidence,
        @effectiveAt, @fetchedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        input_per_million = excluded.input_per_million,
        output_per_million = excluded.output_per_million,
        cache_read_per_million = excluded.cache_read_per_million,
        cache_write_per_million = excluded.cache_write_per_million,
        request_fee = excluded.request_fee,
        source = excluded.source,
        confidence = excluded.confidence,
        effective_at = excluded.effective_at,
        fetched_at = excluded.fetched_at;
    `);

    stmt.run({
      id: snapshot.id,
      provider: snapshot.provider,
      model: snapshot.model,
      currency: snapshot.currency,
      inputPerMillion: snapshot.inputPerMillion,
      outputPerMillion: snapshot.outputPerMillion,
      cacheReadPerMillion: snapshot.cacheReadPerMillion,
      cacheWritePerMillion: snapshot.cacheWritePerMillion,
      requestFee: snapshot.requestFee,
      source: snapshot.source,
      confidence: snapshot.confidence,
      effectiveAt: snapshot.effectiveAt,
      fetchedAt: snapshot.fetchedAt
    });
  }

  isFresh(snapshot: PricingSnapshot, maxAgeMs: number = DEFAULT_MAX_AGE_MS): boolean {
    const fetchedAt = Date.parse(snapshot.fetchedAt);
    if (Number.isNaN(fetchedAt)) return false;
    return Date.now() - fetchedAt < maxAgeMs;
  }

  listAll(): PricingSnapshot[] {
    const rows = this.sqlite
      .prepare(`SELECT * FROM pricing_snapshots ORDER BY provider, model`)
      .all() as any[];
    return rows.map(mapRowToSnapshot);
  }

  listForProvider(provider: string): PricingSnapshot[] {
    const rows = this.sqlite
      .prepare(`SELECT * FROM pricing_snapshots WHERE provider = ? ORDER BY model`)
      .all(provider) as any[];
    return rows.map(mapRowToSnapshot);
  }
}

function mapRowToSnapshot(row: any): PricingSnapshot {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    currency: row.currency,
    inputPerMillion: row.input_per_million as Microdollars,
    outputPerMillion: row.output_per_million as Microdollars,
    cacheReadPerMillion: (row.cache_read_per_million ?? 0) as Microdollars,
    cacheWritePerMillion: (row.cache_write_per_million ?? 0) as Microdollars,
    requestFee: (row.request_fee ?? 0) as Microdollars,
    source: row.source,
    confidence: row.confidence,
    effectiveAt: row.effective_at,
    fetchedAt: row.fetched_at
  };
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
