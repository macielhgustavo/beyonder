import { nanoid } from "nanoid";
import { auditEvents } from "../db/schema.js";
import type { Db } from "../db/client.js";

export type AuditLevel = "debug" | "info" | "warn" | "error";

export class AuditLog {
  constructor(private readonly db: Db) {}

  async record(level: AuditLevel, event: string, details: Record<string, unknown> = {}) {
    await this.db.insert(auditEvents).values({
      id: nanoid(),
      level,
      event,
      details: JSON.stringify(details),
      createdAt: new Date().toISOString()
    });
  }
}
