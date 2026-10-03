import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runControlCommand } from "../control/commands";
import { LocalDashboardDataSource } from "../data/local";

const dir = mkdtempSync(path.join(tmpdir(), "beyonder-control-smoke-"));
process.env.BEYONDER_DB_PATH = path.join(dir, "runtime.sqlite");
process.env.BEYONDER_PROVIDER_STATE_PATH = path.join(dir, "providers.json");
process.env.BEYONDER_MODEL_PROVIDER = "none";

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
try {
  await runControlCommand({ type: "submitObjective", objective: "Verifique se o Control Center consegue executar uma tarefa fixture." });
  let source = new LocalDashboardDataSource(process.env.BEYONDER_DB_PATH, process.env.BEYONDER_PROVIDER_STATE_PATH);
  let tasks = await source.getTasks();
  assert(tasks.length === 1 && tasks[0].status === "succeeded", "task should complete");

  await runControlCommand({ type: "discoverOpportunities", fixture: true });
  source = new LocalDashboardDataSource(process.env.BEYONDER_DB_PATH, process.env.BEYONDER_PROVIDER_STATE_PATH);
  const opportunities = await source.getOpportunities();
  assert(opportunities.length >= 1, "fixture opportunity should appear");

  await runControlCommand({ type: "prepareApplication", opportunityId: opportunities[0].technicalId! });
  source = new LocalDashboardDataSource(process.env.BEYONDER_DB_PATH, process.env.BEYONDER_PROVIDER_STATE_PATH);
  let approvals = await source.getApprovals();
  assert(approvals.some((approval) => approval.status === "PENDING"), "approval should be pending");

  const pending = approvals.find((approval) => approval.status === "PENDING")!;
  await runControlCommand({ type: "approveAction", approvalId: pending.technicalId! });
  source = new LocalDashboardDataSource(process.env.BEYONDER_DB_PATH, process.env.BEYONDER_PROVIDER_STATE_PATH);
  approvals = await source.getApprovals();
  assert(approvals.some((approval) => approval.status === "CONSUMED"), "approval should be single-use consumed");

  await runControlCommand({ type: "pauseRuntime" });
  let denied = false;
  try {
    await runControlCommand({ type: "submitObjective", objective: "This should not start while paused." });
  } catch {
    denied = true;
  }
  assert(denied, "pause must block new work");
  await runControlCommand({ type: "resumeRuntime" });

  source = new LocalDashboardDataSource(process.env.BEYONDER_DB_PATH, process.env.BEYONDER_PROVIDER_STATE_PATH);
  const audit = await source.getAuditEvents();
  assert(audit.some((event) => event.event === "approval.consumed"), "audit should contain consumed approval");

  const result = {
    status: "PASS",
    tasks: tasks.length,
    opportunities: opportunities.length,
    approvals: approvals.length,
    monetaryCostUsd: 0
  };
  console.log(JSON.stringify(result, null, 2));
} finally {
  new Database(process.env.BEYONDER_DB_PATH).close();
  rmSync(dir, { recursive: true, force: true });
}
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
