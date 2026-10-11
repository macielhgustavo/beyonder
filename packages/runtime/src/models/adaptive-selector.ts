import { AutopilotStateStore, buildComputeInventory, getProvider, resolveZeroCostExecution, readAccountCostEvidence, requireZeroCostDecision, isModelMetadataEligibleForWorkload, type ModelWorkload, type ZeroCostDecision, type ProviderAccountPlan, type BillingCapabilityEvidence, type InstallationBillingPosture } from "@beyonder/compute";
import type { IntelligenceTask } from "../intelligence/contracts.js";
import type { EconomicState } from "../types.js";
import type { ModelCapabilitySource } from "./capability-source.js";
import { NullCapabilitySource, predictCapability } from "./capability-source.js";
import type { CapabilityPredictionEvidence, HistoricalPerformance, ModelCandidate, RejectedCandidate, RouteDecision, RouterTelemetry, ShadowDecision } from "./adaptive-types.js";
import { CLOUD_FIRST_POLICY, assessCapability, computeTier, paidCandidateAllowed, resolveQualityFloor, routingScore } from "./compute-policy.js";
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
import type { PricingRegistry, PricingSnapshot } from "../economy/pricing-registry.js";
import { type CostEstimator, DefaultCostEstimator } from "../economy/cost-estimator.js";
import type { BudgetAccountant } from "../economy/budget-accountant.js";
import { microsToUsd } from "../economy/money.js";
import type { ComputeMode } from "../economy/compute-economy-config.js";

export interface AdaptiveSelectorOptions {
  /** Trusted account/price evidence adapter. Never a score adjustment or paid opt-in. */
  economicEvidence?: (provider: string, model: string) => Promise<ZeroCostDecision>;
  /** Explicit experimental opt-in; normal product routing chooses the best fit. */
  allowExploration?: boolean;
  canAttempt?: (candidate: Pick<ModelCandidate, "provider" | "model">) => Promise<boolean>;
  credentialAccess?: (provider: string) => Promise<import("@beyonder/credentials").CredentialDescriptor | undefined>;
  providerAccountPlan?: (provider: string) => Promise<ProviderAccountPlan | undefined>;
  billingCapability?: (provider: string) => Promise<BillingCapabilityEvidence | undefined>;
  installationPosture?: InstallationBillingPosture;
  operationalHealth?: (provider: string, model: string) => Promise<{ samples: number; failures: number; latencyMs: number } | undefined>;
  ollamaBaseUrl?: string;
  performanceRepository?: PerformanceRepository;
  capabilitySource?: ModelCapabilitySource;
  quotaSource?: QuotaSource;
  shadowCostCalculator?: ShadowCostCalculator;
  random?: RandomSource;
  telemetry?: RouterTelemetry;
  pricingRegistry?: PricingRegistry;
  costEstimator?: CostEstimator;
  budgetAccountant?: BudgetAccountant;
  shadowMode?: boolean;
  computeMode?: ComputeMode;
}

type InventoryEntry = ReturnType<typeof buildComputeInventory>[number];

export class AdaptiveModelSelector {
  private readonly performance: PerformanceRepository;
  private readonly capabilitySource: ModelCapabilitySource;
  private readonly quotaSource: QuotaSource;
  private readonly shadowCost: ShadowCostCalculator;
  private readonly random: RandomSource;
  private readonly pricingRegistry?: PricingRegistry;
  private readonly costEstimator: CostEstimator;
  private readonly budgetAccountant?: BudgetAccountant;

  constructor(
    private readonly providerStatePath: string,
    private readonly options: AdaptiveSelectorOptions = {}
  ) {
    this.performance = options.performanceRepository ?? new EmptyPerformanceRepository();
    this.capabilitySource = options.capabilitySource ?? new NullCapabilitySource();
    this.quotaSource = options.quotaSource ?? new AutopilotQuotaSource(providerStatePath);
    this.shadowCost = options.shadowCostCalculator ?? new ShadowCostCalculator();
    this.random = options.random ?? new MathRandomSource();
    this.pricingRegistry = options.pricingRegistry;
    this.costEstimator = options.costEstimator ?? new DefaultCostEstimator();
    this.budgetAccountant = options.budgetAccountant;
  }

