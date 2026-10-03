import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { nanoid } from "nanoid";
import type { BenchmarkCategory, BenchmarkResult, BenchmarkSummary } from "../types.js";
import { summarizeResults } from "../scoring/index.js";

export class BenchmarkStore {
  readonly sqlite: Database.Database;

  constructor(path = "./data/beyonder-benchmark.sqlite") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new Database(path);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS benchmark_results (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        category TEXT NOT NULL,
        quality REAL NOT NULL,
        success INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL,
        monetary_cost REAL NOT NULL DEFAULT 0,
        tokens INTEGER,
        attempts INTEGER NOT NULL DEFAULT 1,
        error TEXT,
        timestamp TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS benchmark_results_lookup
        ON benchmark_results(provider, model, category, timestamp);
    `);
  }

  saveResults(results: BenchmarkResult[]): void {
    const insert = this.sqlite.prepare(`
      INSERT INTO benchmark_results (
        id, case_id, provider, model, category, quality, success, latency_ms,
        monetary_cost, tokens, attempts, error, timestamp
      ) VALUES (
        @id, @caseId, @provider, @model, @category, @quality, @success,
        @latencyMs, @monetaryCost, @tokens, @attempts, @error, @timestamp
      )
    `);
    const transaction = this.sqlite.transaction((items: BenchmarkResult[]) => {
      for (const item of items) {
        insert.run({
          ...item,
          id: item.id ?? nanoid(),
          success: item.success ? 1 : 0,
          timestamp: item.timestamp.toISOString(),
          tokens: item.tokens ?? null,
          error: item.error ?? null
        });
      }
    });
    transaction(results);
  }

  listResults(): BenchmarkResult[] {
    const rows = this.sqlite.prepare("SELECT * FROM benchmark_results ORDER BY timestamp DESC").all() as StoredBenchmarkResult[];
    return rows.map(fromRow);
  }

  summaries(): BenchmarkSummary[] {
    return summarizeResults(this.listResults());
  }

  getModelCapability(input: { provider: string; model: string; category: BenchmarkCategory }): BenchmarkSummary | null {
    return this.summaries().find(
      (summary) => summary.provider === input.provider && summary.model === input.model && summary.category === input.category
    ) ?? null;
  }

  close(): void {
    this.sqlite.close();
  }
}

interface StoredBenchmarkResult {
  id: string;
  case_id: string;
  provider: string;
  model: string;
  category: BenchmarkCategory;
  quality: number;
  success: 0 | 1;
  latency_ms: number;
  monetary_cost: number;
  tokens: number | null;
  attempts: number;
  error: string | null;
  timestamp: string;
}

function fromRow(row: StoredBenchmarkResult): BenchmarkResult {
  return {
    id: row.id,
    caseId: row.case_id,
    provider: row.provider,
    model: row.model,
    category: row.category,
    quality: row.quality,
    success: Boolean(row.success),
    latencyMs: row.latency_ms,
    monetaryCost: row.monetary_cost,
    tokens: row.tokens ?? undefined,
    attempts: row.attempts,
    error: row.error ?? undefined,
    timestamp: new Date(row.timestamp)
  };
}
