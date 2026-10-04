import { createRuntime } from "@beyonder/runtime";
import { loadControlConfig } from "./commands";
export async function startHeartbeat() {
  const runtime = createRuntime(loadControlConfig());
  const ids = await runtime.state.get<string[]>("control-center:tasks:index", []);
  for (const id of ids) {
    const execution = await runtime.state.get<Record<string, unknown>>(`control-center:task:${id}`, {});
    if (["CREATED", "PLANNING", "READY", "RUNNING", "WAITING", "RECOVERING", "REPLANNING"].includes(String(execution.state))) {
      await runtime.state.set(`control-center:task:${id}`, { ...execution, state: "BLOCKED", completedAt: new Date().toISOString(), result: "A execução foi interrompida. Consulte os checkpoints de recuperação antes de iniciar novamente." });
    }
  }
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
