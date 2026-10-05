import type { ObjectiveOutcomeStatus } from "../intelligence/contracts.js";
import { analyzeGoalContract } from "../intelligence/goal-contract.js";
import type { AutonomousTaskOutcome, TaskExecution } from "./contracts.js";
import { browserEvidence } from "./browser-evidence.js";

export type CompletionEvaluationStatus = "PASS" | "FAIL" | "BLOCKED" | "BUDGET_EXHAUSTED" | "CANCELLED";
export type RecoveryRecommendation = "NONE" | "ACQUIRE_EVIDENCE" | "RETRY_SYNTHESIS" | "ALTERNATE_MODEL" | "REQUEST_INPUT" | "ENABLE_CAPABILITY" | "RECONCILE";

export interface CompletionCriteria {
  expectedText?: string;
  expectedJsonField?: { path: string[]; equals: unknown };
}

export interface ObjectiveVerificationDimension {
  name: "execution" | "result" | "evidence" | "format" | "relevance" | "completeness" | "consistency";
  passed: boolean;
  reason: string;
}

export interface CompletionEvaluation {
  status: CompletionEvaluationStatus;
  objectiveStatus: ObjectiveOutcomeStatus;
  taskCompleted: boolean;
  method: string;
  confidence: number;
  reason: string;
  dimensions: ObjectiveVerificationDimension[];
  missingRequirements: string[];
  recoveryRecommendation: RecoveryRecommendation;
}

export interface CompletionEvaluator {
  evaluate(execution: TaskExecution, criteria?: CompletionCriteria): CompletionEvaluation | Promise<CompletionEvaluation>;
}

/** Deterministic objective invariants. It never treats terminal execution alone as success. */
export class ObjectiveVerifier implements CompletionEvaluator {
  evaluate(execution: TaskExecution, criteria: CompletionCriteria = {}): CompletionEvaluation {
    if (execution.failure?.failureClass === "NEEDS_CAPABILITY" || execution.objectiveStatus === "NEEDS_CAPABILITY") {
      return terminal(
        "BLOCKED",
        "NEEDS_CAPABILITY",
        execution.error ?? "Adequate models for this mission are unavailable. Available compute is below the required quality floor.",
        "ENABLE_CAPABILITY"
      );
    }
    if (execution.state === "BLOCKED") return terminal("BLOCKED", execution.reconciliationRequired ? "RECONCILIATION_REQUIRED" : "BLOCKED", execution.error ?? "Task was blocked by policy or dependencies.", execution.reconciliationRequired ? "RECONCILE" : "NONE");
    if (execution.state === "BUDGET_EXHAUSTED") return terminal("BUDGET_EXHAUSTED", "FAILED", "Task exhausted an explicit budget.");
    if (execution.state === "CANCELLED") return terminal("CANCELLED", "FAILED", "Task was cancelled.");
    if (!["EXECUTION_FINISHED", "COMPLETED"].includes(execution.state)) return fail("Execution has not finished.", "FAILED", ["execution-finished"], "NONE");

    const contract = execution.task.goalContract ?? analyzeGoalContract(execution.task.input, execution.task.type);
    if (contract.clarificationRequired) return fail("The objective needs material clarification before useful work can continue.", "NEEDS_INPUT", ["operator-clarification"], "REQUEST_INPUT");

    const evidence = browserEvidence(execution.steps);
    const browserRequired = execution.task.requirements.browser || execution.task.requirements.tools?.includes("browser") || contract.evidenceRequirement === "REQUIRED";
    if (browserRequired && evidence.sources.length < Math.max(1, contract.minimumEvidenceSources)) {
      return fail(`Current external evidence is incomplete: ${evidence.sources.length}/${Math.max(1, contract.minimumEvidenceSources)} required source(s).`, "NEEDS_CAPABILITY", ["external-evidence"], evidence.sources.length ? "ACQUIRE_EVIDENCE" : "ENABLE_CAPABILITY");
    }
    if (execution.task.requirements.calculator && !execution.steps.some((step) => step.toolCall?.tool === "calculator" && step.toolResult?.success)) {
      return fail("Required calculator execution evidence is missing.", "NEEDS_CAPABILITY", ["calculator-evidence"], "ENABLE_CAPABILITY");
    }

    const result = execution.result ?? execution.steps.at(-1)?.observationSummary ?? "";
    if (!result.trim()) return fail("The execution produced no user-facing result.", "FAILED", ["non-empty-result"], "RETRY_SYNTHESIS");
    if (isObviousNonAnswer(result)) return fail("The result is a refusal or limitation, not an answer to the objective.", "FAILED", ["objective-answer"], browserRequired && evidence.sources.length ? "ALTERNATE_MODEL" : browserRequired ? "ACQUIRE_EVIDENCE" : "ALTERNATE_MODEL");

    if (criteria.expectedText !== undefined && !result.includes(criteria.expectedText)) return fail(`Expected text '${criteria.expectedText}' was not found.`, "FAILED", ["expected-text"], "RETRY_SYNTHESIS");
    if (criteria.expectedJsonField) {
      const parsed = parseJson(result);
      const actual = parsed.ok ? getPath(parsed.value, criteria.expectedJsonField.path) : undefined;
      if (!Object.is(actual, criteria.expectedJsonField.equals)) return fail(`Expected JSON field ${criteria.expectedJsonField.path.join(".")} did not match.`, "FAILED", ["structured-output"], "RETRY_SYNTHESIS");
    }

    return {
      status: "PASS",
      objectiveStatus: "SUCCEEDED",
      taskCompleted: true,
      method: criteria.expectedText || criteria.expectedJsonField ? "objective-deterministic-criteria" : "objective-deterministic-invariants",
      confidence: browserRequired || execution.task.requirements.calculator ? 0.9 : 0.72,
      reason: "Deterministic objective invariants passed.",
      dimensions: [
        { name: "execution", passed: true, reason: "Execution finished." },
        { name: "result", passed: true, reason: "A non-empty, non-refusal result exists." },
        { name: "evidence", passed: true, reason: browserRequired ? `${evidence.sources.length} required external source(s) observed.` : "No mandatory external evidence." },
        { name: "format", passed: true, reason: "Requested deterministic format checks passed." }
      ],
      missingRequirements: [],
      recoveryRecommendation: "NONE"
    };
  }
}

