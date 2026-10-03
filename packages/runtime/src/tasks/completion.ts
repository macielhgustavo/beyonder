import type { AutonomousTaskOutcome, TaskExecution } from "./contracts.js";

export type CompletionEvaluationStatus = "PASS" | "FAIL" | "BLOCKED" | "BUDGET_EXHAUSTED" | "CANCELLED";

export interface CompletionCriteria {
  expectedText?: string;
  expectedJsonField?: {
    path: string[];
    equals: unknown;
  };
}

export interface CompletionEvaluation {
  status: CompletionEvaluationStatus;
  taskCompleted: boolean;
  method: string;
  confidence: number;
  reason: string;
}

export interface CompletionEvaluator {
  evaluate(execution: TaskExecution, criteria?: CompletionCriteria): CompletionEvaluation;
}

export class DeterministicCompletionEvaluator implements CompletionEvaluator {
  evaluate(execution: TaskExecution, criteria: CompletionCriteria = {}): CompletionEvaluation {
    if (execution.state === "BLOCKED") return terminal("BLOCKED", "Task was blocked by policy or dependencies.");
    if (execution.state === "BUDGET_EXHAUSTED") return terminal("BUDGET_EXHAUSTED", "Task exhausted an explicit budget.");
    if (execution.state === "CANCELLED") return terminal("CANCELLED", "Task was cancelled.");
    if (execution.state !== "COMPLETED") return fail("Task is not in COMPLETED state.");

    const result = execution.result ?? execution.steps.at(-1)?.observationSummary ?? "";
    if (criteria.expectedText !== undefined && !result.includes(criteria.expectedText)) {
      return fail(`Expected text '${criteria.expectedText}' was not found.`);
    }
    if (criteria.expectedJsonField) {
      const parsed = parseJson(result);
      const actual = parsed.ok ? getPath(parsed.value, criteria.expectedJsonField.path) : undefined;
      if (!Object.is(actual, criteria.expectedJsonField.equals)) {
        return fail(`Expected JSON field ${criteria.expectedJsonField.path.join(".")} did not match.`);
      }
    }

    return {
      status: "PASS",
      taskCompleted: true,
      method: criteria.expectedText || criteria.expectedJsonField ? "deterministic-criteria" : "terminal-state",
      confidence: 1,
      reason: "Completion criteria passed."
    };
  }
}

export function outcomeWithCompletion(outcome: AutonomousTaskOutcome, evaluation: CompletionEvaluation): AutonomousTaskOutcome {
  if (evaluation.taskCompleted === outcome.success) return outcome;
  outcome.success = evaluation.taskCompleted;
  if (!evaluation.taskCompleted && outcome.status === "COMPLETED") {
    outcome.status = "FAILED";
    outcome.failureReason = evaluation.reason;
    outcome.execution.state = "FAILED";
    outcome.execution.error = evaluation.reason;
  }
  return outcome;
}

function terminal(status: CompletionEvaluationStatus, reason: string): CompletionEvaluation {
  return { status, taskCompleted: false, method: "terminal-state", confidence: 1, reason };
}

function fail(reason: string): CompletionEvaluation {
  return { status: "FAIL", taskCompleted: false, method: "deterministic-criteria", confidence: 1, reason };
}

function parseJson(input: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(input) as unknown };
  } catch {
    return { ok: false };
  }
}

function getPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

