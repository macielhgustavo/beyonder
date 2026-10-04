import { AutopilotStateStore, buildComputeInventory, getProvider, isModelEligibleForWorkload, isModelMetadataEligibleForWorkload, type ModelWorkload } from "@beyonder/compute";
import type { IntelligenceTask } from "../intelligence/contracts.js";
import type { EconomicState } from "../types.js";
import type { ModelCapabilitySource } from "./capability-source.js";
import { NullCapabilitySource, predictCapability } from "./capability-source.js";
import type { CapabilityPredictionEvidence, HistoricalPerformance, ModelCandidate, RouteDecision, RouterTelemetry } from "./adaptive-types.js";
import type { PerformanceRepository } from "./performance-repository.js";
import { EmptyPerformanceRepository } from "./performance-repository.js";
import type { QuotaSource } from "./quota.js";
import { AutopilotQuotaSource } from "./quota.js";
import type { RandomSource } from "./random.js";
import { MathRandomSource } from "./random.js";
import { ROUTER_CONFIG, getEconomicRoutingPolicy } from "./router-config.js";
import { ShadowCostCalculator } from "./shadow-cost.js";
import { calculateEffectiveResourceCost, calculateUtility } from "./utility.js";
import { discoverOllama } from "./ollama-discovery.js";

export interface AdaptiveSelectorOptions {
  operationalHealth?: (provider: string, model: string) => Promise<{ samples: number; failures: number; latencyMs: number } | undefined>;
  ollamaBaseUrl?: string;
  performanceRepository?: PerformanceRepository;
  capabilitySource?: ModelCapabilitySource;
  quotaSource?: QuotaSource;
  shadowCostCalculator?: ShadowCostCalculator;
  random?: RandomSource;
  telemetry?: RouterTelemetry;
}

type InventoryEntry = ReturnType<typeof buildComputeInventory>[number];

export class AdaptiveModelSelector {
  private readonly performance: PerformanceRepository;
  private readonly capabilitySource: ModelCapabilitySource;
  private readonly quotaSource: QuotaSource;
  private readonly shadowCost: ShadowCostCalculator;
  private readonly random: RandomSource;

  constructor(
    private readonly providerStatePath: string,
    private readonly options: AdaptiveSelectorOptions = {}
  ) {
    this.performance = options.performanceRepository ?? new EmptyPerformanceRepository();
    this.capabilitySource = options.capabilitySource ?? new NullCapabilitySource();
    this.quotaSource = options.quotaSource ?? new AutopilotQuotaSource(providerStatePath);
    this.shadowCost = options.shadowCostCalculator ?? new ShadowCostCalculator();
    this.random = options.random ?? new MathRandomSource();
  }

