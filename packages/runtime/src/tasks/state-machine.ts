import type { TaskExecutionState } from "./contracts.js";

export class InvalidTaskStateTransitionError extends Error {
  constructor(readonly from: TaskExecutionState, readonly to: TaskExecutionState) {
    super(`Invalid task execution state transition: ${from} -> ${to}`);
    this.name = "InvalidTaskStateTransitionError";
  }
}

export const TERMINAL_TASK_STATES = new Set<TaskExecutionState>([
  "EXECUTION_FINISHED",
  "COMPLETED",
  "FAILED",
  "BLOCKED",
  "BUDGET_EXHAUSTED",
  "CANCELLED"
]);

const ALLOWED_TRANSITIONS: Record<TaskExecutionState, readonly TaskExecutionState[]> = {
  CREATED: ["PLANNING", "READY", "CANCELLED"],
  PLANNING: ["READY", "FAILED", "BLOCKED", "CANCELLED"],
  READY: ["RUNNING", "CANCELLED", "BUDGET_EXHAUSTED"],
  RUNNING: ["RUNNING", "WAITING", "RECOVERING", "REPLANNING", "EXECUTION_FINISHED", "COMPLETED", "FAILED", "BLOCKED", "BUDGET_EXHAUSTED", "CANCELLED"],
  WAITING: ["RUNNING", "BLOCKED", "CANCELLED"],
  RECOVERING: ["RUNNING", "REPLANNING", "FAILED", "BLOCKED", "BUDGET_EXHAUSTED", "CANCELLED"],
  REPLANNING: ["READY", "RUNNING", "FAILED", "BLOCKED", "BUDGET_EXHAUSTED", "CANCELLED"],
  EXECUTION_FINISHED: ["RECOVERING", "COMPLETED", "FAILED", "BLOCKED", "BUDGET_EXHAUSTED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  BLOCKED: [],
  BUDGET_EXHAUSTED: [],
  CANCELLED: []
};

export function canTransition(from: TaskExecutionState, to: TaskExecutionState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTaskStateTransition(from: TaskExecutionState, to: TaskExecutionState): void {
  if (!canTransition(from, to)) throw new InvalidTaskStateTransitionError(from, to);
}

export function isTerminalTaskState(state: TaskExecutionState): boolean {
  return TERMINAL_TASK_STATES.has(state);
}
