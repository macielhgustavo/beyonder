import type { IntelligenceTaskType } from "../intelligence/contracts.js";
import type { HistoricalPerformance } from "./adaptive-types.js";
import { ROUTER_CONFIG } from "./router-config.js";
import type { CapabilityDimension } from "./adaptive-types.js";

export interface ModelCapabilityRequest {
  provider: string;
  model: string;
  taskType: IntelligenceTaskType;
  dimensions?: CapabilityDimension[];
  inferenceProfile?: string;
}

export interface ModelCapabilityEvidence {
  score: number;
  samples: number;
  source: "BIB";
  updatedAt?: string;
  latencyMs?: number;
  inferenceProfile?: string;
  dimensions?: Partial<Record<CapabilityDimension, { score: number; samples: number; updatedAt: string }>>;
  structuredOutputMode?: "prompted" | "native";
  operational?: { samples: number; failures: number; lastSuccessfulRequestAt?: string };
}

export interface ModelCapabilitySource {
  listInferenceProfiles?(input: Pick<ModelCapabilityRequest, "provider" | "model">): Promise<string[]>;
  getCapability(input: ModelCapabilityRequest): Promise<ModelCapabilityEvidence | null>;
  getCapabilityScore(input: ModelCapabilityRequest): Promise<number | null>;
  getLastSuccessfulRequest?(provider: string): Promise<{ model: string; observedAt: string } | null>;
  getOperationalEvidence?(input: Pick<ModelCapabilityRequest, "provider" | "model" | "inferenceProfile">): Promise<NonNullable<ModelCapabilityEvidence["operational"]> | null>;
}

export class NullCapabilitySource implements ModelCapabilitySource {
  async getCapability(): Promise<ModelCapabilityEvidence | null> {
    return null;
  }

  async getCapabilityScore(): Promise<number | null> {
    return null;
  }
}

export function predictCapability(input: {
  benchmarkPrior?: number | null;
  performance: HistoricalPerformance;
  metadataQualityClass: "high" | "medium" | "low" | "unknown";
}): number {
  const metadataPrior = ROUTER_CONFIG.qualityClassDefaults[input.metadataQualityClass];
  const basePrior = clamp(input.benchmarkPrior ?? metadataPrior);
  if (input.performance.samples === 0) return basePrior;

  const historyWeight = Math.min(
    ROUTER_CONFIG.history.maxHistoryWeight,
    input.performance.samples / (input.performance.samples + ROUTER_CONFIG.history.priorStrength)
  );
  const observed = clamp((input.performance.avgEvaluationScore + input.performance.successRate) / 2);
  return clamp(basePrior * (1 - historyWeight) + observed * historyWeight);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
