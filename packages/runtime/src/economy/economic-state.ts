import type { EconomicState } from "../types.js";
import type { LedgerSummary } from "./ledger.js";

export function classifyEconomicState(summary: LedgerSummary): EconomicState {
  if (summary.balanceUsd < 0) return "halted";
  if (summary.balanceUsd === 0) return "survival";
  if (summary.runwayDays != null && summary.runwayDays < 3) return "survival";
  if (summary.runwayDays != null && summary.runwayDays < 14) return "defensive";
  if (summary.profitUsd < 0 && summary.expensesUsd > summary.revenueUsd) return "defensive";
  if (summary.profitUsd > 0 && summary.balanceUsd > summary.capitalUsd) return "growth";
  return "normal";
}
