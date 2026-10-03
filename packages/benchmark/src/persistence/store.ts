import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { nanoid } from "nanoid";
import type { BenchmarkCategory, BenchmarkResult, BenchmarkSummary } from "../types.js";
import { summarizeResults } from "../scoring/index.js";

export class BenchmarkStore {
  readonly sqlite: Database.Database;
  private closed = false;

  constructor(path = "./data/beyonder-benchmark.sqlite") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new Database(path);
    try {
      this.sqlite.pragma("journal_mode = WAL");
      this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS benchmark_results (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          category TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'FAIL',
          quality REAL,
          success INTEGER,
          latency_ms INTEGER,
          monetary_cost REAL NOT NULL DEFAULT 0,
          tokens INTEGER,
          attempts INTEGER NOT NULL DEFAULT 1,
          http_status INTEGER,
          error_code TEXT,
          failure_reason TEXT,
          timestamp TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS benchmark_results_lookup
          ON benchmark_results(provider, model, category, timestamp);
      `);
      this.migrateLegacySchema();
    } catch (error) {
      this.close();
      throw error;
    }
  }

  saveResults(results: BenchmarkResult[]): void {
    this.assertOpen();
    const insert = this.sqlite.prepare(`
      INSERT INTO benchmark_results (
        id, case_id, provider, model, category, status, quality, success, latency_ms,
        monetary_cost, tokens, attempts, http_status, error_code, failure_reason, timestamp
      ) VALUES (
        @id, @caseId, @provider, @model, @category, @status, @quality, @success,
        @latencyMs, @monetaryCost, @tokens, @attempts, @httpStatus, @errorCode, @failureReason, @timestamp
      )
    `);
    const transaction = this.sqlite.transaction((items: BenchmarkResult[]) => {
      for (const item of items) {
        insert.run({
          ...item,
          id: item.id ?? nanoid(),
          quality: item.quality,
          success: item.success == null ? null : item.success ? 1 : 0,
          latencyMs: item.latencyMs ?? null,
          timestamp: item.timestamp.toISOString(),
          tokens: item.tokens ?? null,
          httpStatus: item.httpStatus ?? null,
          errorCode: item.errorCode ?? null,
          failureReason: item.failureReason ?? null
        });
      }
    });
    transaction(results);
  }

  listResults(): BenchmarkResult[] {
    this.assertOpen();
    const statement = this.sqlite.prepare("SELECT * FROM benchmark_results ORDER BY timestamp DESC");
    const rows = statement.all() as StoredBenchmarkResult[];
    return rows.map(fromRow);
  }

  summaries(): BenchmarkSummary[] {
    return summarizeResults(this.listResults());
  }

  getModelCapability(input: { provider: string; model: string; category: BenchmarkCategory }): BenchmarkSummary | null {
    const summary = this.summaries().find(
      (summary) => summary.provider === input.provider && summary.model === input.model && summary.category === input.category
    );
    if (!summary || summary.evaluatedSamples === 0) return null;
    return summary;
  }

  close(): void {
    if (this.closed || !this.sqlite.open) {
      this.closed = true;
      return;
    }
    this.sqlite.close();
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed || !this.sqlite.open) throw new Error("BenchmarkStore is closed.");
  }

  private migrateLegacySchema(): void {
    const tableInfo = this.sqlite.prepare("PRAGMA table_info(benchmark_results)");
    const columns = tableInfo.all() as Array<{ name: string; notnull: 0 | 1 }>;
    const byName = new Map(columns.map((column) => [column.name, column]));
    if (byName.get("quality")?.notnull || byName.get("success")?.notnull || byName.get("latency_ms")?.notnull) {
      this.sqlite.exec(`
        ALTER TABLE benchmark_results RENAME TO benchmark_results_legacy;
        CREATE TABLE benchmark_results (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          category TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'FAIL',
          quality REAL,
          success INTEGER,
          latency_ms INTEGER,
          monetary_cost REAL NOT NULL DEFAULT 0,
          tokens INTEGER,
          attempts INTEGER NOT NULL DEFAULT 1,
          http_status INTEGER,
          error_code TEXT,
          failure_reason TEXT,
          timestamp TEXT NOT NULL
        );
        INSERT INTO benchmark_results (
          id, case_id, provider, model, category, status, quality, success, latency_ms,
          monetary_cost, tokens, attempts, failure_reason, timestamp
        )
        SELECT
          id, case_id, provider, model, category,
          CASE WHEN success = 1 THEN 'PASS' ELSE 'FAIL' END,
          quality, success, latency_ms, monetary_cost, tokens, attempts, error, timestamp
        FROM benchmark_results_legacy;
        DROP TABLE benchmark_results_legacy;
        CREATE INDEX IF NOT EXISTS benchmark_results_lookup
          ON benchmark_results(provider, model, category, timestamp);
      `);
      this.repairLegacyOperationalFailures();
      return;
    }
    this.ensureColumn("status", "TEXT NOT NULL DEFAULT 'FAIL'");
    this.ensureColumn("http_status", "INTEGER");
    this.ensureColumn("error_code", "TEXT");
    this.ensureColumn("failure_reason", "TEXT");
    this.repairLegacyOperationalFailures();
  }

  private ensureColumn(column: string, definition: string): void {
    const tableInfo = this.sqlite.prepare("PRAGMA table_info(benchmark_results)");
    const columns = tableInfo.all() as Array<{ name: string }>;
    if (columns.some((entry) => entry.name === column)) return;
    this.sqlite.exec(`ALTER TABLE benchmark_results ADD COLUMN ${column} ${definition}`);
  }

  private repairLegacyOperationalFailures(): void {
    this.sqlite.exec(`
      UPDATE benchmark_results
      SET status = 'RATE_LIMITED', quality = NULL, success = NULL, http_status = 429
      WHERE status = 'FAIL' AND failure_reason LIKE '%HTTP 429%';

      UPDATE benchmark_results
      SET status = 'INVALID_ENDPOINT', quality = NULL, success = NULL, http_status = 404
      WHERE status = 'FAIL' AND failure_reason LIKE '%HTTP 404%';

      UPDATE benchmark_results
      SET status = 'TIMEOUT', quality = NULL, success = NULL
      WHERE status = 'FAIL' AND lower(failure_reason) LIKE '%timeout%';

      UPDATE benchmark_results
      SET status = 'PROVIDER_ERROR', quality = NULL, success = NULL
      WHERE status = 'FAIL' AND (
        failure_reason LIKE '%HTTP 500%' OR
        failure_reason LIKE '%HTTP 501%' OR
        failure_reason LIKE '%HTTP 502%' OR
        failure_reason LIKE '%HTTP 503%' OR
        failure_reason LIKE '%HTTP 504%' OR
        failure_reason LIKE '%HTTP 505%'
      );
    `);
  }
}

interface StoredBenchmarkResult {
  id: string;
  case_id: string;
  provider: string;
  model: string;
  category: BenchmarkCategory;
  status: BenchmarkResult["status"];
  quality: number | null;
  success: 0 | 1 | null;
  latency_ms: number | null;
  monetary_cost: number;
  tokens: number | null;
  attempts: number;
  http_status: number | null;
  error_code: string | null;
  failure_reason: string | null;
  timestamp: string;
}

function fromRow(row: StoredBenchmarkResult): BenchmarkResult {
  return {
    id: row.id,
    caseId: row.case_id,
    provider: row.provider,
    model: row.model,
    category: row.category,
    status: row.status,
    quality: row.quality,
    success: row.success == null ? null : Boolean(row.success),
    latencyMs: row.latency_ms ?? undefined,
    monetaryCost: row.monetary_cost,
    tokens: row.tokens ?? undefined,
    attempts: row.attempts,
    httpStatus: row.http_status ?? undefined,
    errorCode: row.error_code ?? undefined,
    failureReason: row.failure_reason ?? undefined,
    timestamp: new Date(row.timestamp)
  };
}
