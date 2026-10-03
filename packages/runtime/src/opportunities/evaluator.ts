import type { EconomicState } from "../types.js";
import type { MemoryEngine } from "../memory/memory-engine.js";
import type { Opportunity, OpportunityStatus } from "./contracts.js";
import type { OpportunityStore } from "./store.js";

export type FeasibilityStatus = "FEASIBLE" | "PARTIALLY_FEASIBLE" | "NOT_FEASIBLE" | "UNKNOWN";
export type EconomicDecision = "QUEUE" | "IGNORE" | "REQUIRES_APPROVAL";

export interface OpportunityEvaluation {
  opportunityId: string;
  feasibility: FeasibilityStatus;
  estimatedRewardUsd?: number;
  estimatedSuccessProbability?: number;
  estimatedMonetaryCostUsd: number;
  estimatedShadowCostUsd: number;
  estimatedDurationMinutes?: number;
  riskScore: number;
  confidence: number;
  expectedGrossValue?: number;
  expectedNetValue?: number;
  reasons: string[];
  decision: EconomicDecision;
  evaluatedAt: string;
  missingCapabilities: string[];
  memorySignals: number;
}

export interface OpportunityEvaluatorOptions {
  capabilities?: Iterable<string>;
  economicState?: EconomicState;
  memory?: MemoryEngine;
  now?: () => Date;
  defaultDurationMinutes?: number;
}

const DEFAULT_CAPABILITIES = ["browser.read", "browser.navigate", "research", "structured extraction", "coding", "planning"];

export class OpportunityEvaluator {
  private readonly capabilities: Set<string>;
  private readonly now: () => Date;

  constructor(
    private readonly options: OpportunityEvaluatorOptions = {},
    private readonly store?: OpportunityStore
  ) {
    this.capabilities = new Set(options.capabilities ?? DEFAULT_CAPABILITIES);
    this.now = options.now ?? (() => new Date());
  }

  async evaluate(opportunity: Opportunity): Promise<OpportunityEvaluation> {
    const now = this.now();
    const reasons: string[] = [];
    const requirements = opportunity.requirements;
    const missingCapabilities = requirements.requiredCapabilities.filter((capability) => !this.hasCapability(capability));
    const expired = opportunity.deadline ? new Date(opportunity.deadline).getTime() < now.getTime() : false;
    const approvalRequired = requirements.requiresApplication || requirements.requiresExternalMessage || requirements.requiresAccount ||
      requirements.requiresIdentityVerification || requirements.requiresPayment || requirements.requiresSubmission || requirements.requiredCapitalUsd > 0;
    const memorySignals = this.options.memory ? (await this.options.memory.retrieve({ query: `${opportunity.type} ${opportunity.title}`, taskType: opportunity.type, limit: 3 })).length : 0;

    if (expired) {
      reasons.push("deadline has passed");
      return this.persist(opportunity, this.result(opportunity, "NOT_FEASIBLE", "IGNORE", reasons, missingCapabilities, memorySignals, now, 0, 0, 1));
    }
    if (missingCapabilities.length > 0) {
      reasons.push(`missing capabilities: ${missingCapabilities.join(", ")}`);
      return this.persist(opportunity, this.result(opportunity, "NOT_FEASIBLE", "IGNORE", reasons, missingCapabilities, memorySignals, now, 0, 0, 0.95));
    }
    if (approvalRequired) reasons.push("external, identity, payment, account, or capital action requires approval");

    const reward = rewardEstimate(opportunity);
    const probability = successProbability(opportunity, this.options.economicState ?? "normal", memorySignals);
    const monetaryCost = 0;
    const shadowCost = durationEstimate(opportunity, this.options.defaultDurationMinutes) * 0.001;
    const riskScore = riskEstimate(opportunity);
    const expectedGrossValue = reward === undefined ? undefined : reward * probability;
    const expectedNetValue = expectedGrossValue === undefined ? undefined : expectedGrossValue - monetaryCost - shadowCost - riskScore * 0.1;
    if (reward === undefined) reasons.push("reward is unknown; no value was invented");
    if ((this.options.economicState ?? "normal") === "halted") reasons.push("economic state is halted");

    let feasibility: FeasibilityStatus = "FEASIBLE";
    let decision: EconomicDecision = "QUEUE";
    if (this.options.economicState === "halted") {
      feasibility = "UNKNOWN";
      decision = "IGNORE";
    } else if (approvalRequired) {
      decision = "REQUIRES_APPROVAL";
    } else if (reward === undefined || (this.options.economicState === "survival" && probability < 0.75)) {
      decision = this.options.economicState === "survival" ? "IGNORE" : "REQUIRES_APPROVAL";
    }

    return this.persist(opportunity, {
      opportunityId: opportunity.id,
      feasibility,
      estimatedRewardUsd: reward,
      estimatedSuccessProbability: probability,
      estimatedMonetaryCostUsd: monetaryCost,
      estimatedShadowCostUsd: shadowCost,
      estimatedDurationMinutes: durationEstimate(opportunity, this.options.defaultDurationMinutes),
      riskScore,
      confidence: reward === undefined ? 0.45 : 0.8,
      expectedGrossValue,
      expectedNetValue,
      reasons,
      decision,
      evaluatedAt: now.toISOString(),
      missingCapabilities,
      memorySignals
    });
  }

