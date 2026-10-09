import type { GoalContract, IntelligenceTask, RequiredCapability } from "../intelligence/contracts.js";
import type { CandidateCapabilityFit, CapabilityDimension, ComputeTier, ModelCandidate, QualityFloor } from "./adaptive-types.js";

/** Completed tools/planning do not need to be performed again by synthesis or
 * verification. Explicit goal requirements remain authoritative in both phases. */
export function objectivePhaseTask(task: IntelligenceTask, phase: "DIRECT_RESPONSE" | "OBJECTIVE_VERIFICATION"): IntelligenceTask {
  const verifying = phase === "OBJECTIVE_VERIFICATION";
  return {
    ...task,
    inferencePhase: phase,
    type: verifying ? "reasoning" : task.type,
    requirements: {
      ...task.requirements,
      planning: task.goalContract ? task.goalContract.requiredCapabilities.includes("planning") : task.requirements.planning,
      browser: verifying ? false : task.requirements.browser,
      toolUse: false,
      tools: [],
      directResponse: true,
      ...(verifying ? { reasoning: true, structuredOutput: true } : {})
    }
  };
}

export const CLOUD_FIRST_POLICY = {
  paidEscalationEnabled: false,
  localEmergencyFallbackBudget: 1,
  localShadowCostFloorUsd: 0.0015,
  strongCloudHeadroom: 0.08,
  strongCloudReliability: 0.72
} as const;

const LEVEL_BASE: Record<QualityFloor["level"], number> = {
  MINIMAL: 0.46,
  STANDARD: 0.59,
  HIGH: 0.71
};

const CAPABILITY_DIMENSION: Partial<Record<RequiredCapability, CapabilityDimension>> = {
  "web-research": "research",
  "browser-read": "research",
  comparison: "synthesis",
  citations: "freshnessEvidence",
  coding: "coding",
  reasoning: "reasoning",
  planning: "planning",
  "structured-output": "structuredOutput"
};

export function resolveQualityFloor(task: IntelligenceTask): QualityFloor {
  const contract = task.goalContract;
  let level: QualityFloor["level"] = contract?.qualityTarget ?? defaultLevel(task);
  if (isEvidenceHeavy(contract) || isCurrentResearch(task, contract)) level = "HIGH";

  const complexityBump = task.complexity >= 0.72 ? 0.06 : task.complexity >= 0.52 ? 0.035 : task.complexity >= 0.35 ? 0.015 : 0;
  const minimumOverall = clamp(LEVEL_BASE[level] + complexityBump);
  const dimensions: QualityFloor["dimensions"] = {};
  const reasons = [`qualityTarget=${level}`, `complexity=${task.complexity.toFixed(3)}`];

  const require = (dimension: CapabilityDimension, floor = minimumOverall) => {
    dimensions[dimension] = Math.max(dimensions[dimension] ?? 0, clamp(floor));
  };

  if (task.requirements.reasoning || task.type === "reasoning") require("reasoning");
  if (task.requirements.planning || task.type === "planning") require("planning");
  if (task.requirements.coding || task.type === "coding") require("coding");
  if (task.type === "research" || task.type === "browser" || task.requirements.browser) require("research");
  if (task.requirements.toolUse || task.requirements.tools?.length) require("toolUse", Math.max(0.5, minimumOverall - 0.05));
  if (task.requirements.structuredOutput) require("structuredOutput", Math.max(0.52, minimumOverall - 0.04));

  if (contract) {
    for (const capability of contract.requiredCapabilities) {
      const dimension = CAPABILITY_DIMENSION[capability];
      if (dimension) require(dimension);
    }
    if (contract.expectedResultKind === "COMPARISON") require("synthesis");
    // The producer must meet the artifact floor; a different physical model
    // must meet the independent-verification floor. Requiring the producer to
    // be an eligible judge too incorrectly removed useful producers and left
    // the only eligible judge producing an answer it cannot certify itself.
    // Unphased mission assessments retain the full contract's requirements.
    if (task.inferencePhase === "OBJECTIVE_VERIFICATION" || (task.inferencePhase !== "DIRECT_RESPONSE" && ["EXPLANATION", "COMPARISON", "CODE", "PLAN"].includes(contract.expectedResultKind))) require("verification", Math.max(0.54, minimumOverall - 0.03));
    if (contract.freshness !== "STATIC" || contract.evidenceRequirement === "REQUIRED") {
      require("freshnessEvidence", Math.max(0.58, minimumOverall));
      reasons.push(`freshness=${contract.freshness}`, `evidence=${contract.evidenceRequirement}:${contract.minimumEvidenceSources}`);
    }
  }

  if (Object.keys(dimensions).length === 0) require("synthesis", Math.max(0.42, minimumOverall - 0.06));
  if (task.inferencePhase) reasons.push(`phase=${task.inferencePhase}`);
  return { level, minimumOverall, dimensions, reasons };
}

