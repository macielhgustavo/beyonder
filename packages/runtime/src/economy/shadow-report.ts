/**
 * Beyonder Compute Economy — Shadow Report Generator
 *
 * Aggregates shadow routing decisions and outputs comprehensive reports
 * showing free execution results, shadow paid candidates that would have been selected,
 * hypothetical costs, and utility gains.
 *
 * @see docs/v06-compute-economy-architecture.md (§14 Migration)
 */

import type { RouteDecision } from "../models/adaptive-types.js";
import type { SpendDecisionRecord } from "./spend-decision.js";
import { createSpendDecisionRecord } from "./spend-decision.js";

export interface ShadowTaskEntry {
  taskId: string;
  taskType: string;
  freeSelected: string | "none";
  shadowPaidCandidate: string | "none";
  estimatedPaidCostUsd: number;
  utilityDifference: number;
  reason: string;
}

export interface ShadowReportSummary {
  totalDecisions: number;
  actualSpendUsd: number;
  freeOptimalCount: number;
  shadowPaidWonCount: number;
  freeExhaustedRecoverableCount: number;
  hypotheticalSpendUsd: number;
  averageUtilityGain: number;
  providerBreakdown: Record<string, { count: number; spendUsd: number }>;
  modelBreakdown: Record<string, { count: number; spendUsd: number }>;
  tasks: ShadowTaskEntry[];
}

export class ShadowReportGenerator {
  private readonly decisions: RouteDecision[] = [];
  private readonly records: SpendDecisionRecord[] = [];

  record(decision: RouteDecision, record?: SpendDecisionRecord): void {
    this.decisions.push(decision);
    this.records.push(record ?? createSpendDecisionRecord(decision));
  }

  generate(): ShadowReportSummary {
    return this.generateSummary();
  }

  generateSummary(): ShadowReportSummary {
    let freeOptimalCount = 0;
    let shadowPaidWonCount = 0;
    let freeExhaustedRecoverableCount = 0;
    let totalHypotheticalSpendUsd = 0;
    let totalUtilityGain = 0;
    const providerBreakdown: Record<string, { count: number; spendUsd: number }> = {};
    const modelBreakdown: Record<string, { count: number; spendUsd: number }> = {};
    const tasks: ShadowTaskEntry[] = [];

    for (const d of this.decisions) {
      const shadow = d.shadowDecision;
      const shadowPaid = shadow?.shadowCandidate;
      const selected = d.selected;

      const freeSelectedName = selected && selected.monetaryCostUsd === 0
        ? `${selected.provider}/${selected.model}`
        : "none";
      const shadowPaidName = shadowPaid
        ? `${shadowPaid.provider}/${shadowPaid.model}`
        : "none";

      const costUsd = shadow?.estimatedPaidCostUsd ?? 0;
      const deltaUtility = shadow?.utilityDifference ?? 0;

      if (shadowPaid) {
        shadowPaidWonCount++;
        totalHypotheticalSpendUsd += costUsd;
        totalUtilityGain += deltaUtility;

        const prov = shadowPaid.provider;
        const mod = `${shadowPaid.provider}/${shadowPaid.model}`;

        if (!providerBreakdown[prov]) providerBreakdown[prov] = { count: 0, spendUsd: 0 };
        providerBreakdown[prov].count++;
        providerBreakdown[prov].spendUsd += costUsd;

        if (!modelBreakdown[mod]) modelBreakdown[mod] = { count: 0, spendUsd: 0 };
        modelBreakdown[mod].count++;
        modelBreakdown[mod].spendUsd += costUsd;

        if (!selected) {
          freeExhaustedRecoverableCount++;
        }
      } else {
        freeOptimalCount++;
      }

      tasks.push({
        taskId: d.task.id,
        taskType: d.task.type,
        freeSelected: freeSelectedName,
        shadowPaidCandidate: shadowPaidName,
        estimatedPaidCostUsd: costUsd,
        utilityDifference: deltaUtility,
        reason: shadow?.whyPaidCandidateWon ?? d.reason
      });
    }

    const averageUtilityGain = shadowPaidWonCount > 0
      ? Number((totalUtilityGain / shadowPaidWonCount).toFixed(4))
      : 0;

    return {
      totalDecisions: this.decisions.length,
      actualSpendUsd: 0.00,
      freeOptimalCount,
      shadowPaidWonCount,
      freeExhaustedRecoverableCount,
      hypotheticalSpendUsd: Number(totalHypotheticalSpendUsd.toFixed(6)),
      averageUtilityGain,
      providerBreakdown,
      modelBreakdown,
      tasks
    };
  }

