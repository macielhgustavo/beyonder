import { desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "../db/client.js";
import { memories } from "../db/schema.js";

export type PersistentMemoryKind = "episodic" | "semantic" | "procedural" | "economic";
export type MemoryKind = "working" | PersistentMemoryKind;

export interface MemoryRecord {
  id: string;
  kind: PersistentMemoryKind;
  content: string;
  importance: number;
  confidence: number;
  utility: number;
  createdAt: string;
  lastAccessedAt: string;
  accessCount: number;
  source?: string;
  taskId?: string;
  keywords: string[];
  metadata: Record<string, unknown>;
}

export interface MemoryWrite {
  kind: PersistentMemoryKind;
  content: string;
  importance?: number;
  confidence?: number;
  utility?: number;
  source?: string;
  taskId?: string;
  keywords?: string[];
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export class MemoryStore {
  constructor(private readonly db: Db) {}

  async remember(input: MemoryWrite): Promise<MemoryRecord> {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const id = nanoid();
    await this.db.insert(memories).values({
      id,
      kind: input.kind,
      content: input.content,
      importance: input.importance ?? 1,
      confidence: input.confidence ?? 1,
      utility: input.utility ?? 0.5,
      createdAt,
      lastAccessedAt: createdAt,
      accessCount: 0,
      source: input.source,
      taskId: input.taskId,
      keywords: JSON.stringify(input.keywords ?? []),
      metadata: JSON.stringify(input.metadata ?? {})
    });
    const record = await this.get(id);
    if (!record) throw new Error(`Memory ${id} was not persisted.`);
    return record;
  }

  async recent(limit = 10): Promise<MemoryRecord[]> {
    const rows = await this.db.select().from(memories).orderBy(desc(memories.createdAt)).limit(limit * 2);
    return rows.map(toRecord).filter(isMemoryRecord).slice(0, limit);
  }

  async all(limit = 1000): Promise<MemoryRecord[]> {
    const rows = await this.db.select().from(memories).orderBy(desc(memories.createdAt)).limit(limit * 2);
    return rows.map(toRecord).filter(isMemoryRecord).slice(0, limit);
  }

  async get(id: string): Promise<MemoryRecord | undefined> {
    const [row] = await this.db.select().from(memories).where(eq(memories.id, id)).limit(1);
    if (!row) return undefined;
    const record = toRecord(row);
    return record ?? undefined;
  }

  async touch(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    for (const id of ids) {
      await this.db
        .update(memories)
        .set({
          lastAccessedAt: now,
          accessCount: sql`${memories.accessCount} + 1`
        })
        .where(eq(memories.id, id));
    }
  }
}

function toRecord(row: typeof memories.$inferSelect): MemoryRecord | null {
  const kind = normalizeKind(row.kind);
  if (!kind) return null;
  return {
    id: row.id,
    kind,
    content: row.content,
    importance: row.importance,
    confidence: row.confidence,
    utility: row.utility,
    createdAt: row.createdAt,
    lastAccessedAt: row.lastAccessedAt ?? row.createdAt,
    accessCount: row.accessCount,
    source: row.source ?? undefined,
    taskId: row.taskId ?? undefined,
    keywords: parseStringArray(row.keywords),
    metadata: parseObject(row.metadata)
  };
}

function normalizeKind(kind: string): PersistentMemoryKind | null {
  if (kind === "episodic" || kind === "semantic" || kind === "procedural" || kind === "economic") return kind;
  if (kind === "decision") return "episodic";
  return null;
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function isMemoryRecord(record: MemoryRecord | null): record is MemoryRecord {
  return record !== null;
}
