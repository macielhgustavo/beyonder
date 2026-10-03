import type { EconomicState } from "../types.js";
import { ROUTER_CONFIG, getEconomicRoutingPolicy } from "./router-config.js";

export interface UtilityInputs {
  predictedQuality: number;
  historicalSuccess: number;
  reliability: number;
  monetaryCostUsd: number;
  shadowCostUsd: number;
  latencyPenalty: number;
  failureRisk: number;
}

export function calculateUtility(input: UtilityInputs, economicState: EconomicState): number {
  const weights = ROUTER_CONFIG.utilityWeights;
  const policy = getEconomicRoutingPolicy(economicState);
  const monetaryPenalty = normalizeCost(input.monetaryCostUsd, ROUTER_CONFIG.costNormalization.monetaryReferenceUsd);
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