  async route(task: IntelligenceTask, economicState: EconomicState): Promise<RouteDecision> {
    const policy = getEconomicRoutingPolicy(economicState);
    const qualityFloor = resolveQualityFloor(task);
    const baseDecision = {
      task,
      economicState,
      qualityFloor,
      paidEscalationEnabled: CLOUD_FIRST_POLICY.paidEscalationEnabled
    } as const;

    await this.telemetry("info", "router.quality_floor_resolved", {
      taskId: task.id,
      taskType: task.type,
      ...qualityFloor
    });

    if (!policy.allowInference) {
      return { ...baseDecision, candidates: [], consideredCandidates: [], rejectedCandidates: [], explored: false, capacityStatus: "NEEDS_CAPABILITY", reason: "economic state halted blocks normal inference" };
    }

    const state = await new AutopilotStateStore(this.providerStatePath).read();
    const inventory = [...buildComputeInventory(state), ...(this.options.ollamaBaseUrl ? await discoverOllama(this.options.ollamaBaseUrl) : [])];
    // Plan, credential and billing state are provider properties for this one
    // ranking snapshot. Actual execution checks them again before each POST.
    const evidence = await readAccountCostEvidence();
    const credentialAccess = memoizeProviderRead(this.options.credentialAccess);
    const accountPlan = memoizeProviderRead(this.options.providerAccountPlan);
    const billingCapability = memoizeProviderRead(this.options.billingCapability);
    const viablePairs = inventory.flatMap((entry) => this.expandCompatible(entry, task));
    const alternativesAvailable = Math.max(0, viablePairs.length - 1);
    const consideredCandidates: ModelCandidate[] = [];
    const candidates: ModelCandidate[] = [];
    const rejectedCandidates: RejectedCandidate[] = [];
    const costFilterCounts = new Map<string, number>();

    await this.telemetry("info", "router.candidates_generated", {
      taskId: task.id,
      taskType: task.type,
      economicState,
      count: viablePairs.length
    });

    const profiledPairs: Array<(typeof viablePairs)[number] & { inferenceProfile: string }> = [];
    for (const pair of viablePairs) {
      const reasoningControl = pair.entry.modelMetadata.find(model => model.id === pair.model)?.reasoningControl;
      const defaultProfile = `reasoning-${reasoningControl ? "low" : "default"}:max-output-2400`;
      const observedProfiles = reasoningControl ? await this.capabilitySource.listInferenceProfiles?.({ provider: pair.entry.providerId, model: pair.model }) ?? [] : [];
      // Keep the same bounded output budget. Disabling optional thinking is
      // eligible only after that exact profile has real BIB observations; it
      // still must meet every mission floor and independent-verifier boundary.
      const profiles = [defaultProfile, ...observedProfiles.filter(profile => profile === "reasoning-disabled:max-output-2400")];
      for (const inferenceProfile of new Set(profiles)) profiledPairs.push({ ...pair, inferenceProfile });
    }

    for (const pair of profiledPairs) {
      const access = await credentialAccess(pair.entry.providerId);
      if (access && (!access.accessible || access.valid === false)) {
        const rejected: RejectedCandidate = { provider: pair.entry.providerId, model: pair.model, inferenceProfile: pair.inferenceProfile, computeTier: pair.entry.providerId === 'ollama' ? 'LOCAL_EMERGENCY' : 'OTHER_FREE_CLOUD', reasons: [`credential:${access.status}; configured=${access.configured}; source=${access.source}; capability history retained`] };
        rejectedCandidates.push(rejected); await this.telemetry('debug', 'router.candidate_rejected', { taskId: task.id, ...rejected }); continue;
      }
      const economicQuota = this.quotaSource instanceof AutopilotQuotaSource
        ? this.quotaSource.getFromState(pair.entry.providerId, pair.model, state)
        : await this.quotaSource.get(pair.entry.providerId, pair.model);
      const provider = getProvider(pair.entry.providerId) ?? { id: 'ollama' as const, openAiCompatibleEndpoint: this.options.ollamaBaseUrl };
      const modelMetadata = pair.entry.modelMetadata.find(m => m.id === pair.model) ?? {
        id: pair.model,
        capabilities: ["CHAT", "REASONING", "CODING"],
        costClass: "PAID" as const
      };
      const accountEvidence = evidence.find(e => e.provider === pair.entry.providerId && e.model === pair.model);
      const observedEconomics = resolveZeroCostExecution({ provider, model: modelMetadata, credential: access, accountPlan: await accountPlan(pair.entry.providerId), billingCapability: await billingCapability(pair.entry.providerId), installationPosture: this.options.installationPosture, accountEvidence, quota: economicQuota });
      const economics = ['FREE_QUOTA_EXHAUSTED', 'PAID', 'BILLING_RISK', 'DEV_EVAL_ONLY'].includes(observedEconomics.classification) ? observedEconomics : await this.options.economicEvidence?.(pair.entry.providerId, pair.model) ?? observedEconomics;
      let costAllowed = true;
      try { requireZeroCostDecision(economics, pair.entry.providerId, pair.model); } catch { costAllowed = false; }

      const isShadowMode = this.options.shadowMode ?? (this.options.computeMode === "zero_cost" || this.options.computeMode === undefined);
      const isEconomyActive = Boolean(this.pricingRegistry);
      let isPaidCandidate = false;
      let pricingSnapshot: PricingSnapshot | null = null;
      let costEstimate: import("../economy/cost-estimator.js").CostEstimate | undefined = undefined;
      let worstCaseCostUsd = 0;
      let monetaryCostUsd = 0;
      if (economics.classification === 'FREE_QUOTA_EXHAUSTED') {
        const rejected: RejectedCandidate = {
          provider: pair.entry.providerId,
          model: pair.model,
          inferenceProfile: pair.inferenceProfile,
          computeTier: modelMetadata.costClass === 'PAID' ? 'PAID_DISABLED' : 'OTHER_FREE_CLOUD',
          economics,
          reasons: [`economic:${economics.classification}; ${economics.reason}`]
        };
        rejectedCandidates.push(rejected);
        const group = `${pair.entry.providerId}:${economics.classification}`;
        costFilterCounts.set(group, (costFilterCounts.get(group) ?? 0) + 1);
        await this.telemetry('info', 'quota.free_tier_exhausted', { provider: pair.entry.providerId, model: pair.model, reason: economics.reason });
        continue;
      }

      if (!costAllowed || modelMetadata.costClass === 'PAID' && !['PROVIDER_FREE_PLAN', 'PROVIDER_BILLING_API', 'INSTALLATION_ZERO_BILLING_POSTURE'].includes(economics.source) || pair.entry.cost === 'billing-risk') {
        if (isEconomyActive && this.pricingRegistry) {
          pricingSnapshot = this.pricingRegistry.getPrice(pair.entry.providerId, pair.model);
          if (!pricingSnapshot || !this.pricingRegistry.isFresh(pricingSnapshot)) {
            const rejected: RejectedCandidate = {
              provider: pair.entry.providerId,
              model: pair.model,
              inferenceProfile: pair.inferenceProfile,
              computeTier: 'PAID_DISABLED',
              economics,
              reasons: ['pricing: unknown or stale price snapshot; Invariant I-4 blocks billable route without verified pricing']
            };
            rejectedCandidates.push(rejected);
            await this.telemetry('debug', 'router.candidate_rejected', { taskId: task.id, ...rejected });
            continue;
          }

          const estimatedInputTokens = task.requirements.contextWindow ? Math.min(task.requirements.contextWindow, 2000) : 1500;
          const maxOutputTokens = task.requirements.structuredOutput ? 2400 : 1200;
          costEstimate = this.costEstimator.estimate({
            pricing: pricingSnapshot,
            estimatedInputTokens,
            maxOutputTokens
          });
          monetaryCostUsd = microsToUsd(costEstimate.estimatedCostMicros);
          worstCaseCostUsd = microsToUsd(costEstimate.worstCaseCostMicros);

          let affordable = true;
          if (this.budgetAccountant) {
            if (isShadowMode) {
              affordable = this.budgetAccountant.canAffordHypothetical({ objectiveId: task.id }, costEstimate.worstCaseCostMicros);
            } else {
              affordable = this.budgetAccountant.canAfford({ objectiveId: task.id }, costEstimate.worstCaseCostMicros);
            }
          }
          if (!affordable) {
            const rejected: RejectedCandidate = {
              provider: pair.entry.providerId,
              model: pair.model,
              inferenceProfile: pair.inferenceProfile,
              computeTier: 'PAID_DISABLED',
              economics,
              reasons: ['NEEDS_BUDGET: worst-case cost exceeds remaining applicable budget']
            };
            rejectedCandidates.push(rejected);
            await this.telemetry('debug', 'router.candidate_rejected', { taskId: task.id, ...rejected });
            continue;
          }

          isPaidCandidate = true;
        } else {
          const rejected: RejectedCandidate = { provider: pair.entry.providerId, model: pair.model, inferenceProfile: pair.inferenceProfile, computeTier: modelMetadata.costClass === 'PAID' ? 'PAID_DISABLED' : 'OTHER_FREE_CLOUD', economics, reasons: [`economic:${economics.classification}; ${economics.reason}`] };
          rejectedCandidates.push(rejected);
          const group = `${pair.entry.providerId}:${economics.classification}`;
          costFilterCounts.set(group, (costFilterCounts.get(group) ?? 0) + 1);
          if (economics.classification === 'FREE_QUOTA_EXHAUSTED') await this.telemetry('info', 'quota.free_tier_exhausted', { provider: pair.entry.providerId, model: pair.model, reason: economics.reason });
          continue;
        }
      } else {
        monetaryCostUsd = 0;
        worstCaseCostUsd = 0;
      }

      await this.telemetry('debug', 'economic.cost_evidence_resolved', { taskId: task.id, ...economics });
      if (!isPaidCandidate) {
        await this.telemetry('debug', 'economic.zero_cost_guarantee', { taskId: task.id, ...economics });
      }
      const unsafeVerdicts = task.inferencePhase === "OBJECTIVE_VERIFICATION"
        ? await this.capabilitySource.getVerificationSafetyEvidence?.(pair.model) : undefined;
      if (unsafeVerdicts?.falseApprovals) {
        const rejected: RejectedCandidate = {
          provider: pair.entry.providerId, model: pair.model, inferenceProfile: pair.inferenceProfile,
          computeTier: pair.entry.providerId === "ollama" ? "LOCAL_EMERGENCY" : "OTHER_FREE_CLOUD",
          reasons: [`verification safety: ${unsafeVerdicts.falseApprovals} adjudicated false approval(s); latest ${unsafeVerdicts.lastFalseApprovalAt}. Passing sample averages do not establish a safe verifier.`]
        };
        rejectedCandidates.push(rejected);
        await this.telemetry("debug", "router.candidate_rejected", { taskId: task.id, ...rejected });
        continue;
      }
      if (this.options.canAttempt && !await this.options.canAttempt({ provider: pair.entry.providerId, model: pair.model })) {
        const rejected: RejectedCandidate = {
          provider: pair.entry.providerId,
          model: pair.model,
          inferenceProfile: pair.inferenceProfile,
          computeTier: pair.entry.providerId === "ollama" ? "LOCAL_EMERGENCY" : "OTHER_FREE_CLOUD",
          reasons: ["operational cooldown prevents another attempt"]
        };
        rejectedCandidates.push(rejected);
        await this.telemetry("debug", "router.candidate_rejected", { taskId: task.id, ...rejected });
        continue;
      }

      const performance = await this.performance.get(pair.entry.providerId, pair.model, task.type);
      const inferenceProfile = pair.inferenceProfile;
      const benchmarkCapability = await this.capabilitySource.getCapability({
        provider: pair.entry.providerId,
        model: pair.model,
        taskType: task.type,
        inferenceProfile,
        dimensions: Object.keys(qualityFloor.dimensions) as Array<keyof typeof qualityFloor.dimensions>
      });
      if (inferenceProfile === "reasoning-disabled:max-output-2400" && benchmarkCapability?.inferenceProfile !== inferenceProfile) {
        const rejected: RejectedCandidate = {
          provider: pair.entry.providerId, model: pair.model, inferenceProfile,
          computeTier: pair.entry.providerId === "ollama" ? "LOCAL_EMERGENCY" : "OTHER_FREE_CLOUD",
          reasons: ["no observed task capability for the requested inference profile"]
        };
        rejectedCandidates.push(rejected);
        await this.telemetry("debug", "router.candidate_rejected", { taskId: task.id, ...rejected });
        continue;
      }
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

      const quota = this.quotaSource instanceof AutopilotQuotaSource
        ? this.quotaSource.getFromState(pair.entry.providerId, pair.model, state)
        : await this.quotaSource.get(pair.entry.providerId, pair.model);
      if (quota.health === "unknown") quota.health = pair.entry.status === "keyless" ? "keyless" : "healthy";
      await this.telemetry("debug", "quota.updated", { provider: pair.entry.providerId, model: pair.model, quota });

      const shadow = this.shadowCost.calculate({ quota, economicState, alternativesAvailable });
      if (pair.entry.providerId === "ollama") {
        shadow.shadowCostUsd = Math.max(shadow.shadowCostUsd, CLOUD_FIRST_POLICY.localShadowCostFloorUsd);
        shadow.reason = `${shadow.reason}; local emergency compute carries CPU/GPU opportunity cost`;
      }
      await this.telemetry("debug", "shadow_cost.calculated", {
        provider: pair.entry.providerId,
        model: pair.model,
        taskId: task.id,
        ...shadow
      });

      const health = await this.options.operationalHealth?.(pair.entry.providerId, pair.model);
      // Real BIB requests provide a measured operational prior. A single live
      // timeout does not erase many observed successful requests; cooldowns
      // still prevent any attempt while an outage/quota block is active.
      const priorOperations = benchmarkCapability?.operational ?? await this.capabilitySource.getOperationalEvidence?.({ provider: pair.entry.providerId, model: pair.model, inferenceProfile });
      const priorWeight = Math.min(10, priorOperations?.samples ?? 0);
      const failureRisk = health?.samples ? (health.failures + (priorOperations?.samples ? priorWeight * priorOperations.failures / priorOperations.samples : 0)) / (health.samples + priorWeight) : priorOperations?.samples ? priorOperations.failures / priorOperations.samples : performance.samples === 0
        ? pair.entry.status === "healthy" ? 0.08 : 0.12
        : performance.failures / performance.samples;
      const reliability = clamp((1 - failureRisk) - (pair.entry.toolCalling === "unknown" && task.requirements.tools?.length ? 0.05 : 0));
      // Catalog lookup latency is not inference latency. An unmeasured model
      // must not win the efficient-cloud decision by appearing instantaneous.
      const latencyMs = health?.samples ? health.latencyMs : (performance.avgLatencyMs > 0 ? performance.avgLatencyMs : benchmarkCapability?.latencyMs);
      const latencyPenalty = latencyMs === undefined ? 1 : clamp(latencyMs / ROUTER_CONFIG.costNormalization.latencyReferenceMs);
      // Rejected/unknown executions never reach scoring or acquire a $0 value.
      if (!isPaidCandidate) {
        const confirmedCost = economics.monetaryCost.state === 'CONFIRMED_ZERO' ? economics.monetaryCost.usd : undefined;
        if (confirmedCost !== 0) continue;
      }
      const effectiveResourceCost = calculateEffectiveResourceCost({
        monetaryCostUsd,
        shadowCostUsd: shadow.shadowCostUsd,
        latencyPenalty
      });
      const metadata = pair.entry.modelMetadata.find((m) => m.id === pair.model) ?? {
        id: pair.model,
        capabilities: ["text", ...(pair.model.includes("code") ? ["coding"] : []), ...(pair.model.includes("r1") ? ["reasoning"] : [])],
        costClass: "PAID" as const
      };
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
        economics,
        inferenceProfile,
        metadataQuality: ROUTER_CONFIG.qualityClassDefaults[pair.entry.qualityClass],
        local: pair.entry.providerId === "ollama",
        externalQuotaConsumption: pair.entry.providerId !== "ollama",
        costClass: isPaidCandidate ? 'PAID' : (['PROVIDER_FREE_PLAN', 'PROVIDER_BILLING_API', 'INSTALLATION_ZERO_BILLING_POSTURE'].includes(economics.source) ? 'FREE_TIER_ELIGIBLE' : metadata?.costClass),
        structuredOutput: metadata?.structuredOutput ?? "unknown",
        provider: pair.entry.providerId,
        model: pair.model,
        capabilities: capabilitiesFor(pair.entry, pair.model),
        contextWindow: metadata?.contextWindow ?? (typeof pair.entry.contextWindow === "number" ? pair.entry.contextWindow : "unknown"),
        toolCalling: metadata?.toolCalling ?? pair.entry.toolCalling,
        predictedQuality,
        historicalSuccess: performance.successRate,
        reliability,
        monetaryCostUsd,
        worstCaseCostUsd,
        pricingSnapshot: pricingSnapshot ?? undefined,
        costEstimate,
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
            { signal: "monetary cost", value: isPaidCandidate ? `$${monetaryCostUsd.toFixed(4)}` : "$0" }
          ],
          penalties: [
            { signal: "structured output uncertainty", value: structuredPenalty },
            { signal: "quota scarcity", value: shadow.scarcity },
            { signal: "shadow cost", value: shadow.shadowCostUsd },
            { signal: "latency", value: latencyPenalty },
            { signal: "failure risk", value: failureRisk },
            ...(isPaidCandidate ? [{ signal: "monetary cost penalty", value: monetaryCostUsd }] : [])
          ],
          constraints: [
            `economic-state=${economicState}`,
            `inference-profile=${inferenceProfile}`,
            `effective-resource-cost=${effectiveResourceCost}`,
            shadow.reason
          ]
        }
      };

      const capabilityFit = assessCapability(candidate, task, qualityFloor);
      const allowPaidTier = isPaidCandidate && (isShadowMode || (this.options.computeMode === "bounded" && CLOUD_FIRST_POLICY.paidEscalationEnabled));
      const tier = computeTier(candidate, capabilityFit, qualityFloor, allowPaidTier);
      const score = routingScore(candidate, capabilityFit, tier, qualityFloor);
      const rejectionReasons: string[] = [];
      // A quality estimate is evidence for ranking, never permission to produce.
      // Unknown and low-sample models must be able to gather real observations.
      if (tier === "PAID_DISABLED" && !paidCandidateAllowed() && !isShadowMode) rejectionReasons.push("paid escalation is architecturally represented but disabled in v0.5");
      if (!isShadowMode && candidate.monetaryCostUsd > policy.maxMonetaryCostUsd) rejectionReasons.push(`monetary-cost>${policy.maxMonetaryCostUsd}`);
      // Shadow cost is a score signal. The hard economic limit is monetary.

      Object.assign(candidate, {
        capabilityFit,
        computeTier: tier,
        routingScore: score,
        eligible: rejectionReasons.length === 0,
        rejectionReasons
      });
      candidate.explanation.constraints.push(`compute-tier=${tier}`, `quality-floor=${qualityFloor.level}:${qualityFloor.minimumOverall}`, `capability-fit=${capabilityFit.overall}`);
      consideredCandidates.push(candidate);

      await this.telemetry("debug", "router.candidate_scored", serializeCandidate(candidate, task.id, task.inferencePhase));
      if (rejectionReasons.length === 0) {
        candidates.push(candidate);
      } else {
        const rejected: RejectedCandidate = {
          provider: candidate.provider,
          model: candidate.model,
          inferenceProfile: candidate.inferenceProfile,
          computeTier: tier,
          reasons: rejectionReasons,
          capabilityFit,
          predictedQuality: candidate.predictedQuality,
          reliability: candidate.reliability,
          latencyPenalty: candidate.latencyPenalty,
          monetaryCostUsd: candidate.monetaryCostUsd,
          shadowCostUsd: candidate.shadowCostUsd
        };
        rejectedCandidates.push(rejected);
        await this.telemetry("debug", "router.candidate_rejected", { taskId: task.id, ...rejected });
      }
    }

    if (costFilterCounts.size) await this.telemetry('debug', 'router.cost_filter_summary', { taskId: task.id, counts: Object.fromEntries(costFilterCounts) });

    candidates.sort((a, b) => (b.routingScore ?? -Infinity) - (a.routingScore ?? -Infinity) || b.predictedQuality - a.predictedQuality);
    // Multiple qualified modes are alternatives for one physical candidate,
    // not additional providers, verifier independence, or fresh quota capacity.
    const selectedModels = new Set<string>();
    for (let index = 0; index < candidates.length;) {
      const candidate = candidates[index]!;
      const identity = `${candidate.provider}/${candidate.model}`;
      if (selectedModels.has(identity)) candidates.splice(index, 1);
      else { selectedModels.add(identity); index++; }
    }
    consideredCandidates.sort((a, b) => (b.routingScore ?? -Infinity) - (a.routingScore ?? -Infinity));

    if (candidates.length === 0) {
      await this.telemetry("warn", "router.needs_capability", {
        taskId: task.id,
        taskType: task.type,
        qualityFloor,
        rejectedCandidates: rejectedCandidates.map((candidate) => ({ provider: candidate.provider, model: candidate.model, tier: candidate.computeTier, reasons: candidate.reasons }))
      });
      return {
        ...baseDecision,
        candidates: [],
        consideredCandidates,
        rejectedCandidates,
        explored: false,
        capacityStatus: "NEEDS_CAPABILITY",
        reason: "No operationally and economically eligible model is available"
      };
    }

    const cloudCandidates = candidates.filter((candidate) => !candidate.local);
    const isShadowMode = this.options.shadowMode ?? (this.options.computeMode === "zero_cost" || this.options.computeMode === undefined);
    const isEconomyActive = Boolean(this.pricingRegistry);
    const overallBest = candidates[0];
    const freeCandidates = candidates.filter((candidate) => candidate.monetaryCostUsd === 0);
    const bestFree = freeCandidates[0];

    let selected: ModelCandidate | undefined = candidates[0];
    let shadowDecision: ShadowDecision | undefined = undefined;

    if (isShadowMode && isEconomyActive) {
      if (overallBest && overallBest.monetaryCostUsd > 0) {
        // Paid candidate achieved highest utility! In shadow mode, defer live execution to best free candidate.
        selected = bestFree;
        shadowDecision = {
          shadowMode: true,
          shadowCandidate: overallBest,
          selectedCandidate: bestFree,
          estimatedPaidCostUsd: overallBest.monetaryCostUsd,
          worstCasePaidCostUsd: overallBest.worstCaseCostUsd ?? overallBest.monetaryCostUsd,
          utilityDifference: Number((overallBest.routingScore! - (bestFree?.routingScore ?? 0)).toFixed(6)),
          whyPaidCandidateWon: `Superior task-adjusted utility (${overallBest.routingScore?.toFixed(4)} vs ${bestFree?.routingScore?.toFixed(4) ?? 'none'}) justifying estimated cost of $${overallBest.monetaryCostUsd.toFixed(4)}`,
          whyNotSelectedForLive: "Shadow mode active: zero-cost invariant enforced (monetary spend = $0)."
        };
        await this.telemetry("info", "router.shadow_decision_recorded", {
          taskId: task.id,
          ...shadowDecision
        });
      } else if (overallBest) {
        selected = overallBest;
        shadowDecision = {
          shadowMode: true,
          shadowCandidate: undefined,
          selectedCandidate: overallBest,
          estimatedPaidCostUsd: 0,
          worstCasePaidCostUsd: 0,
          utilityDifference: 0,
          whyPaidCandidateWon: "Free candidate had optimal utility; paid candidates did not justify additional cost.",
          whyNotSelectedForLive: "Free candidate selected directly."
        };
      }
    }

    let explored = false;
    const explorationPool = (isShadowMode ? freeCandidates : candidates).length > 1 ? (isShadowMode ? freeCandidates : candidates) : [];
    if (this.options.allowExploration === true && explorationPool.length > 1 && this.random.next() < policy.explorationRate) {
      const offset = Math.floor(this.random.next() * (explorationPool.length - 1));
      selected = explorationPool[1 + offset] ?? selected;
      explored = selected !== (isShadowMode ? bestFree : candidates[0]);
      if (explored && selected) await this.telemetry("info", "router.exploration_selected", serializeCandidate(selected, task.id, task.inferencePhase));
    }

    if (!selected) {
      const reason = shadowDecision?.shadowCandidate
        ? `Free compute capacity exhausted; shadow paid candidate ${shadowDecision.shadowCandidate.provider}/${shadowDecision.shadowCandidate.model} ($${shadowDecision.estimatedPaidCostUsd.toFixed(4)}) would have satisfied objective under bounded paid routing.`
        : "No operationally and economically eligible model is available";
      await this.telemetry("warn", "router.needs_capability", {
        taskId: task.id,
        taskType: task.type,
        qualityFloor,
        shadowDecision,
        rejectedCandidates: rejectedCandidates.map((c) => ({ provider: c.provider, model: c.model, tier: c.computeTier, reasons: c.reasons }))
      });
      return {
        ...baseDecision,
        candidates,
        consideredCandidates,
        rejectedCandidates,
        explored: false,
        capacityStatus: "NEEDS_CAPABILITY",
        reason,
        shadowDecision
      };
    }

    const capacityStatus = cloudCandidates.length > 0 ? "NORMAL" : "CAPACITY_REDUCED";
    if (capacityStatus === "CAPACITY_REDUCED") {
      await this.telemetry("warn", "router.capacity_reduced", {
        taskId: task.id,
        selected: `${selected.provider}/${selected.model}`,
        qualityFloor,
        reason: "only quality-qualified local emergency compute is available"
      });
    }

    await this.telemetry("info", "router.selected", serializeCandidate(selected, task.id, task.inferencePhase));
    return {
      ...baseDecision,
      candidates,
      consideredCandidates,
      rejectedCandidates,
      selected,
      explored,
      capacityStatus,
      reason: capacityStatus === "CAPACITY_REDUCED"
        ? "only local zero-cost compute is available"
        : explored
          ? `controlled cloud exploration within ${economicState} safety and quality constraints`
          : `highest task-adjusted score under ${economicState} zero-money constraints`,
      shadowDecision
    };
  }

  async quotas() {
    return this.quotaSource.list();
  }

  async performanceFor(provider: string, model: string, taskType: IntelligenceTask["type"]) {
    return this.performance.get(provider, model, taskType);
  }

  private expandCompatible(entry: InventoryEntry, task: IntelligenceTask): Array<{ entry: InventoryEntry; model: string }> {
    // Bootstrap state can be stale after a transient validation failure. A
    // previously validated catalog is still discoverable; current credential,
    // cooldown and economic checks decide whether it can be attempted now.
    if (!["healthy", "keyless"].includes(entry.status) && !entry.modelCatalogReady) return [];
    if (task.requirements.contextWindow && typeof entry.contextWindow === "number" && entry.contextWindow < task.requirements.contextWindow) return [];
    if (task.requirements.vision) return [];
    const workload = workloadForTask(task.type);

    const availableModels = new Set(entry.models);
    if (this.pricingRegistry) {
      for (const snapshot of this.pricingRegistry.listForProvider(entry.providerId)) {
        availableModels.add(snapshot.model);
      }
    }

    return Array.from(availableModels)
      .filter((model) => {
        const metadata = entry.modelMetadata.find((m) => m.id === model) ?? {
          id: model,
          capabilities: ["CHAT", "REASONING", ...(model.includes("code") ? ["CODING" as const] : [])],
          costClass: "PAID" as const
        };
        return isModelMetadataEligibleForWorkload(metadata, workload) && (!task.requirements.structuredOutput || metadata.structuredOutput !== "unsupported");
      })
      .map((model) => ({ entry, model }));
  }

  private async telemetry(level: "debug" | "info" | "warn" | "error", event: string, details: Record<string, unknown>) {
    await this.options.telemetry?.record(level, event, details);
  }
}

