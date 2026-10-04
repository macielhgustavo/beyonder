import { redactSecrets } from "@beyonder/tools";
import type { BeyonderRuntime } from "../runtime.js";

export async function inspectTaskTrace(runtime: BeyonderRuntime, taskId: string) {
  const execution = await runtime.checkpoints.get(taskId);
  const attempts = await runtime.modelRouter.attemptsFor(taskId);
  const events = runtime.sqlite.prepare("SELECT event, details, created_at FROM audit_events WHERE json_extract(details, '$.taskId') = ? ORDER BY created_at LIMIT 1000").all(taskId).map((row) => { const event = row as { event: string; details: string; created_at: string }; return { ...event, details: JSON.parse(event.details) }; });
  const memory = (await runtime.memoryStore.all()).filter((record) => record.taskId === taskId);
  // Clone shared references: the redactor's cycle protection must not hide repeated
  // but non-circular plan/steps/attempt objects in the inspection read model.
  return redactSecrets(JSON.parse(JSON.stringify({ taskId, execution, plan: execution?.plan, steps: execution?.steps ?? [], attempts, routes: events.filter((event) => event.event.startsWith("router.")), toolCalls: execution?.steps.filter((step) => step.toolCall) ?? [], checkpoints: execution?.checkpoints ?? [], failure: execution?.failure ?? (execution?.state === "COMPLETED" ? undefined : attempts.filter((a) => a.status === "FAILED").at(-1)), memory, events })));
}
