import type { EconomicState } from "../types.js";
import type { QuotaSnapshot } from "./adaptive-types.js";
import { ROUTER_CONFIG, getEconomicRoutingPolicy } from "./router-config.js";

export interface ShadowCostResult {
  shadowCostUsd: number;
  scarcity: number;
  quotaRatio: number | "unknown";
  reason: string;
}

export class ShadowCostCalculator {
  calculate(input: {
    quota: QuotaSnapshot;
    economicState: EconomicState;
    alternativesAvailable: number;
  }): ShadowCostResult {
    const policy = getEconomicRoutingPolicy(input.economicState);
    const quotaPair = selectQuotaPair(input.quota);
    const healthMultiplier = healthMultiplierFor(input.quota.health);
    const alternativesDivisor = 1 + Math.max(0, input.alternativesAvailable) * ROUTER_CONFIG.shadowCost.alternativeRelief;

    if (!quotaPair) {
      const shadowCostUsd =
        ROUTER_CONFIG.shadowCost.unknownQuotaPenaltyUsd * policy.costSensitivity * healthMultiplier / alternativesDivisor;
      return {
        shadowCostUsd: round(shadowCostUsd),
        scarcity: 0.5,
        quotaRatio: "unknown",
        reason: "quota remaining is unknown; conservative penalty applied"
      };
    }

    const ratio = clamp(quotaPair.remaining / Math.max(quotaPair.total, 1));
    const rawScarcity = 1 / (ratio + ROUTER_CONFIG.shadowCost.epsilon) - 1;
    const scarcity = clamp(rawScarcity / (1 + Math.max(0, rawScarcity)));
    const shadowCostUsd =
      ROUTER_CONFIG.shadowCost.baseScarcityUnitUsd * scarcity * policy.costSensitivity * healthMultiplier / alternativesDivisor;

    return {
      shadowCostUsd: round(shadowCostUsd),
      scarcity: round(scarcity),
      quotaRatio: round(ratio),
      reason: `quota scarcity derived from ${quotaPair.kind} remaining/total`
    };
  }
}

function selectQuotaPair(quota: QuotaSnapshot): { kind: "requests" | "tokens"; total: number; remaining: number } | null {
  const pairs: Array<{ kind: "requests" | "tokens"; total: number; remaining: number }> = [];
  if (typeof quota.requestQuotaTotal === "number" && typeof quota.requestQuotaRemaining === "number" && quota.requestQuotaTotal > 0) {
    pairs.push({ kind: "requests", total: quota.requestQuotaTotal, remaining: quota.requestQuotaRemaining });
  }
  if (typeof quota.tokenQuotaTotal === "number" && typeof quota.tokenQuotaRemaining === "number" && quota.tokenQuotaTotal > 0) {
    pairs.push({ kind: "tokens", total: quota.tokenQuotaTotal, remaining: quota.tokenQuotaRemaining });
  }
  if (pairs.length === 0) return null;
  return pairs.sort((a, b) => a.remaining / a.total - b.remaining / b.total)[0] ?? null;
}

function healthMultiplierFor(health: QuotaSnapshot["health"]): number {
  if (health === "unhealthy") return ROUTER_CONFIG.shadowCost.unhealthyPenaltyMultiplier;
  if (health === "unknown") return ROUTER_CONFIG.shadowCost.unknownHealthMultiplier;
  return 1;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