  async route(task: IntelligenceTask, economicState: EconomicState): Promise<RouteDecision> {
    const policy = getEconomicRoutingPolicy(economicState);
    if (!policy.allowInference) {
      return { task, economicState, candidates: [], explored: false, reason: "economic state halted blocks normal inference" };
    }

    const state = await new AutopilotStateStore(this.providerStatePath).read();
    const inventory = [...buildComputeInventory(state), ...(this.options.ollamaBaseUrl ? await discoverOllama(this.options.ollamaBaseUrl) : [])];
    const viablePairs = inventory.flatMap((entry) => this.expandCompatible(entry, task));
    const alternativesAvailable = Math.max(0, viablePairs.length - 1);
    const candidates: ModelCandidate[] = [];

    await this.telemetry("info", "router.candidates_generated", {
      taskId: task.id,
      taskType: task.type,
      economicState,
      count: viablePairs.length
    });

    for (const pair of viablePairs) {
      const performance = await this.performance.get(pair.entry.providerId, pair.model, task.type);
      const benchmarkCapability = await this.capabilitySource.getCapability({
        provider: pair.entry.providerId,
        model: pair.model,
        taskType: task.type
      });
      const predictedQuality = predictCapability({
        benchmarkPrior: benchmarkCapability?.score,
        performance,
        metadataQualityClass: pair.entry.qualityClass
      });
      const capabilityEvidence = predictionEvidence(predictedQuality, benchmarkCapability, performance);
      await this.telemetry("debug", "capability.resolved", {
        provider: pair.entry.providerId,
        model: pair.model,
        taskType: task.type,
        bibScore: capabilityEvidence.bibScore,
        bibSamples: capabilityEvidence.bibSamples,
        realScore: capabilityEvidence.realScore,
        realSamples: capabilityEvidence.realSamples,
        predictedScore: capabilityEvidence.predictedScore,
        source: capabilityEvidence.source
      });
      const quota = await this.quotaSource.get(pair.entry.providerId, pair.model);
      if (quota.health === "unknown") {
        quota.health = pair.entry.status === "keyless" ? "keyless" : "healthy";
      }
      await this.telemetry("debug", "quota.updated", { provider: pair.entry.providerId, model: pair.model, quota });

      const shadow = this.shadowCost.calculate({ quota, economicState, alternativesAvailable });
      if (pair.entry.providerId === "ollama") shadow.shadowCostUsd = 0;
      await this.telemetry("debug", "shadow_cost.calculated", {
        provider: pair.entry.providerId,
        model: pair.model,
        taskId: task.id,
        ...shadow
      });

      const health = await this.options.operationalHealth?.(pair.entry.providerId, pair.model);
      const failureRisk = health?.samples ? health.failures / health.samples : performance.samples === 0
        ? pair.entry.status === "healthy" ? 0.08 : 0.12
        : performance.failures / performance.samples;
      const reliability = clamp((1 - failureRisk) - (pair.entry.toolCalling === "unknown" && task.requirements.tools?.length ? 0.05 : 0));
      const latencyMs = health?.latencyMs ?? (performance.avgLatencyMs > 0 ? performance.avgLatencyMs : pair.entry.latencyMs ?? 0);
      const latencyPenalty = clamp(latencyMs / ROUTER_CONFIG.costNormalization.latencyReferenceMs);
      const monetaryCostUsd = 0;
      const effectiveResourceCost = calculateEffectiveResourceCost({
        monetaryCostUsd,
        shadowCostUsd: shadow.shadowCostUsd,
        latencyPenalty
      });
      const metadata = pair.entry.modelMetadata.find((m) => m.id === pair.model);
      const structuredPenalty = task.requirements.structuredOutput && metadata?.structuredOutput !== "native" ? metadata?.structuredOutput === "prompted" ? 0.02 : 0.08 : 0;
      const utility = calculateUtility({
        predictedQuality,
        historicalSuccess: performance.successRate,
        reliability,
        monetaryCostUsd,
        shadowCostUsd: shadow.shadowCostUsd,
        latencyPenalty,
        failureRisk
      }, economicState) - structuredPenalty;

      const candidate: ModelCandidate = {
        local: pair.entry.providerId === "ollama",
        costClass: metadata?.costClass,
        structuredOutput: metadata?.structuredOutput ?? "unknown",
        provider: pair.entry.providerId,
        model: pair.model,
        capabilities: capabilitiesFor(pair.entry),
        contextWindow: typeof pair.entry.contextWindow === "number" ? pair.entry.contextWindow : "unknown",
        toolCalling: pair.entry.toolCalling,
        predictedQuality,
        historicalSuccess: performance.successRate,
        reliability,
        monetaryCostUsd,
        shadowCostUsd: shadow.shadowCostUsd,
        latencyPenalty,
        failureRisk,
        effectiveResourceCost,
        utility,
        quota,
        performance,
        benchmarkCapability,
        capabilityEvidence,
        explanation: {
          positives: [
            { signal: `${task.type} capability`, value: predictedQuality },
            { signal: "BIB prior", value: benchmarkCapability ? benchmarkCapability.score : "N/A" },
            { signal: "BIB samples", value: benchmarkCapability ? benchmarkCapability.samples : 0 },
            { signal: "real-world score", value: capabilityEvidence.realScore ?? "N/A" },
            { signal: "real samples", value: performance.samples },
            { signal: "historical success", value: performance.successRate },
            { signal: "reliability", value: reliability },
            { signal: "monetary cost", value: "$0" }
          ],
          penalties: [
            { signal: "structured output uncertainty", value: structuredPenalty },
            { signal: "quota scarcity", value: shadow.scarcity },
            { signal: "shadow cost", value: shadow.shadowCostUsd },
            { signal: "latency", value: latencyPenalty },
            { signal: "failure risk", value: failureRisk }
          ],
          constraints: [
            `economic-state=${economicState}`,
            `effective-resource-cost=${effectiveResourceCost}`,
            shadow.reason
          ]
        }
      };

      await this.telemetry("debug", "router.candidate_scored", serializeCandidate(candidate, task.id));
      if (candidate.monetaryCostUsd <= policy.maxMonetaryCostUsd && candidate.effectiveResourceCost <= policy.maxEffectiveCostUsd) {
        candidates.push(candidate);
      }
    }

    candidates.sort((a, b) => b.utility - a.utility || b.predictedQuality - a.predictedQuality);
    if (candidates.length === 0) {
      return { task, economicState, candidates: [], explored: false, reason: `no compatible candidate fits ${economicState} constraints` };
    }

    let selected = candidates[0];
    let explored = false;
    if (candidates.length > 1 && this.random.next() < policy.explorationRate) {
      const offset = Math.floor(this.random.next() * (candidates.length - 1));
      selected = candidates[1 + offset] ?? selected;
      explored = selected !== candidates[0];
      if (explored) {
        await this.telemetry("info", "router.exploration_selected", serializeCandidate(selected, task.id));
      }
    }

    await this.telemetry("info", "router.selected", serializeCandidate(selected, task.id));
    return {
      task,
      economicState,
      candidates,
      selected,
      explored,
      reason: explored
        ? `controlled exploration within ${economicState} safety constraints`
        : `highest expected utility under ${economicState} constraints`
    };
  }

