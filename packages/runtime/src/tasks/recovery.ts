import type { ToolErrorCode } from "@beyonder/tools";
import type { PlanStep, TaskBudgetUsage } from "./contracts.js";

export type RecoveryDecisionType =
  | "RETRY"
  | "CHANGE_TOOL"
  | "CHANGE_MODEL"
  | "REFORMULATE_ACTION"
  | "REPLAN"
  | "BLOCK"
  | "FAIL";

export interface RecoveryRequest {
  step: PlanStep;
  failure: {
    code?: ToolErrorCode | string;
    message: string;
  };
  attemptCount: number;
  previousObservations: string[];
  remainingBudget: TaskBudgetUsage;
}

export interface RecoveryDecision {
  type: RecoveryDecisionType;
  reason: string;
}

export interface RecoveryPolicy {
  decide(request: RecoveryRequest): RecoveryDecision;
}

export class DefaultRecoveryPolicy implements RecoveryPolicy {
  decide(request: RecoveryRequest): RecoveryDecision {
    if (request.failure.code === "POLICY_DENIED") {
      return { type: "BLOCK", reason: "Policy denied the action; recovery must not bypass policy." };
    }
    if (request.remainingBudget.retries <= 0) {
      return { type: "FAIL", reason: "Retry budget is exhausted." };
    }
    if (request.failure.code === "TIMEOUT" || request.failure.code === "UNAVAILABLE") {
      return { type: "RETRY", reason: `${request.failure.code} can be temporary.` };
    }
    if (request.failure.code === "EXECUTION_ERROR" && request.attemptCount === 1) {
      return { type: "RETRY", reason: "First execution error may be transient." };
    }
    if (request.failure.code === "INVALID_ARGUMENTS") {
      return request.remainingBudget.replans > 0
        ? { type: "REPLAN", reason: "Invalid tool arguments require a revised plan/action." }
        : { type: "FAIL", reason: "Invalid arguments and no replan budget remains." };
    }
    if (request.failure.code === "TOOL_NOT_FOUND") {
      return request.remainingBudget.replans > 0
        ? { type: "REPLAN", reason: "Selected tool is unavailable; replan within available capabilities." }
        : { type: "FAIL", reason: "Selected tool is unavailable and no replan budget remains." };
    }
    return { type: "FAIL", reason: "Failure is not retryable under the default recovery policy." };
  }
}

