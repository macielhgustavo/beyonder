import { analyzeGoalContract } from "../intelligence/goal-contract.js";
import type { CompletionEvaluation } from "../tasks/completion.js";
import { browserEvidence } from "../tasks/browser-evidence.js";
import type { AutonomousTaskOutcome, TaskExecution } from "../tasks/contracts.js";

export interface ProductMissionMetrics {
  mission_success_rate: 0 | 1;
  objective_verified_rate: 0 | 1;
  false_success_rate: 0 | 1;
  recovery_attempted: boolean;
  recovery_success_rate: 0 | 1 | null;
  freshness_routing_accuracy: 0 | 1;
  tool_selection_accuracy: 0 | 1;
  evidence_coverage: number;
  provider_failure_recovery: 0 | 1 | null;
  time_to_result_ms: number;
  shadow_cost_per_success: number | null;
  user_intervention_rate: 0 | 1;
}

/** One persisted observation per mission; aggregation belongs to reporting, not execution. */
export function productMissionMetrics(input: {
  execution: TaskExecution;
  outcome: AutonomousTaskOutcome;
  evaluation: CompletionEvaluation;
  recoveryAttempted: boolean;
}): ProductMissionMetrics {
  const { execution, outcome, evaluation } = input;
  const contract = execution.task.goalContract ?? analyzeGoalContract(execution.task.input, execution.task.type);
  const evidence = browserEvidence(execution.steps);
  const evidenceRequired = Math.max(0, contract.minimumEvidenceSources);
  const browserRequired = contract.evidenceRequirement === "REQUIRED" || execution.task.requirements.browser === true;
  const calculatorRequired = execution.task.requirements.calculator === true;
  const browserRan = evidence.sources.length > 0;
  const calculatorRan = execution.steps.some((step) => step.toolCall?.tool === "calculator" && step.toolResult?.success);
  const requiredToolsSatisfied = (!browserRequired || browserRan) && (!calculatorRequired || calculatorRan);
  const operationalFailure = (execution.attempts ?? []).some((attempt) => attempt.status === "FAILED" && ["AUTH_REQUIRED", "FORBIDDEN", "MODEL_UNAVAILABLE", "RATE_LIMITED", "PROVIDER_UNAVAILABLE", "TIMEOUT", "NETWORK_ERROR"].includes(attempt.failureClass ?? ""));
  const verified = evaluation.taskCompleted;
  const userFacingSuccess = outcome.status === "COMPLETED" && outcome.success;
  return {
    mission_success_rate: userFacingSuccess ? 1 : 0,
    objective_verified_rate: verified ? 1 : 0,
    false_success_rate: userFacingSuccess && !verified ? 1 : 0,
    recovery_attempted: input.recoveryAttempted,
    recovery_success_rate: input.recoveryAttempted ? verified ? 1 : 0 : null,
    freshness_routing_accuracy: ["CURRENT", "REALTIME"].includes(contract.freshness) ? browserRequired ? 1 : 0 : 1,
    tool_selection_accuracy: requiredToolsSatisfied ? 1 : 0,
    evidence_coverage: evidenceRequired ? Math.min(1, evidence.sources.length / evidenceRequired) : 1,
    provider_failure_recovery: operationalFailure ? verified ? 1 : 0 : null,
    time_to_result_ms: execution.usage.durationMs,
    shadow_cost_per_success: verified ? execution.usage.shadowCostUsd : null,
    user_intervention_rate: ["NEEDS_INPUT", "RECONCILIATION_REQUIRED"].includes(evaluation.objectiveStatus) ? 1 : 0
  };
}