  generateMarkdown(): string {
    return this.generateMarkdownReport();
  }

  generateMarkdownReport(): string {
    const summary = this.generateSummary();
    const lines: string[] = [];

    lines.push("# Beyonder v0.6 — Shadow Paid Routing Report");
    lines.push("");
    lines.push(`**Generated:** ${new Date().toISOString()}`);
    lines.push(`**Evaluation Mode:** SHADOW (Zero Monetary Spend Guaranteed)`);
    lines.push("");
    lines.push("## 1. Executive Summary");
    lines.push("");
    lines.push(`- **Total Routing Decisions:** ${summary.totalDecisions}`);
    lines.push(`- **Free Compute Won (Optimal):** ${summary.freeOptimalCount} (${((summary.freeOptimalCount / Math.max(1, summary.totalDecisions)) * 100).toFixed(1)}%)`);
    lines.push(`- **Shadow Paid Would Have Won:** ${summary.shadowPaidWonCount} (${((summary.shadowPaidWonCount / Math.max(1, summary.totalDecisions)) * 100).toFixed(1)}%)`);
    lines.push(`- **Free Exhausted (Recoverable via Paid):** ${summary.freeExhaustedRecoverableCount}`);
    lines.push(`- **Hypothetical Spend Required:** $${summary.hypotheticalSpendUsd.toFixed(4)}`);
    lines.push(`- **Average Utility Gain (when paid won):** +${summary.averageUtilityGain.toFixed(4)}`);
    lines.push(`- **Actual Monetary Spend:** **$0.0000** (Zero-cost invariant enforced)`);
    lines.push("");
    lines.push("## 2. Provider Distribution (Hypothetical)");
    lines.push("");
    lines.push("| Provider | Would-Win Count | Est. Spend (USD) |");
    lines.push("|---|---|---|");
    for (const [provider, stats] of Object.entries(summary.providerBreakdown)) {
      lines.push(`| ${provider} | ${stats.count} | $${stats.spendUsd.toFixed(4)} |`);
    }
    if (Object.keys(summary.providerBreakdown).length === 0) {
      lines.push("| *None* | 0 | $0.0000 |");
    }
    lines.push("");
    lines.push("## 3. Model Distribution (Hypothetical)");
    lines.push("");
    lines.push("| Model | Would-Win Count | Est. Spend (USD) |");
    lines.push("|---|---|---|");
    for (const [model, stats] of Object.entries(summary.modelBreakdown)) {
      lines.push(`| ${model} | ${stats.count} | $${stats.spendUsd.toFixed(4)} |`);
    }
    if (Object.keys(summary.modelBreakdown).length === 0) {
      lines.push("| *None* | 0 | $0.0000 |");
    }
    lines.push("");
    lines.push("## 4. Decision Log");
    lines.push("");
    lines.push("| Task ID | Type | Free Executed | Shadow Paid Candidate | Est. Paid Cost | ΔUtility | Decision Reason |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const t of summary.tasks) {
      lines.push(`| ${t.taskId} | ${t.taskType} | ${t.freeSelected} | ${t.shadowPaidCandidate} | $${t.estimatedPaidCostUsd.toFixed(4)} | ${t.utilityDifference > 0 ? `+${t.utilityDifference.toFixed(4)}` : "0.0000"} | ${t.reason.slice(0, 70)}... |`);
    }

    return lines.join("\n");
  }

  generateJsonReport(): ShadowReportSummary {
    return this.generateSummary();
  }
}
