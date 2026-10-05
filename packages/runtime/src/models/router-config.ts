import type { EconomicState } from "../types.js";

export const ROUTER_CONFIG = {
  utilityWeights: {
    predictedQuality: 0.5,
    historicalSuccess: 0.18,
    reliability: 0.12,
    monetaryCost: 0.08,
    shadowCost: 0.06,
    latency: 0.03,
    failureRisk: 0.03
  },
  qualityClassDefaults: {
    high: 0.78,
    medium: 0.64,
    low: 0.48,
    unknown: 0.5
  },
  history: {
    priorStrength: 5,
    maxHistoryWeight: 0.8
  },
  costNormalization: {
    monetaryReferenceUsd: 0.01,
    shadowReferenceUsd: 0.01,
    latencyReferenceMs: 2500,
    retryPenaltyUsd: 0.001,
    latencyEffectiveCostUsd: 0.001
  },
  shadowCost: {
    epsilon: 0.05,
    baseScarcityUnitUsd: 0.004,
    unknownQuotaPenaltyUsd: 0.0015,
    unhealthyPenaltyMultiplier: 4,
    unknownHealthMultiplier: 1.5,
    alternativeRelief: 0.15
  },
  economicStates: {
    growth: {
      explorationRate: 0.1,
      costSensitivity: 0.8,
      qualityBias: 1.1,
      maxAttempts: 3,
      maxEscalations: 2,
      maxMonetaryCostUsd: 0,
      maxEffectiveCostUsd: 0.03,
      minimumAcceptableQuality: 0.6,
      allowInference: true
    },
    normal: {
      explorationRate: 0.05,
      costSensitivity: 1,
      qualityBias: 1,
      maxAttempts: 3,
      maxEscalations: 1,
      maxMonetaryCostUsd: 0,
      maxEffectiveCostUsd: 0.02,
      minimumAcceptableQuality: 0.65,
      allowInference: true
    },
    defensive: {
      explorationRate: 0.02,
      costSensitivity: 1.25,
      qualityBias: 0.95,
      maxAttempts: 2,
      maxEscalations: 1,
      maxMonetaryCostUsd: 0,
      maxEffectiveCostUsd: 0.012,
      minimumAcceptableQuality: 0.62,
      allowInference: true
    },
    survival: {
      explorationRate: 0.005,
      costSensitivity: 1.6,
      qualityBias: 0.85,
      maxAttempts: 2,
      maxEscalations: 0,
      maxMonetaryCostUsd: 0,
      maxEffectiveCostUsd: 0.006,
      minimumAcceptableQuality: 0.55,
      allowInference: true
    },
    halted: {
      explorationRate: 0,
      costSensitivity: 2,
      qualityBias: 0.8,
      maxAttempts: 0,
      maxEscalations: 0,
      maxMonetaryCostUsd: 0,
      maxEffectiveCostUsd: 0,
      minimumAcceptableQuality: 1,
      allowInference: false
    }
  }
} as const;

export type EconomicRoutingPolicy = (typeof ROUTER_CONFIG.economicStates)[EconomicState];

export function getEconomicRoutingPolicy(state: EconomicState): EconomicRoutingPolicy {
  return ROUTER_CONFIG.economicStates[state];
}

/** Cloud attempts and local emergency fallback have independent caps; cumulative time/cost budgets remain authoritative. */
export function inferenceAttemptPolicy(state: EconomicState) {
  const policy = getEconomicRoutingPolicy(state);
  return {
    remoteAttemptBudget: policy.maxAttempts,
    localFallbackBudget: policy.allowInference ? 1 : 0
  };
}