export function assessCapability(candidate: ModelCandidate, task: IntelligenceTask, floor: QualityFloor): CandidateCapabilityFit {
  const prior = clamp(candidate.predictedQuality);
  const reliability = clamp(candidate.reliability);
  // predictedQuality is already the BIB/metadata posterior updated with real
  // outcomes. Applying raw outcomes again counted the same failure twice and
  // could permanently exclude a model after one failed mission. Reliability
  // remains a separate observed signal; the numerical floor is unchanged.
  const overall = clamp(prior * 0.82 + reliability * 0.18);
  const caps = new Set(candidate.capabilities.map((capability) => capability.toLowerCase()));
  const dimensions: CandidateCapabilityFit["dimensions"] = {};
  const evidence = [
    `quality=${candidate.predictedQuality.toFixed(3)}:${candidate.capabilityEvidence.source}`,
    `reliability=${candidate.reliability.toFixed(3)}`,
    `history=${candidate.performance.samples}`
  ];

  const supported = (dimension: CapabilityDimension): number => {
    const observed = candidate.benchmarkCapability?.dimensions?.[dimension];
    if (observed && observed.samples >= 2) {
      evidence.push(`${dimension}=${observed.score.toFixed(3)}:BIB:${observed.samples}:${observed.updatedAt}`);
      return clamp(observed.score);
    }
    // A good observed synthesis score is not evidence of coding or JSON ability.
    // Unmeasured dimensions retain their metadata prior until they are measured.
    let value = candidate.benchmarkCapability?.dimensions && candidate.metadataQuality !== undefined
      ? clamp(candidate.metadataQuality * 0.82 + reliability * 0.18) : overall;
    if (dimension === "reasoning") {
      if (caps.has("reasoning")) value += 0.06;
      else if (task.requirements.reasoning) value -= 0.035;
    }
    if (dimension === "planning") {
      if (caps.has("reasoning")) value += 0.035;
      if (candidate.structuredOutput === "native") value += 0.025;
    }
    if (dimension === "coding") {
      if (caps.has("code") || caps.has("coding") || /(?:^|[-_.:/])(code|coder)(?:[-_.:/]|$)/i.test(candidate.model)) value += 0.07;
      else if (task.type === "coding") value -= 0.03;
    }
    if (dimension === "research") {
      if (caps.has("reasoning")) value += 0.025;
      if (candidate.contextWindow !== "unknown" && candidate.contextWindow >= 16_000) value += 0.035;
    }
    if (dimension === "synthesis") {
      if (candidate.contextWindow !== "unknown" && candidate.contextWindow >= 8_000) value += 0.025;
    }
    if (dimension === "toolUse") {
      if (candidate.toolCalling === "yes") value += 0.08;
      else if (candidate.toolCalling === "unknown") value -= 0.035;
      else value -= 0.18;
    }
    if (dimension === "structuredOutput") {
      if (candidate.structuredOutput === "native") value += 0.08;
      else if (candidate.structuredOutput === "prompted") value -= 0.025;
      else value -= 0.2;
    }
    if (dimension === "verification") {
      value += Math.min(0.05, candidate.performance.samples / 200);
    }
    if (dimension === "freshnessEvidence") {
      value = clamp(value * 0.9 + reliability * 0.1);
      if (candidate.contextWindow !== "unknown" && candidate.contextWindow >= 16_000) value += 0.025;
    }
    return clamp(value);
  };

  const gaps: string[] = [];
  for (const [dimension, required] of Object.entries(floor.dimensions) as Array<[CapabilityDimension, number]>) {
    const score = supported(dimension);
    dimensions[dimension] = score;
    if (score < required) gaps.push(`${dimension}=${score.toFixed(3)}<${required.toFixed(3)}`);
  }
  if (overall < floor.minimumOverall) gaps.unshift(`overall=${overall.toFixed(3)}<${floor.minimumOverall.toFixed(3)}`);

  return { overall, dimensions, passes: gaps.length === 0, gaps, evidence };
}

