import { desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "../db/client.js";
import { memories } from "../db/schema.js";

export class MemoryStore {
  constructor(private readonly db: Db) {}

  async remember(kind: string, content: string, importance = 1) {
    await this.db.insert(memories).values({
      id: nanoid(),
      kind,
      content,
      importance,
      createdAt: new Date().toISOString()
    });
  }

  async recent(limit = 10) {
    return this.db.select().from(memories).orderBy(desc(memories.createdAt)).limit(limit);
  }
}
