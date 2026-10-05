export type IntelligenceTaskType =
  | "chat"
  | "reasoning"
  | "coding"
  | "research"
  | "extraction"
  | "classification"
  | "planning"
  | "tool-use"
  | "browser"
  | "memory"
  | "compression";

export type ObjectiveFreshness = "STATIC" | "RECENT" | "CURRENT" | "REALTIME";
export type EvidenceRequirement = "NONE" | "PREFERRED" | "REQUIRED";
export type ObjectiveAmbiguity = "LOW" | "MEDIUM" | "HIGH";
export type ObjectiveQualityTarget = "MINIMAL" | "STANDARD" | "HIGH";
export type ObjectiveOutcomeStatus = "SUCCEEDED" | "PARTIAL" | "NEEDS_INPUT" | "NEEDS_CAPABILITY" | "BLOCKED" | "FAILED" | "RECONCILIATION_REQUIRED";
export type ObjectiveResultKind = "SHORT_ANSWER" | "EXPLANATION" | "COMPARISON" | "CODE" | "PLAN" | "STRUCTURED_DATA" | "CALCULATION";
export type ObjectiveIntent = "FACTUAL" | "RESEARCH" | "COMPARISON" | "CALCULATION" | "CODING" | "REASONING" | "PLANNING" | "EXTRACTION" | "CLASSIFICATION" | "MEMORY" | "OTHER";
export type RequiredCapability = "web-research" | "browser-read" | "comparison" | "citations" | "calculator" | "coding" | "reasoning" | "planning" | "structured-output" | "memory";

export interface ObjectiveSuccessCriterion {
  id: string;
  description: string;
  required: boolean;
  kind: "CONTENT" | "EVIDENCE" | "FORMAT" | "CAPABILITY";
}

/** Persisted, multi-dimensional interpretation of what would actually satisfy the user. */
export interface GoalContract {
  version: 1;
  normalizedObjective: string;
  primaryIntent: ObjectiveIntent;
  domain: string;
  freshness: ObjectiveFreshness;
  evidenceRequirement: EvidenceRequirement;
  requiredCapabilities: RequiredCapability[];
  ambiguityLevel: ObjectiveAmbiguity;
  clarificationRequired: boolean;
  successCriteria: ObjectiveSuccessCriterion[];
  expectedResultKind: ObjectiveResultKind;
  qualityTarget: ObjectiveQualityTarget;
  minimumEvidenceSources: number;
  analysisMethod: "deterministic-high-confidence" | "hybrid";
}

export interface IntelligenceRequirements {
  directResponse?: boolean;
  toolUse?: boolean;
  calculator?: boolean;
  browser?: boolean;
  planning?: boolean;
  coding?: boolean;
  tools?: string[];
  contextWindow?: number;
  structuredOutput?: boolean;
  reasoning?: boolean;
  vision?: boolean;
}

export interface IntelligenceTask {
  id: string;
  input: string;
  type: IntelligenceTaskType;
  complexity: number;
  risk: number;
  estimatedTokens: number;
  requirements: IntelligenceRequirements;
  /** Present for tasks created through IntelligenceLayer; legacy fixtures are analyzed on use. */
  goalContract?: GoalContract;
}

export interface ExecutionPlanStep {
  id: string;
  kind: "memory" | "deterministic" | "model" | "tool";
  description: string;
  optional?: boolean;
}

export interface ExecutionPlan {
  id: string;
  taskId: string;
  steps: ExecutionPlanStep[];
  createdAt: string;
}

export interface ExecutionAttempt {
  failureClass?: string;
  phase?: string;
  id: string;
  taskId: string;
  attempt: number;
  provider?: string;
  model?: string;
  startedAt: string;
  completedAt?: string;
  latencyMs?: number;
  tokens?: number;
  monetaryCostUsd: number;
  shadowCostUsd: number;
  tools: string[];
  success: boolean;
  error?: string;
}

export interface Evaluation {
  score: number;
  passed: boolean;
  confidence?: number;
  method?: string;
  criteria?: Record<string, number | boolean | string>;
  notes?: string[];
  issues?: string[];
}

export interface TaskOutcome {
  phase?: string;
  failureClass?: string;
  task: IntelligenceTask;
  plan?: ExecutionPlan;
  attempts: ExecutionAttempt[];
  success: boolean;
  result?: string;
  error?: string;
  evaluation?: Evaluation;
  provider?: string;
  model?: string;
  tokens: number;
  monetaryCostUsd: number;
  shadowCostUsd: number;
  latencyMs: number;
  tools: string[];
  quotaConsumed?: number;
  completedAt: string;
}

export interface IntelligenceResult {
  task: IntelligenceTask;
  plan?: ExecutionPlan;
  context: {
    memoryIds: string[];
    summary: string;
  };
  outcome?: TaskOutcome;
}
