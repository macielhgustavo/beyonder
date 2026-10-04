import { createRuntime } from "@beyonder/runtime";
import { loadControlConfig } from "./commands";
export async function startHeartbeat() {
  const runtime = createRuntime(loadControlConfig());
  await markInterruptedTasks(runtime);
  const key = "control-center:state";
  const current = await runtime.state.get<Record<string, unknown>>(key, {});
  await runtime.state.set(key, { ...current, paused: current.safeShutdownRequestedAt ? false : current.paused, safeShutdownRequestedAt: undefined, currentActivity: null, lastHeartbeatAt: new Date().toISOString() });
  const timer = setInterval(async () => {
    await runtime.state.update<Record<string, unknown>>(key, {}, (state) => ({ ...state, lastHeartbeatAt: new Date().toISOString() }));
  }, 2000);
  timer.unref();
  const close = () => { clearInterval(timer); if (runtime.sqlite.open) runtime.sqlite.close(); };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}

export async function markInterruptedTasks(runtime: ReturnType<typeof createRuntime>) {
  const ids = await runtime.state.get<string[]>("control-center:tasks:index", []);
  for (const id of ids) {
    const execution = await runtime.state.get<Record<string, unknown>>(`control-center:task:${id}`, {});
    if (["CREATED", "PLANNING", "READY", "RUNNING", "WAITING", "RECOVERING", "REPLANNING"].includes(String(execution.state))) {
      const task = execution.task && typeof execution.task === "object" ? execution.task as Record<string, unknown> : {};
      const taskId = typeof task.id === "string" ? task.id : "";
      const checkpoint = taskId ? await runtime.checkpoints.get(taskId) : undefined;
      if (checkpoint && ["COMPLETED", "FAILED", "BLOCKED", "BUDGET_EXHAUSTED", "CANCELLED"].includes(checkpoint.state)) {
        await runtime.state.set(`control-center:task:${id}`, { ...checkpoint, fixture: execution.fixture === true });
      } else if (checkpoint) {
        await runtime.state.set(`control-center:task:${id}`, { ...checkpoint, state: "WAITING", fixture: execution.fixture === true, interruptionReason: "PROCESS_RESTART" });
      } else {
        const { completedAt: _completedAt, result: _result, ...persisted } = execution;
        await runtime.state.set(`control-center:task:${id}`, { ...persisted, state: "BLOCKED", interruptionReason: "PROCESS_RESTART_NO_CHECKPOINT" });
      }
    }
  }
}
