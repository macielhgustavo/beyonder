import { AutopilotStateStore, buildComputeInventory } from "@beyonder/compute";
import type { IntelligenceTask } from "../intelligence/contracts.js";
import type { EconomicState } from "../types.js";
import type { ModelCapabilitySource } from "./capability-source.js";
import { NullCapabilitySource, predictCapability } from "./capability-source.js";
import type { ModelCandidate, RouteDecision, RouterTelemetry } from "./adaptive-types.js";
import type { PerformanceRepository } from "./performance-repository.js";
import { EmptyPerformanceRepository } from "./performance-repository.js";
import type { QuotaSource } from "./quota.js";
import { AutopilotQuotaSource } from "./quota.js";
import type { RandomSource } from "./random.js";
import { MathRandomSource } from "./random.js";
import { ROUTER_CONFIG, getEconomicRoutingPolicy } from "./router-config.js";
import { ShadowCostCalculator } from "./shadow-cost.js";
import { calculateEffectiveResourceCost, calculateUtility } from "./utility.js";

export interface AdaptiveSelectorOptions {
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
    const inventory = buildComputeInventory(state);
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
      const benchmarkPrior = await this.capabilitySource.getCapabilityScore({
        provider: pair.entry.providerId,
        model: pair.model,
        taskType: task.type
      });
      const predictedQuality = predictCapability({
        benchmarkPrior,
        performance,
        metadataQualityClass: pair.entry.qualityClass
      });
      const quota = await this.quotaSource.get(pair.entry.providerId, pair.model);
      if (quota.health === "unknown") {
        quota.health = pair.entry.status === "keyless" ? "keyless" : "healthy";
      }
      await this.telemetry("debug", "quota.updated", { provider: pair.entry.providerId, model: pair.model, quota });

      const shadow = this.shadowCost.calculate({ quota, economicState, alternativesAvailable });
      await this.telemetry("debug", "shadow_cost.calculated", {
        provider: pair.entry.providerId,
        model: pair.model,
        taskId: task.id,
        ...shadow
      });

      const failureRisk = performance.samples === 0
        ? pair.entry.status === "healthy" ? 0.08 : 0.12
        : performance.failures / performance.samples;
      const reliability = clamp((1 - failureRisk) - (pair.entry.toolCalling === "unknown" && task.requirements.tools?.length ? 0.05 : 0));
      const latencyMs = performance.avgLatencyMs > 0 ? performance.avgLatencyMs : pair.entry.latencyMs ?? 0;
      const latencyPenalty = clamp(latencyMs / ROUTER_CONFIG.costNormalization.latencyReferenceMs);
      const monetaryCostUsd = 0;
      const effectiveResourceCost = calculateEffectiveResourceCost({
        monetaryCostUsd,
        shadowCostUsd: shadow.shadowCostUsd,
        latencyPenalty
      });
      const utility = calculateUtility({
        predictedQuality,
        historicalSuccess: performance.successRate,
        reliability,
        monetaryCostUsd,
        shadowCostUsd: shadow.shadowCostUsd,
        latencyPenalty,
        failureRisk
      }, economicState);

      const candidate: ModelCandidate = {
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
        explanation: {
          positives: [
            { signal: `${task.type} capability`, value: predictedQuality },
            { signal: "historical success", value: performance.successRate },
            { signal: "reliability", value: reliability },
            { signal: "monetary cost", value: "$0" }
          ],
          penalties: [
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
    if (entry.cost !== "$0") return [];
    if (task.requirements.contextWindow && typeof entry.contextWindow === "number" && entry.contextWindow < task.requirements.contextWindow) return [];
    if (task.requirements.vision) return [];
    if (task.requirements.tools?.length && entry.toolCalling === "no") return [];
    return entry.models.map((model) => ({ entry, model }));
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

function serializeCandidate(candidate: ModelCandidate, taskId: string): Record<string, unknown> {
  return {
    taskId,
    provider: candidate.provider,
    model: candidate.model,
    predictedQuality: candidate.predictedQuality,
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
