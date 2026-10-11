import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export function openDatabase(path: string): { sqlite: Database.Database; db: Db } {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      importance INTEGER NOT NULL DEFAULT 1,
      confidence REAL NOT NULL DEFAULT 1,
      utility REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL,
      last_accessed_at TEXT,
      access_count INTEGER NOT NULL DEFAULT 0,
      source TEXT,
      task_id TEXT,
      keywords TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      amount_usd REAL NOT NULL,
      description TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      event TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS budget_accounts (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      parent_id TEXT,
      hard_cap_micros INTEGER NOT NULL,
      soft_target_micros INTEGER NOT NULL DEFAULT 0,
      spent_micros INTEGER NOT NULL DEFAULT 0,
      reserved_micros INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS spend_reservations (
      id TEXT PRIMARY KEY,
      budget_account_id TEXT NOT NULL,
      scope_hierarchy TEXT NOT NULL,
      task_id TEXT,
      phase TEXT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      estimated_input_tokens INTEGER NOT NULL DEFAULT 0,
      max_output_tokens INTEGER NOT NULL DEFAULT 0,
      worst_case_micros INTEGER NOT NULL,
      actual_cost_micros INTEGER,
      pricing_snapshot_id TEXT,
      state TEXT NOT NULL DEFAULT 'RESERVED',
      idempotency_key TEXT NOT NULL UNIQUE,
      provider_request_id TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT,
      settled_at TEXT,
      error TEXT
    );
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
    CREATE INDEX IF NOT EXISTS idx_budget_accounts_parent ON budget_accounts(parent_id);
    CREATE INDEX IF NOT EXISTS idx_spend_reservations_state ON spend_reservations(state);
    CREATE INDEX IF NOT EXISTS idx_spend_reservations_task ON spend_reservations(task_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_snapshots_lookup ON pricing_snapshots(provider, model, effective_at);
    CREATE TABLE IF NOT EXISTS missions (
      id TEXT PRIMARY KEY,
      contract TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mission_nodes (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      spec TEXT NOT NULL,
      state TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 0,
      outcome TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mission_events (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      recorded_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mission_events_mission_seq ON mission_events(mission_id, seq);
    CREATE TABLE IF NOT EXISTS mission_edges (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      from_node_id TEXT NOT NULL,
      to_node_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      node_id TEXT,
      evidence_kind TEXT NOT NULL,
      description TEXT NOT NULL,
      provenance TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      trust TEXT NOT NULL,
      confidence REAL NOT NULL,
      artifact_ref TEXT,
      recorded_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS claim_evidence_relations (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      claim_id TEXT NOT NULL,
      claim TEXT NOT NULL,
      evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
      relation TEXT NOT NULL,
      assessed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS action_intents (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      node_id TEXT NOT NULL,
      what TEXT NOT NULL,
      why TEXT NOT NULL,
      target TEXT NOT NULL,
      parameters TEXT NOT NULL DEFAULT '{}',
      idempotency_key TEXT NOT NULL UNIQUE,
      risk TEXT NOT NULL,
      side_effect_level TEXT NOT NULL,
      requires_approval INTEGER NOT NULL,
      approval_action_type TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS action_receipts (
      id TEXT PRIMARY KEY,
      action_intent_id TEXT NOT NULL REFERENCES action_intents(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      external_id TEXT,
      result TEXT,
      observed_effect TEXT,
      state TEXT NOT NULL,
      committed_at TEXT NOT NULL,
      reconciled_at TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS capabilities (
      id TEXT PRIMARY KEY,
      contract TEXT NOT NULL,
      availability TEXT NOT NULL DEFAULT 'AVAILABLE',
      implementations TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  ensureColumn(sqlite, "memories", "confidence", "REAL NOT NULL DEFAULT 1");
  ensureColumn(sqlite, "memories", "utility", "REAL NOT NULL DEFAULT 0.5");
  ensureColumn(sqlite, "memories", "last_accessed_at", "TEXT");
  ensureColumn(sqlite, "memories", "access_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(sqlite, "memories", "source", "TEXT");
  ensureColumn(sqlite, "memories", "task_id", "TEXT");
  ensureColumn(sqlite, "memories", "keywords", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(sqlite, "memories", "metadata", "TEXT NOT NULL DEFAULT '{}'");

  return {
    sqlite,
    db: drizzle(sqlite, { schema })
  };
}

function ensureColumn(sqlite: Database.Database, table: string, column: string, definition: string) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((entry) => entry.name === column)) return;
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
