import type { EconomicState } from "../types.js";
import type { IntelligenceTask } from "../intelligence/contracts.js";
import { ROUTER_CONFIG, getEconomicRoutingPolicy } from "./router-config.js";

export interface MonetaryReferencePriors {
  chatOrSimpleUsd: number;
  standardUsd: number;
  complexOrCodingUsd: number;
  verificationUsd: number;
}

export const DEFAULT_MONETARY_REFERENCE_PRIORS: MonetaryReferencePriors = {
  chatOrSimpleUsd: 0.05,
  standardUsd: 0.10,
  complexOrCodingUsd: 0.25,
  verificationUsd: 0.50,
};

export interface MonetaryReferenceContext {
  task?: Partial<IntelligenceTask>;
  objectiveValueUsd?: number;
  remainingBudgetUsd?: number;
  missionValueUsd?: number;
  riskFactor?: number;
  deadlineMs?: number;
  historicalMarginalUtility?: number;
}

export type MonetaryReferenceResolver = (
  context: MonetaryReferenceContext,
  priors: MonetaryReferencePriors
) => number;

/**
 * Resolves the reference cost parameter for utility normalization.
 *
 * Values are configurable bootstrap/cold-start priors rather than universal
 * economic truths, with an extensible context seam for objective value,
 * remaining budget, mission value, risk, deadline, and marginal utility.
 *
 * @see docs/adr/007-value-aware-cost-normalization.md
 */
export function resolveMonetaryReference(
  contextOrTask?: MonetaryReferenceContext | Partial<IntelligenceTask>,
  priors: MonetaryReferencePriors = DEFAULT_MONETARY_REFERENCE_PRIORS,
  customResolver?: MonetaryReferenceResolver
): number {
  if (!contextOrTask) {
    return priors.standardUsd ?? ROUTER_CONFIG.costNormalization.monetaryReferenceUsd;
  }

  // Distinguish between a direct IntelligenceTask and a MonetaryReferenceContext
  const context: MonetaryReferenceContext =
    "type" in contextOrTask || "complexity" in contextOrTask || "inferencePhase" in contextOrTask
      ? { task: contextOrTask as Partial<IntelligenceTask> }
      : (contextOrTask as MonetaryReferenceContext);

  if (customResolver) {
    return customResolver(context, priors);
  }

  const task = context.task;
  if (!task) return priors.standardUsd;
  if (task.inferencePhase === "OBJECTIVE_VERIFICATION") {
    return priors.verificationUsd;
  }
  const complexity = task.complexity ?? 0.5;
  if (complexity >= 0.8 || task.type === "coding" || task.requirements?.reasoning) {
    return priors.complexOrCodingUsd;
  }
  if (complexity <= 0.4 || task.type === "chat") {
    return priors.chatOrSimpleUsd;
  }
  return priors.standardUsd;
}

export interface UtilityInputs {
  predictedQuality: number;
  historicalSuccess: number;
  reliability: number;
  monetaryCostUsd: number;
  shadowCostUsd: number;
  latencyPenalty: number;
  failureRisk: number;
}

export function calculateUtility(
  input: UtilityInputs,
  economicState: EconomicState,
  options?: { monetaryReferenceUsd?: number }
): number {
  const weights = ROUTER_CONFIG.utilityWeights;
  const policy = getEconomicRoutingPolicy(economicState);
  const monetaryReference = options?.monetaryReferenceUsd ?? ROUTER_CONFIG.costNormalization.monetaryReferenceUsd;
  const monetaryPenalty = normalizeCost(input.monetaryCostUsd, monetaryReference);
  const shadowPenalty = normalizeCost(input.shadowCostUsd, ROUTER_CONFIG.costNormalization.shadowReferenceUsd);
  const positive =
    weights.predictedQuality * clamp(input.predictedQuality * policy.qualityBias) +
    weights.historicalSuccess * clamp(input.historicalSuccess) +
    weights.reliability * clamp(input.reliability);
  const negative = policy.costSensitivity * (
    weights.monetaryCost * monetaryPenalty +
    weights.shadowCost * shadowPenalty +
    weights.latency * clamp(input.latencyPenalty) +
    weights.failureRisk * clamp(input.failureRisk)
  );
  return round(positive - negative);
}

export function calculateEffectiveResourceCost(input: {
  monetaryCostUsd: number;
  shadowCostUsd: number;
  latencyPenalty: number;
  retryCount?: number;
}): number {
  return round(
    input.monetaryCostUsd +
    input.shadowCostUsd +
    (input.retryCount ?? 0) * ROUTER_CONFIG.costNormalization.retryPenaltyUsd +
    clamp(input.latencyPenalty) * ROUTER_CONFIG.costNormalization.latencyEffectiveCostUsd
  );
}

export function intelligenceEfficiency(quality: number, effectiveResourceCost: number): number {
  return quality / Math.max(effectiveResourceCost, 0.000001);
}

function normalizeCost(value: number, reference: number): number {
  if (value <= 0) return 0;
  return clamp(value / Math.max(reference, 0.000001));
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
