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
