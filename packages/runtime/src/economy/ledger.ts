import { desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "../db/client.js";
import { ledgerEntries } from "../db/schema.js";
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