  async quotas() {
    return this.quotaSource.list();
  }

  async performanceFor(provider: string, model: string, taskType: IntelligenceTask["type"]) {
    return this.performance.get(provider, model, taskType);
  }

  private expandCompatible(entry: InventoryEntry, task: IntelligenceTask): Array<{ entry: InventoryEntry; model: string }> {
    if (!["healthy", "keyless"].includes(entry.status)) return [];
    if (entry.cost === "billing-risk") return [];
    if (task.requirements.contextWindow && typeof entry.contextWindow === "number" && entry.contextWindow < task.requirements.contextWindow) return [];
    if (task.requirements.vision) return [];
    const provider = getProvider(entry.providerId);
    const workload = workloadForTask(task.type);
    return entry.models
      .filter((model) => {
        const metadata = entry.modelMetadata.find((m) => m.id === model);
        return metadata && isModelMetadataEligibleForWorkload(metadata, workload) && ["FREE_CONFIRMED", "FREE_TIER_ELIGIBLE"].includes(metadata.costClass ?? "UNKNOWN_COST") && (!task.requirements.structuredOutput || metadata.structuredOutput !== "unsupported");
      })
      .filter((model) => provider ? isModelEligibleForWorkload(provider, model, workload) : true)
      .map((model) => ({ entry, model }));
  }

  private async telemetry(level: "debug" | "info" | "warn" | "error", event: string, details: Record<string, unknown>) {
    await this.options.telemetry?.record(level, event, details);
  }
}

function capabilitiesFor(entry: InventoryEntry): string[] {
  const result = ["text"];
  if (entry.toolCalling === "yes") result.push("tool-calling");
  if (typeof entry.contextWindow === "number") result.push(`context:${entry.contextWindow}`);
  return result;
}

export function workloadForTask(taskType: IntelligenceTask["type"]): ModelWorkload {
  return taskType === "chat" || taskType === "memory" ? "general_chat" : taskType;
}

function serializeCandidate(candidate: ModelCandidate, taskId: string): Record<string, unknown> {
  return {
    taskId,
    provider: candidate.provider,
    model: candidate.model,
    predictedQuality: candidate.predictedQuality,
    capabilityEvidence: candidate.capabilityEvidence,
    historicalSuccess: candidate.historicalSuccess,
    reliability: candidate.reliability,
    monetaryCostUsd: candidate.monetaryCostUsd,
    shadowCostUsd: candidate.shadowCostUsd,
    latencyPenalty: candidate.latencyPenalty,
    failureRisk: candidate.failureRisk,
    effectiveResourceCost: candidate.effectiveResourceCost,
    utility: candidate.utility
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function predictionEvidence(
  predictedScore: number,
  benchmarkCapability: ModelCandidate["benchmarkCapability"],
  performance: HistoricalPerformance
): CapabilityPredictionEvidence {
  const realScore = performance.samples > 0 ? clamp((performance.avgEvaluationScore + performance.successRate) / 2) : null;
  const source = benchmarkCapability && performance.samples > 0
    ? "BIB + outcomes"
    : benchmarkCapability
      ? "BIB"
      : performance.samples > 0
        ? "outcomes"
        : "metadata";
  return {
    bibScore: benchmarkCapability?.score ?? null,
    bibSamples: benchmarkCapability?.samples ?? 0,
    realScore,
    realSamples: performance.samples,
    predictedScore,
    source
  };
}
