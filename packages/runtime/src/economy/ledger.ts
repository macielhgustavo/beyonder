import { createHash } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "../db/client.js";
import { ledgerEntries, state } from "../db/schema.js";
import type { LedgerEntryType } from "../types.js";

export interface LedgerSummary {
  capitalUsd: number;
  expensesUsd: number;
  revenueUsd: number;
  profitUsd: number;
  balanceUsd: number;
  runwayDays: number | null;
}

export class EconomicLedger {
  constructor(private readonly db: Db) {}

  async initialize(startingCapitalUsd: number) {
    const entries = await this.db.select().from(ledgerEntries).limit(1);
    if (entries.length > 0) return;
    await this.record("capital", startingCapitalUsd, "Initial capital");
  }

  async record(
    type: LedgerEntryType,
    amountUsd: number,
    description: string,
    metadata: Record<string, unknown> = {}
  ) {
    await this.db.insert(ledgerEntries).values({
      id: nanoid(),
      type,
      amountUsd,
      description,
      metadata: JSON.stringify(metadata),
      createdAt: new Date().toISOString()
    });
  }

  /** Commit the credit and its owning state transition in one SQLite transaction.
   * The durable ID is independent of history retention and retry timing. */
  async recordRevenueWithState(amountUsd: number, description: string, metadata: Record<string, unknown>, transition: { key: string; expected: unknown; value: unknown }) {
    const id = `settlement:${createHash("sha256").update(String(metadata.idempotencyKey)).digest("hex")}`;
    return this.db.transaction((tx) => {
      const current = tx.select().from(state).where(eq(state.key, transition.key)).get();
      if (!current || current.value !== JSON.stringify(transition.expected)) throw new Error("Settlement state changed; retry with current work run.");
      // Also recognize credits written before deterministic ledger IDs were introduced.
      const existing = tx.select().from(ledgerEntries).where(sql`${ledgerEntries.type} = 'revenue' AND json_extract(${ledgerEntries.metadata}, '$.idempotencyKey') = ${String(metadata.idempotencyKey)}`).get();
      if (existing) {
        const prior = JSON.parse(existing.metadata);
        if (prior.workRunId !== metadata.workRunId || existing.amountUsd !== amountUsd) throw new Error("Settlement reference already credits a different work run or amount.");
      } else {
        tx.insert(ledgerEntries).values({ id, type: "revenue", amountUsd, description, metadata: JSON.stringify(metadata), createdAt: new Date().toISOString() }).run();
      }
      tx.update(state).set({ value: JSON.stringify(transition.value), updatedAt: new Date().toISOString() }).where(eq(state.key, transition.key)).run();
    });
  }

  async latest(limit = 20) {
    return this.db.select().from(ledgerEntries).orderBy(desc(ledgerEntries.createdAt)).limit(limit);
  }

  async summary(monthlyFixedCostUsd: number): Promise<LedgerSummary> {
    const entries = await this.db.select().from(ledgerEntries);
    const capitalUsd = entries.filter((e) => e.type === "capital").reduce((sum, e) => sum + e.amountUsd, 0);
    const expensesUsd = entries.filter((e) => e.type === "expense").reduce((sum, e) => sum + e.amountUsd, 0);
    const revenueUsd = entries.filter((e) => e.type === "revenue").reduce((sum, e) => sum + e.amountUsd, 0);
    const adjustmentsUsd = entries.filter((e) => e.type === "adjustment").reduce((sum, e) => sum + e.amountUsd, 0);
    const profitUsd = revenueUsd - expensesUsd;
    const balanceUsd = capitalUsd + revenueUsd - expensesUsd + adjustmentsUsd;
    const dailyBurnUsd = monthlyFixedCostUsd / 30;
    const runwayDays = dailyBurnUsd > 0 ? Math.max(0, balanceUsd / dailyBurnUsd) : null;

    return { capitalUsd, expensesUsd, revenueUsd, profitUsd, balanceUsd, runwayDays };
  }
}
