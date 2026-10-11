/**
 * Beyonder Compute Economy — Spend Decision Record & Structured Explainability
 *
 * Implements structured explainability for compute routing decisions, enabling
 * operators to inspect exactly why a paid candidate was preferred or would have been
 * chosen in shadow mode over free alternatives.
 *
 * @see docs/v06-compute-economy-architecture.md (§13 Observability, §14 Migration)
 */

import type { RouteDecision } from "../models/adaptive-types.js";
import { usdToMicros } from "./money.js";

export interface SpendDecisionRecord {
  objectiveId: string;
  taskId: string;
  provider: string;
  model: string;
  phase: string;
  pricingSnapshotId: string;
  estimatedCostMicros: number;
  worstCaseCostMicros: number;
  actualCostMicros: number | null;
  budgetRemainingMicros: number;
  budgetHardCapMicros: number;
  freeAlternativesConsidered: number;
  paidAlternativesConsidered: number;
  whySelected: string;
  whyNotFree: string[];
  expectedUtility: number;
  reservationId?: string;
  reservationState?: string;
  timestamp: string;
  mode: "shadow" | "live";
}

export interface SpendExplanationDetails {
  taskId: string;
  taskType: string;
  taskCriticality?: "LOW" | "STANDARD" | "HIGH";
  mode: "shadow" | "live";
  selectedModel: string;
  selectedProvider: string;
  estimatedCostUsd: number;
  expectedUtility: number;
  freeAlternativesCount: number;
  paidAlternativesCount: number;
  whyChosen: string;
  freeAlternativesSummary: string[];
  alternatives: Array<{
    provider: string;
    model: string;
    tier: string;
    costUsd: number;
    utility: number;
    quality: number;
    reliability: number;
  }>;
}

/**
 * Creates a SpendDecisionRecord from a RouteDecision.
 */
export function createSpendDecisionRecord(
  decision: RouteDecision,
  params: {
    objectiveId?: string;
    budgetRemainingMicros?: number;
    budgetHardCapMicros?: number;
    reservationId?: string;
    reservationState?: string;
    mode?: "shadow" | "live";
  } = {}
): SpendDecisionRecord {
  const isShadow = params.mode === "shadow" || Boolean(decision.shadowDecision?.shadowMode);
  const targetCandidate = isShadow
    ? (decision.shadowDecision?.shadowCandidate ?? decision.selected)
    : decision.selected;

  const freeCandidates = (decision.consideredCandidates ?? decision.candidates).filter(
    (c) => c.monetaryCostUsd === 0
  );
  const paidCandidates = (decision.consideredCandidates ?? decision.candidates).filter(
    (c) => c.monetaryCostUsd > 0
  );

  const whyNotFree: string[] = [];
  if (decision.rejectedCandidates) {
    for (const rejected of decision.rejectedCandidates) {
      if (rejected.monetaryCostUsd === 0 || rejected.computeTier === "STRONG_FREE_CLOUD" || rejected.computeTier === "OTHER_FREE_CLOUD") {
        whyNotFree.push(`${rejected.provider}/${rejected.model}: ${rejected.reasons.join(", ")}`);
      }
    }
  }

  const estimatedCostMicros = targetCandidate?.costEstimate?.estimatedCostMicros ??
    (targetCandidate ? usdToMicros(targetCandidate.monetaryCostUsd) : 0);
  const worstCaseCostMicros = targetCandidate?.costEstimate?.worstCaseCostMicros ??
    (targetCandidate?.worstCaseCostUsd ? usdToMicros(targetCandidate.worstCaseCostUsd) : estimatedCostMicros);

  return {
    objectiveId: params.objectiveId ?? decision.task.id,
    taskId: decision.task.id,
    provider: targetCandidate?.provider ?? "none",
    model: targetCandidate?.model ?? "none",
    phase: decision.task.inferencePhase ?? "DEFAULT",
    pricingSnapshotId: targetCandidate?.pricingSnapshot?.id ?? "unknown",
    estimatedCostMicros,
    worstCaseCostMicros,
    actualCostMicros: isShadow ? 0 : null,
    budgetRemainingMicros: params.budgetRemainingMicros ?? 250_000,
    budgetHardCapMicros: params.budgetHardCapMicros ?? 250_000,
    freeAlternativesConsidered: freeCandidates.length,
    paidAlternativesConsidered: paidCandidates.length,
    whySelected: decision.shadowDecision?.whyPaidCandidateWon ?? decision.reason,
    whyNotFree,
    expectedUtility: targetCandidate?.utility ?? 0,
    reservationId: params.reservationId,
    reservationState: params.reservationState ?? (isShadow ? "SHADOW_SIMULATED" : undefined),
    timestamp: new Date().toISOString(),
    mode: isShadow ? "shadow" : "live"
  };
}

/**
 * Formats a human-readable explanation from a SpendDecisionRecord and RouteDecision,
 * answering "Why was this compute spend chosen / preferred?"
 */
export function formatSpendExplanation(record: SpendDecisionRecord, decision?: RouteDecision): string {
  const lines: string[] = [];
  lines.push(`Spend Decision (${record.mode.toUpperCase()} MODE)`);
  lines.push(`Objective / Task: ${record.taskId}`);
  lines.push(`Candidate: ${record.provider}/${record.model}`);
  lines.push(`Estimated Cost: $${(record.estimatedCostMicros / 1_000_000).toFixed(4)} (Worst Case: $${(record.worstCaseCostMicros / 1_000_000).toFixed(4)})`);
  lines.push(`Expected Utility: ${record.expectedUtility.toFixed(4)}`);
  lines.push(`Alternatives Considered: ${record.freeAlternativesConsidered} free, ${record.paidAlternativesConsidered} paid`);
  lines.push(`Why Preferred: ${record.whySelected}`);

  if (record.whyNotFree.length > 0) {
    lines.push("Free Alternatives Status:");
    for (const reason of record.whyNotFree.slice(0, 5)) {
      lines.push(`  - ${reason}`);
    }
  }

  if (decision?.shadowDecision && record.mode === "shadow") {
    lines.push(`Actual Live Execution: ${decision.shadowDecision.selectedCandidate ? `${decision.shadowDecision.selectedCandidate.provider}/${decision.shadowDecision.selectedCandidate.model} ($0.00)` : "None (Capacity Exhausted)"}`);
    lines.push(`Note: ${decision.shadowDecision.whyNotSelectedForLive}`);
  }

  return lines.join("\n");
}
