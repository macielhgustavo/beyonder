import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

// Only the producer is controlled. Judges are actual zero-money cloud models.
// This opt-in network test never substitutes fixtures for live acceptance.
const repo = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const require = createRequire(path.join(repo, "packages/runtime/package.json"));
const Database = require("better-sqlite3");
const output = path.resolve(process.env.LIVE_VERIFIER_DIR ?? "/tmp/beyonder-live-verifier");
const port = process.env.LIVE_VERIFIER_PORT ?? "4196";
const base = `http://127.0.0.1:${port}`;
const cases = JSON.parse(await fs.readFile(new URL("live-verifier-cases.json", import.meta.url), "utf8"));
await fs.mkdir(output, { recursive: true });
const dbPath = path.join(output, "runtime.sqlite");
try {
  await fs.access(dbPath);
  throw new Error("Use a fresh LIVE_VERIFIER_DIR: synthetic producer state must remain isolated.");
} catch (error) { if (error.code !== "ENOENT") throw error; }
const providerPath = path.resolve(process.env.BEYONDER_PROVIDER_STATE_PATH ?? path.join(repo, ".providers-vault/autopilot-state.json"));
const benchmarkPath = path.resolve(process.env.BEYONDER_BENCHMARK_DB_PATH ?? path.join(repo, "data/beyonder-benchmark.sqlite"));
const isolatedProviders = path.join(output, "providers.json");
await fs.copyFile(providerPath, isolatedProviders);
const scenario = path.join(output, "scenario.json");
await fs.writeFile(scenario, JSON.stringify(cases[0]));
const log = await fs.open(path.join(output, "supervisor.log"), "a");
const server = spawn(process.execPath, ["apps/dashboard/bin/launch-control-center.mjs", "--supervise"], {
  cwd: repo, stdio: ["ignore", log.fd, log.fd],
  env: {
    ...process.env,
    NODE_OPTIONS: `--import ${fileURLToPath(new URL("live-bad-producer-preload.mjs", import.meta.url))}`,
    LIVE_BAD_PRODUCER_SCENARIO: scenario,
    BEYONDER_REPO_ROOT: repo, BEYONDER_MODEL_PROVIDER: "auto", BEYONDER_CONTROL_FIXTURE: "0",
    BEYONDER_DB_PATH: dbPath, BEYONDER_PROVIDER_STATE_PATH: isolatedProviders,
    BEYONDER_BENCHMARK_DB_PATH: benchmarkPath, BEYONDER_CONTROL_PORT: port,
    BEYONDER_CONTROL_RUNTIME_DIR: path.join(output, "supervisor"), BEYONDER_CONTROL_NO_OPEN: "1"
  }
});
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const report = { controlledProducer: true, syntheticProductionPerformance: false, realIndependentVerifier: true, fixture: false, cases: [] };
const save = () => fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
function suppressControlledProducerGrades() {
  const db = new Database(dbPath);
  try {
    for (const row of db.prepare("select id,metadata from memories where kind='economic'").all()) {
      const metadata = { ...JSON.parse(row.metadata), qualityEvaluated: false, controlledProducer: true };
      db.prepare("update memories set metadata=? where id=?").run(JSON.stringify(metadata), row.id);
    }
  } finally { db.close(); }
}
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { await page.goto(base); ready = true; break; } catch { await page.waitForTimeout(500); }
  }
  if (!ready) throw new Error("Production supervisor did not become available.");
  const onboarding = page.locator('[data-command="completeFirstRun"]');
  if (await onboarding.count()) await onboarding.click();
  for (const test of cases) {
    await fs.writeFile(scenario, JSON.stringify(test));
    await page.goto(base);
    await page.locator("#objective").fill(test.objective);
    const queuedResponse = page.waitForResponse(response => response.url().endsWith("/api/control/command") && response.request().method() === "POST");
    await page.locator('.objective-box button[type="submit"]').click();
    const queued = await (await queuedResponse).json();
    if (!queued.ok || !queued.taskId) throw new Error("Objective was not persisted.");
    let mission;
    for (let i = 0; i < 360; i++) {
      const payload = await (await page.request.get(`${base}/api/control/missions/${queued.taskId}`)).json();
      if (payload.mission?.completedAt && payload.mission.objectiveStatus && payload.mission.executionPhase !== "EXECUTING") { mission = payload.mission; break; }
      await page.waitForTimeout(500);
    }
    if (mission) await page.waitForFunction(({ id, status }) => document.querySelector(`.command-mission [data-mission-id="${id}"]`)?.getAttribute("data-state") === status, { id: queued.taskId, status: mission.status });
    suppressControlledProducerGrades();
    const verifierAttempts = mission?.attempts?.filter(attempt => attempt.phase === "OBJECTIVE_VERIFICATION") ?? [];
    const capacityBlocked = mission?.objectiveStatus === "NEEDS_CAPABILITY";
    const safetyPass = Boolean(mission && !mission.resultVerified && mission.objectiveStatus !== "SUCCEEDED");
    const semanticRejectionPass = safetyPass && !capacityBlocked && verifierAttempts.some(attempt => attempt.status === "SUCCEEDED" && attempt.attribution?.reportedModel);
    report.cases.push({ ...test, taskId: queued.taskId, mission, verifierAttempts, capacityBlocked, safetyPass, semanticRejectionPass });
    await save();
    console.log(test.name, mission?.objectiveStatus, { safetyPass, semanticRejectionPass });
  }
  report.safetyPass = report.cases.length === cases.length && report.cases.every(test => test.safetyPass);
  report.pass = report.safetyPass && report.cases.every(test => test.semanticRejectionPass);
  if (!report.pass) process.exitCode = 1;
} finally {
  await browser.close();
  if (server.exitCode === null && server.signalCode === null) {
    const exited = new Promise(resolve => server.once("exit", resolve));
    server.kill("SIGTERM");
    await exited;
  }
  await log.close();
  // Suppress every controlled producer grade, including an interrupted case.
  // No write is made to the installation's runtime, provider state or BIB.
  try {
    suppressControlledProducerGrades();
  } finally { await save(); }
}