export function computeTier(candidate: ModelCandidate, fit: CandidateCapabilityFit, floor: QualityFloor): ComputeTier {
  if (candidate.local || candidate.provider === "ollama") return "LOCAL_EMERGENCY";
  if (candidate.costClass === "PAID" || candidate.monetaryCostUsd > 0) return "PAID_DISABLED";
  const headroom = fit.overall - floor.minimumOverall;
  return headroom >= CLOUD_FIRST_POLICY.strongCloudHeadroom && candidate.reliability >= CLOUD_FIRST_POLICY.strongCloudReliability
    ? "STRONG_FREE_CLOUD"
    : "OTHER_FREE_CLOUD";
}

export function routingScore(candidate: ModelCandidate, fit: CandidateCapabilityFit, tier: ComputeTier, floor?: QualityFloor): number {
  if (tier === "PAID_DISABLED") return -1;
  // Required dimensions express task fit. Missing measurements retain a
  // metadata estimate; they are not interpreted as failed capability checks.
  const taskFit = Object.values(fit.dimensions);
  const dimensionFit = taskFit.length ? taskFit.reduce((sum, value) => sum + value, 0) / taskFit.length : fit.overall;
  // A bounded confidence bonus gives untried models a route to real evidence,
  // while measured failures still lower quality and reliability.
  const evidenceSamples = candidate.performance.samples + (candidate.benchmarkCapability?.samples ?? 0);
  const explorationBonus = 0.07 / Math.sqrt(evidenceSamples + 1);
  const minimal = floor?.level === "MINIMAL";
  const ceiling = minimal ? Math.min(1, floor.minimumOverall + 0.15) : 1;
  return Number((
    Math.min(dimensionFit, ceiling) * 0.38
    + Math.min(fit.overall, ceiling) * 0.24
    + candidate.reliability * 0.13
    + candidate.historicalSuccess * 0.08
    + candidate.utility * 0.12
    + explorationBonus
    - candidate.latencyPenalty * (minimal ? 0.08 : 0.035)
    - Math.min(1, candidate.shadowCostUsd / 0.01) * (minimal ? 0.07 : 0.035)
  ).toFixed(6));
}

export function executionTierRank(tier: ComputeTier | undefined): number {
  return tier === "STRONG_FREE_CLOUD" ? 0 : tier === "OTHER_FREE_CLOUD" ? 1 : tier === "PAID_DISABLED" ? 2 : 3;
}

export function paidCandidateAllowed(): boolean {
  return CLOUD_FIRST_POLICY.paidEscalationEnabled;
}

function defaultLevel(task: IntelligenceTask): QualityFloor["level"] {
  if (task.complexity >= 0.62 || ["research", "reasoning", "coding", "planning"].includes(task.type)) return "STANDARD";
  return "MINIMAL";
}

function isEvidenceHeavy(contract?: GoalContract): boolean {
  return Boolean(contract && contract.evidenceRequirement === "REQUIRED" && contract.minimumEvidenceSources >= 2 && ["RESEARCH", "COMPARISON", "FACTUAL"].includes(contract.primaryIntent));
}

function isCurrentResearch(task: IntelligenceTask, contract?: GoalContract): boolean {
  return Boolean(contract && ["CURRENT", "REALTIME"].includes(contract.freshness) && (task.type === "research" || contract.primaryIntent === "RESEARCH" || contract.primaryIntent === "COMPARISON"));
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}
