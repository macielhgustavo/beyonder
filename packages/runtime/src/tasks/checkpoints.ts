import type { StateStore } from "../memory/state-store.js";
import type { TaskExecution } from "./contracts.js";

export interface TaskCheckpointStore {
  save(execution: TaskExecution): Promise<void>;
  get(taskId: string): Promise<TaskExecution | undefined>;
  clear(taskId: string): Promise<void>;
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
    try {
      const payload = await this.state.get<unknown>(`${PREFIX}${taskId}`, undefined);
      if (!isCheckpointPayload(payload)) return undefined;
      return payload.execution;
    } catch {
      return undefined;
    }
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