function memoizeProviderRead<T>(read: ((provider: string) => Promise<T>) | undefined): (provider: string) => Promise<T | undefined> {
  const cache = new Map<string, Promise<T>>();
  return provider => {
    if (!read) return Promise.resolve(undefined);
    let result = cache.get(provider);
    if (!result) { result = read(provider); cache.set(provider, result); }
    return result;
  };
}

function capabilitiesFor(entry: InventoryEntry, model: string): string[] {
  const metadata = entry.modelMetadata.find((item) => item.id === model);
  const result = new Set<string>(["text"]);
  for (const capability of metadata?.capabilities ?? []) result.add(String(capability).toLowerCase());
  if (metadata?.reasoningControl) result.add("reasoning-control");
  if (entry.toolCalling === "yes") result.add("tool-calling");
  if (typeof entry.contextWindow === "number") result.add(`context:${entry.contextWindow}`);
  return [...result];
}

export function workloadForTask(taskType: IntelligenceTask["type"]): ModelWorkload {
  // Synthesis uses chat-capable models; its task-specific quality remains in
  // the selector score and performance history.
  return taskType === "chat" || taskType === "memory" || taskType === "synthesis" ? "general_chat" : taskType;
}

function serializeCandidate(candidate: ModelCandidate, taskId: string, phase?: IntelligenceTask["inferencePhase"]): Record<string, unknown> {
  return {
    taskId,
    phase,
    provider: candidate.provider,
    model: candidate.model,
    inferenceProfile: candidate.inferenceProfile,
    computeTier: candidate.computeTier,
    eligible: candidate.eligible,
    rejectionReasons: candidate.rejectionReasons,
    routingScore: candidate.routingScore,
    capabilityFit: candidate.capabilityFit,
    predictedQuality: candidate.predictedQuality,
    capabilityEvidence: candidate.capabilityEvidence,
    benchmarkCapability: candidate.benchmarkCapability,
    capabilities: candidate.capabilities,
    contextWindow: candidate.contextWindow,
    structuredOutput: candidate.structuredOutput,
    toolCalling: candidate.toolCalling,
    historicalSuccess: candidate.historicalSuccess,
    reliability: candidate.reliability,
    monetaryCostUsd: candidate.monetaryCostUsd,
    economics: candidate.economics,
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