/** Compatibility name retained for callers; semantics are objective-based now. */
export class DeterministicCompletionEvaluator extends ObjectiveVerifier {}

export function outcomeWithCompletion(outcome: AutonomousTaskOutcome, evaluation: CompletionEvaluation): AutonomousTaskOutcome {
  outcome.objectiveStatus = evaluation.objectiveStatus;
  outcome.execution.objectiveStatus = evaluation.objectiveStatus;
  outcome.execution.objectiveVerification = evaluation;
  outcome.execution.executionPhase = evaluation.taskCompleted ? "OBJECTIVE_VERIFIED" : "EXECUTION_FINISHED";
  outcome.success = evaluation.taskCompleted;
  const blocked = ["NEEDS_CAPABILITY", "NEEDS_INPUT", "BLOCKED", "RECONCILIATION_REQUIRED"].includes(evaluation.objectiveStatus);
  if (!evaluation.taskCompleted && blocked) {
    outcome.status = "BLOCKED";
    outcome.execution.state = "BLOCKED";
    outcome.execution.error = evaluation.reason;
    outcome.failureReason = evaluation.reason;
  } else if (!evaluation.taskCompleted && ["COMPLETED", "EXECUTION_FINISHED"].includes(outcome.execution.state)) {
    outcome.status = "FAILED";
    outcome.execution.state = "FAILED";
    outcome.execution.error = evaluation.reason;
    outcome.failureReason = evaluation.reason;
  } else if (evaluation.taskCompleted) {
    outcome.status = "COMPLETED";
    outcome.execution.state = "COMPLETED";
  }
  return outcome;
}

export function isObviousNonAnswer(result: string): boolean {
  const folded = result.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const patterns = [
    /^(?:desculpe[, ]*)?(?:eu )?(?:nao sei|nao tenho (?:acesso|informacoes)|nao consigo|sou incapaz|nao posso determinar)/,
    /^(?:sorry[, ]*)?(?:i )?(?:do not know|don't know|cannot|can't|am unable|have no (?:access|information))\b/,
    /^(?:as an ai|como (?:uma )?ia)\b/,
    /(?:pesquise|procure|search) (?:na web|the web|voce mesmo|yourself)/
  ];
  return patterns.some((pattern) => pattern.test(folded));
}

function terminal(status: CompletionEvaluationStatus, objectiveStatus: ObjectiveOutcomeStatus, reason: string, recommendation: RecoveryRecommendation = "NONE"): CompletionEvaluation {
  return { status, objectiveStatus, taskCompleted: false, method: "objective-terminal-state", confidence: 1, reason, dimensions: [{ name: "execution", passed: false, reason }], missingRequirements: ["successful-execution"], recoveryRecommendation: recommendation };
}

function fail(reason: string, objectiveStatus: ObjectiveOutcomeStatus, missingRequirements: string[], recommendation: RecoveryRecommendation): CompletionEvaluation {
  return { status: "FAIL", objectiveStatus, taskCompleted: false, method: "objective-deterministic-invariants", confidence: 1, reason, dimensions: [{ name: "result", passed: false, reason }], missingRequirements, recoveryRecommendation: recommendation };
}

function parseJson(input: string): { ok: true; value: unknown } | { ok: false } {
  try { return { ok: true, value: JSON.parse(input) as unknown }; } catch { return { ok: false }; }
}

function getPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
