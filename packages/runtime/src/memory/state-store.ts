import { eq, and } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { state } from "../db/schema.js";

export class StateStore {
  constructor(private readonly db: Db) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const rows = await this.db.select().from(state).where(eq(state.key, key)).limit(1);
    if (rows.length === 0) return fallback;
    return JSON.parse(rows[0].value) as T;
  }

  async update<T>(key: string, fallback: T, change: (current: T) => T): Promise<T> {
    return this.db.transaction((tx) => {
      const row = tx.select().from(state).where(eq(state.key, key)).get();
      const next = change(row ? JSON.parse(row.value) as T : fallback);
      const payload = { key, value: JSON.stringify(next), updatedAt: new Date().toISOString() };
      tx.insert(state).values(payload).onConflictDoUpdate({ target: state.key, set: { value: payload.value, updatedAt: payload.updatedAt } }).run();
      return next;
    });
  }

  compareAndSet(key: string, expected: unknown, value: unknown): boolean {
    const result = this.db.update(state).set({ value: JSON.stringify(value), updatedAt: new Date().toISOString() }).where(and(eq(state.key, key), eq(state.value, JSON.stringify(expected)))).run();
    return result.changes === 1;
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
