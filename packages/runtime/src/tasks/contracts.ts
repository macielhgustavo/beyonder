import type { ToolCall, ToolDescriptor, ToolExecutionResult } from "@beyonder/tools";
import type { IntelligenceTask } from "../intelligence/contracts.js";
import type { EconomicState } from "../types.js";
import type { ModelCandidate, RouteDecision } from "../models/adaptive-types.js";
import type { RetrievedMemory } from "../memory/memory-engine.js";

export type TaskExecutionState =
  | "CREATED"
  | "PLANNING"
  | "READY"
  | "RUNNING"
  | "WAITING"
  | "RECOVERING"
  | "REPLANNING"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED"
  | "BUDGET_EXHAUSTED"
  | "CANCELLED";

export type CompletionStatus = Extract<
  TaskExecutionState,
  "COMPLETED" | "FAILED" | "BLOCKED" | "BUDGET_EXHAUSTED" | "CANCELLED"
>;

export type PlanStepStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "BLOCKED" | "SKIPPED";

export interface PlanStep {
  id: string;
  description: string;
  status: PlanStepStatus;
  expectedOutcome?: string;
  allowedToolCapabilities?: string[];
  dependencies?: string[];
  action?: ToolCall;
}

export interface Plan {
  id: string;
  taskId: string;
  objective: string;
  steps: PlanStep[];
  createdAt: string;
  revision: number;
  assumptions?: string[];
}

export interface TaskBudget {
  maxSteps: number;
  maxToolInvocations: number;
  maxRetries: number;
  maxReplans: number;
  maxDurationMs: number;
  maxMonetaryCostUsd: number;
  maxShadowCostUsd: number;
  maxConsecutiveFailures: number;
  maxNoProgressSteps: number;
}

export interface StepContext {
  objective: string;
  planSummary: string;
  currentStep: PlanStep;
  recentCheckpoints: ExecutionCheckpoint[];
  relevantMemory: RetrievedMemory[];
  latestObservation?: string;
  availableTools: readonly ToolDescriptor[];
  remainingBudget: TaskBudgetUsage;
  selectedModel?: ModelCandidate;
}

export interface TaskBudgetUsage {
  steps: number;
  toolInvocations: number;
  retries: number;
  replans: number;
  durationMs: number;
  monetaryCostUsd: number;
  shadowCostUsd: number;
  consecutiveFailures: number;
  noProgressSteps: number;
}

export interface StepExecution {
  id: string;
  stepId: string;
  attempt: number;
  status: PlanStepStatus;
  startedAt: string;
  completedAt?: string;
  toolCall?: ToolCall;
  toolResult?: ToolExecutionResult;
  observationSummary?: string;
  route?: Pick<RouteDecision, "reason" | "explored"> & {
    selected?: Pick<ModelCandidate, "provider" | "model" | "utility" | "shadowCostUsd">;
    candidates: number;
  };
  error?: string;
}

export interface ExecutionCheckpoint {
  taskId: string;
  planId: string;
  stepIndex: number;
  state: TaskExecutionState;
  observationSummary?: string;
  completedSteps: string[];
  pendingSteps: string[];
  toolInvocations: number;
  monetaryCostUsd: number;
  shadowCostUsd: number;
  timestamp: string;
}

export interface TaskExecution {
  id: string;
  task: IntelligenceTask;
  plan: Plan;
  state: TaskExecutionState;
  budget: TaskBudget;
  usage: TaskBudgetUsage;
  checkpoints: ExecutionCheckpoint[];
  steps: StepExecution[];
  startedAt: string;
  completedAt?: string;
  result?: string;
  error?: string;
}

export interface AutonomousTaskOutcome {
  execution: TaskExecution;
  status: CompletionStatus;
  success: boolean;
  result?: string;
  failureReason?: string;
}

export interface StepActionDecision {
  call: ToolCall;
}

export interface StepActionPlanner {
  decide(context: StepContext): StepActionDecision | Promise<StepActionDecision>;
}

export interface TaskExecutorTelemetry {
  record(level: "debug" | "info" | "warn" | "error", event: string, details?: Record<string, unknown>): Promise<void>;
}

export const DEFAULT_TASK_BUDGET: TaskBudget = {
  maxSteps: 12,
  maxToolInvocations: 20,
  maxRetries: 2,
  maxReplans: 2,
  maxDurationMs: 120_000,
  maxMonetaryCostUsd: 0,
  maxShadowCostUsd: 0.02,
  maxConsecutiveFailures: 3,
  maxNoProgressSteps: 3
};

