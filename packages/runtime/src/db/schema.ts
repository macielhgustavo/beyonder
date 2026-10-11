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

export const missions = sqliteTable("missions", {
  id: text("id").primaryKey(),
  contract: text("contract").notNull(),
  snapshot: text("snapshot").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const missionNodes = sqliteTable("mission_nodes", {
  id: text("id").primaryKey(),
  missionId: text("mission_id").notNull().references(() => missions.id, { onDelete: "cascade" }),
  spec: text("spec").notNull(),
  state: text("state").notNull(),
  attempt: integer("attempt").notNull().default(0),
  outcome: text("outcome"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const missionEvents = sqliteTable("mission_events", {
  id: text("id").primaryKey(),
  missionId: text("mission_id").notNull().references(() => missions.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  type: text("type").notNull(),
  payload: text("payload").notNull().default("{}"),
  recordedAt: text("recorded_at").notNull()
});

export const missionEdges = sqliteTable("mission_edges", {
  id: text("id").primaryKey(),
  missionId: text("mission_id").notNull().references(() => missions.id, { onDelete: "cascade" }),
  fromNodeId: text("from_node_id").notNull(),
  toNodeId: text("to_node_id").notNull()
});

export const evidence = sqliteTable("evidence", {
  id: text("id").primaryKey(),
  missionId: text("mission_id").notNull().references(() => missions.id, { onDelete: "cascade" }),
  nodeId: text("node_id"),
  evidenceKind: text("evidence_kind").notNull(),
  description: text("description").notNull(),
  provenance: text("provenance").notNull(),
  contentHash: text("content_hash").notNull(),
  trust: text("trust").notNull(),
  confidence: real("confidence").notNull(),
  artifactRef: text("artifact_ref"),
  recordedAt: text("recorded_at").notNull()
});

export const claimEvidenceRelations = sqliteTable("claim_evidence_relations", {
  id: text("id").primaryKey(),
  missionId: text("mission_id").notNull().references(() => missions.id, { onDelete: "cascade" }),
  claimId: text("claim_id").notNull(),
  claim: text("claim").notNull(),
  evidenceId: text("evidence_id").notNull().references(() => evidence.id, { onDelete: "cascade" }),
  relation: text("relation").notNull(),
  assessedAt: text("assessed_at").notNull()
});

export const actionIntents = sqliteTable("action_intents", {
  id: text("id").primaryKey(),
  missionId: text("mission_id").notNull().references(() => missions.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull(),
  what: text("what").notNull(),
  why: text("why").notNull(),
  target: text("target").notNull(),
  parameters: text("parameters").notNull().default("{}"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  risk: text("risk").notNull(),
  sideEffectLevel: text("side_effect_level").notNull(),
  requiresApproval: integer("requires_approval", { mode: "boolean" }).notNull(),
  approvalActionType: text("approval_action_type"),
  expiresAt: text("expires_at"),
  createdAt: text("created_at").notNull()
});

export const actionReceipts = sqliteTable("action_receipts", {
  id: text("id").primaryKey(),
  actionIntentId: text("action_intent_id").notNull().references(() => actionIntents.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  externalId: text("external_id"),
  result: text("result"),
  observedEffect: text("observed_effect"),
  state: text("state").notNull(),
  committedAt: text("committed_at").notNull(),
  reconciledAt: text("reconciled_at"),
  error: text("error")
});

export const capabilities = sqliteTable("capabilities", {
  id: text("id").primaryKey(),
  contract: text("contract").notNull(),
  availability: text("availability").notNull().default("AVAILABLE"),
  implementations: text("implementations").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

