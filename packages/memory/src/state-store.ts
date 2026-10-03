import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { state } from "../db/schema.js";

export class StateStore {
  constructor(private readonly db: Db) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const rows = await this.db.select().from(state).where(eq(state.key, key)).limit(1);
    if (rows.length === 0) return fallback;
    return JSON.parse(rows[0].value) as T;
  }

  async set(key: string, value: unknown) {
    const payload = {
      key,
      value: JSON.stringify(value),
      updatedAt: new Date().toISOString()
    };

    await this.db
      .insert(state)
      .values(payload)
      .onConflictDoUpdate({
        target: state.key,
        set: { value: payload.value, updatedAt: payload.updatedAt }
      });
  }
}
