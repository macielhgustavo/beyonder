import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const state = sqliteTable("state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const memories = sqliteTable("memories", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  content: text("content").notNull(),
  importance: integer("importance").notNull().default(1),
  confidence: real("confidence").notNull().default(1),
  utility: real("utility").notNull().default(0.5),
  createdAt: text("created_at").notNull(),
  lastAccessedAt: text("last_accessed_at"),
  accessCount: integer("access_count").notNull().default(0),
  source: text("source"),
  taskId: text("task_id"),
  keywords: text("keywords").notNull().default("[]"),
  metadata: text("metadata").notNull().default("{}")
});

export const ledgerEntries = sqliteTable("ledger_entries", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  amountUsd: real("amount_usd").notNull(),
  description: text("description").notNull(),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull()
});

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  level: text("level").notNull(),
  event: text("event").notNull(),
  details: text("details").notNull().default("{}"),
  createdAt: text("created_at").notNull()
});

export const budgetAccounts = sqliteTable("budget_accounts", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  parentId: text("parent_id"),
  hardCapMicros: integer("hard_cap_micros").notNull(),
  softTargetMicros: integer("soft_target_micros").notNull().default(0),
  spentMicros: integer("spent_micros").notNull().default(0),
  reservedMicros: integer("reserved_micros").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const spendReservations = sqliteTable("spend_reservations", {
  id: text("id").primaryKey(),
  budgetAccountId: text("budget_account_id").notNull(),
  scopeHierarchy: text("scope_hierarchy").notNull(),
  taskId: text("task_id"),
  phase: text("phase"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  estimatedInputTokens: integer("estimated_input_tokens").notNull().default(0),
  maxOutputTokens: integer("max_output_tokens").notNull().default(0),
  worstCaseMicros: integer("worst_case_micros").notNull(),
  actualCostMicros: integer("actual_cost_micros"),
  pricingSnapshotId: text("pricing_snapshot_id"),
  state: text("state").notNull().default("RESERVED"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  providerRequestId: text("provider_request_id"),
  createdAt: text("created_at").notNull(),
  sentAt: text("sent_at"),
  settledAt: text("settled_at"),
  error: text("error")
});

export const pricingSnapshots = sqliteTable("pricing_snapshots", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  currency: text("currency").notNull().default("USD"),
  inputPerMillion: integer("input_per_million").notNull(),
  outputPerMillion: integer("output_per_million").notNull(),
  cacheReadPerMillion: integer("cache_read_per_million").notNull().default(0),
  cacheWritePerMillion: integer("cache_write_per_million").notNull().default(0),
  requestFee: integer("request_fee").notNull().default(0),
  source: text("source").notNull(),
  confidence: text("confidence").notNull().default("medium"),
  effectiveAt: text("effective_at").notNull(),
  fetchedAt: text("fetched_at").notNull()
});

