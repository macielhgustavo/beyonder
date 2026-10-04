import type { StateStore } from "../memory/state-store.js";
import type { TaskExecution } from "./contracts.js";
import { ToolSideEffect, type ToolDescriptor } from "@beyonder/tools";

export interface TaskCheckpointStore {
  save(execution: TaskExecution): Promise<void>;
  get(taskId: string): Promise<TaskExecution | undefined>;
  inspect(taskId: string): Promise<CheckpointLookup>;
  clear(taskId: string): Promise<void>;
}

export type CheckpointLookup =
  | { status: "CHECKPOINT_NOT_FOUND" }
  | { status: "CHECKPOINT_VALID"; execution: TaskExecution; savedAt: string }
  | { status: "CHECKPOINT_CORRUPT"; detail: string }
  | { status: "CHECKPOINT_VERSION_UNSUPPORTED"; version: unknown }
  | { status: "CHECKPOINT_IO_ERROR"; detail: string };

export class CheckpointReadError extends Error {
  constructor(readonly status: Exclude<CheckpointLookup["status"], "CHECKPOINT_NOT_FOUND" | "CHECKPOINT_VALID">, message: string) {
    super(message);
    this.name = "CheckpointReadError";
  }
}

const PREFIX = "task-checkpoint:";

export class StateTaskCheckpointStore implements TaskCheckpointStore {
  constructor(private readonly state: StateStore) {}

  async save(execution: TaskExecution): Promise<void> {
    await this.state.set(`${PREFIX}${execution.task.id}`, {
      version: 1,
      savedAt: new Date().toISOString(),
      execution
    });
  }

  async get(taskId: string): Promise<TaskExecution | undefined> {
    const result = await this.inspect(taskId);
    if (result.status === "CHECKPOINT_NOT_FOUND") return undefined;
    if (result.status === "CHECKPOINT_VALID") return result.execution;
    throw new CheckpointReadError(result.status, result.status === "CHECKPOINT_VERSION_UNSUPPORTED"
      ? `Checkpoint version is unsupported: ${String(result.version)}.`
      : result.detail);
  }

  async inspect(taskId: string): Promise<CheckpointLookup> {
    let raw: Awaited<ReturnType<StateStore["readRaw"]>>;
    try {
      raw = await this.state.readRaw(`${PREFIX}${taskId}`);
    } catch (error) {
      return { status: "CHECKPOINT_IO_ERROR", detail: error instanceof Error ? error.message : String(error) };
    }
    if (!raw.found) return { status: "CHECKPOINT_NOT_FOUND" };
    let payload: unknown;
    try {
      payload = JSON.parse(raw.value);
    } catch {
      return { status: "CHECKPOINT_CORRUPT", detail: "Checkpoint payload is not valid JSON." };
    }
    if (payload === null) return { status: "CHECKPOINT_NOT_FOUND" };
    if (!payload || typeof payload !== "object") return { status: "CHECKPOINT_CORRUPT", detail: "Checkpoint payload is not an object." };
    const candidate = payload as { version?: unknown; savedAt?: unknown };
    if (candidate.version !== 1) return { status: "CHECKPOINT_VERSION_UNSUPPORTED", version: candidate.version };
    if (!isCheckpointPayload(payload)) return { status: "CHECKPOINT_CORRUPT", detail: "Checkpoint payload failed structural validation." };
    return { status: "CHECKPOINT_VALID", execution: payload.execution, savedAt: typeof candidate.savedAt === "string" ? candidate.savedAt : "unknown" };
  }

  async clear(taskId: string): Promise<void> {
    await this.state.set(`${PREFIX}${taskId}`, null);
  }
}

function isCheckpointPayload(value: unknown): value is { version: 1; execution: TaskExecution } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { version?: unknown; execution?: unknown };
  if (candidate.version !== 1 || !candidate.execution || typeof candidate.execution !== "object") return false;
  const execution = candidate.execution as Partial<TaskExecution>;
  return typeof execution.id === "string" &&
    typeof execution.task?.id === "string" &&
    typeof execution.plan?.id === "string" &&
    Array.isArray(execution.plan.steps) &&
    Array.isArray(execution.checkpoints) &&
    Array.isArray(execution.steps) &&
    typeof execution.usage === "object";
}

export function findReconciliationRequired(execution: TaskExecution, availableTools: readonly ToolDescriptor[]) {
  for (const step of execution.steps) {
    if (step.status !== "RUNNING" || !step.toolCall || step.toolResult) continue;
    const descriptor = availableTools.find((tool) => tool.id === step.toolCall?.tool);
    const effects = step.toolSideEffects ?? descriptor?.sideEffects;
    if (!effects || effects.some((effect) => effect !== ToolSideEffect.READ && effect !== ToolSideEffect.NONE)) {
      return { stepId: step.stepId, tool: step.toolCall.tool, reason: "OUTCOME_UNKNOWN" as const };
    }
  }
  return undefined;
}