  private result(opportunity: Opportunity, feasibility: FeasibilityStatus, decision: EconomicDecision, reasons: string[], missingCapabilities: string[], memorySignals: number, now: Date, reward: number | undefined, probability: number, confidence: number): OpportunityEvaluation {
    return {
      opportunityId: opportunity.id,
      feasibility,
      estimatedRewardUsd: reward,
      estimatedSuccessProbability: probability,
      estimatedMonetaryCostUsd: 0,
      estimatedShadowCostUsd: 0,
      riskScore: 1,
      confidence,
      expectedGrossValue: reward === undefined ? undefined : reward * probability,
      expectedNetValue: reward === undefined ? undefined : reward * probability,
      reasons,
      decision,
      evaluatedAt: now.toISOString(),
      missingCapabilities,
      memorySignals
    };
  }

  private async persist(opportunity: Opportunity, evaluation: OpportunityEvaluation): Promise<OpportunityEvaluation> {
    if (this.store) {
      const status: OpportunityStatus = evaluation.decision === "QUEUE" ? "QUEUED" : evaluation.decision === "IGNORE" ? "IGNORED" : "REQUIRES_APPROVAL";
      await this.store.upsert({ ...opportunity, status, metadata: { ...opportunity.metadata, evaluation } });
    }
    return evaluation;
  }

  private hasCapability(required: string): boolean {
    if (this.capabilities.has(required)) return true;
    if (required === "browser.extract" && this.capabilities.has("structured extraction")) return true;
    if (required === "browser.navigate" && this.capabilities.has("browser.read")) return true;
    return false;
  }
}

export class OpportunityQueue {
  constructor(private readonly store: OpportunityStore) {}

  async enqueue(opportunity: Opportunity, evaluation?: OpportunityEvaluation): Promise<Opportunity> {
    return this.store.upsert({
      ...opportunity,
      status: "QUEUED",
      metadata: evaluation ? { ...opportunity.metadata, evaluation } : opportunity.metadata
    });
  }

  async list(): Promise<Opportunity[]> {
    const queued = await this.store.list("QUEUED");
    return queued.sort((a, b) => evaluationValue(b) - evaluationValue(a) || b.discoveredAt.localeCompare(a.discoveredAt));
  }

  async dequeue(): Promise<Opportunity | undefined> {
    const item = (await this.list())[0];
    if (!item) return undefined;
    return this.store.updateStatus(item.id, "EXECUTING");
  }
}

function rewardEstimate(opportunity: Opportunity): number | undefined {
  if (!opportunity.reward) return undefined;
  if (opportunity.reward.type === "FIXED") return opportunity.reward.amount;
  if (opportunity.reward.type === "RANGE" && opportunity.reward.minAmount !== undefined && opportunity.reward.maxAmount !== undefined) {
    return (opportunity.reward.minAmount + opportunity.reward.maxAmount) / 2;
  }
  return undefined;
}

function successProbability(opportunity: Opportunity, state: EconomicState, memorySignals: number): number {
  const base = opportunity.requiredCapabilities.length > 0 ? 0.85 : 0.65;
  const statePenalty = state === "survival" ? 0.05 : state === "defensive" ? 0.02 : 0;
  return Math.min(0.98, Math.max(0.05, base + Math.min(memorySignals, 2) * 0.02 - statePenalty));
}

function durationEstimate(opportunity: Opportunity, fallback = 10): number {
  const value = opportunity.metadata?.estimatedDurationMinutes;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function riskEstimate(opportunity: Opportunity): number {
  const r = opportunity.requirements;
  let risk = 0.1;
  if (r.requiresApplication || r.requiresExternalMessage || r.requiresSubmission) risk += 0.3;
  if (r.requiresAccount || r.requiresIdentityVerification) risk += 0.4;
  if (r.requiresPayment || r.requiredCapitalUsd > 0) risk += 0.5;
  return Math.min(1, risk);
}

function evaluationValue(opportunity: Opportunity): number {
  const evaluation = opportunity.metadata?.evaluation;
  return typeof evaluation === "object" && evaluation !== null && typeof (evaluation as { expectedNetValue?: unknown }).expectedNetValue === "number"
    ? (evaluation as { expectedNetValue: number }).expectedNetValue : 0;
}
