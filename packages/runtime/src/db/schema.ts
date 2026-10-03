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
  createdAt: text("created_at").notNull()
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
