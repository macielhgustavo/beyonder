import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
const dir = mkdtempSync(join(tmpdir(), "beyonder-supervisor-test-"));
const launcher = fileURLToPath(new URL("../bin/launch-control-center.mjs", import.meta.url));
const port = await availablePort();
const url = `http://127.0.0.1:${port}`;
const env = { ...process.env, BEYONDER_CONTROL_PORT: String(port), BEYONDER_CONTROL_RUNTIME_DIR: dir, BEYONDER_DB_PATH: join(dir, "runtime.sqlite"), BEYONDER_PROVIDER_STATE_PATH: join(dir, "providers.json"), BEYONDER_CONTROL_NO_OPEN: "1", BEYONDER_CONTROL_FIXTURE: "1", BEYONDER_MODEL_PROVIDER: "none" };
async function availablePort() {
  const server = createServer();
  await new Promise((accept, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", accept); });
  const address = server.address();
  await new Promise((accept) => server.close(accept));
  if (!address || typeof address === "string") throw new Error("Could not allocate a supervisor test port");
  return address.port;
}
function launch() { return new Promise((accept, reject) => { let output = ""; const child = spawn(process.execPath, [launcher], { env, stdio: ["ignore", "pipe", "pipe"] }); child.stdout.on("data", (data) => output += data); child.stderr.on("data", (data) => output += data); child.once("error", reject); child.once("exit", (code) => accept({ code, output })); }); }
async function command(body) { const response = await fetch(`${url}/api/control/command`, { method: "POST", headers: { "content-type": "application/json", origin: url }, body: JSON.stringify(body) }); return response.json(); }
async function health() { try { return await (await fetch(`${url}/api/control/health`, { signal: AbortSignal.timeout(1000) })).json(); } catch { return null; } }
async function completedMission(taskId) {
  for (let i = 0; i < 60; i++) {
    const response = await fetch(`${url}/api/control/missions/${encodeURIComponent(taskId)}`);
    const payload = await response.json();
    if (payload.mission && ["succeeded", "failed", "blocked", "cancelled"].includes(payload.mission.status)) return payload.mission;
    await delay(250);
  }
  throw new Error(`Mission ${taskId} did not reach a terminal state`);
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function assertVerifiedMission(mission, taskId, objective) {
  assert(mission && mission.taskId === taskId && mission.title === objective, "Result must belong to the submitted mission");
  assert(mission.status === "succeeded" && mission.objectiveStatus === "SUCCEEDED" && mission.executionPhase === "OBJECTIVE_VERIFIED" && mission.resultVerified === true && mission.completedAt, `Mission must finish objective verification: ${JSON.stringify(mission)}`);
  assert(mission.result === "Objetivo registrado no modo de teste." && mission.fixture === true, "Expected deterministic fixture result, not a semantic model answer");
  assert(mission.steps.some((step) => step.state === "complete") && mission.attempts.some((attempt) => attempt.phase === "TOOL_EXECUTION" && attempt.status === "SUCCEEDED"), "Persisted execution evidence must exist");
}
async function assertMissionCard(card, mission, compact = false) {
  await card.locator(':scope[data-state="succeeded"][data-objective-status="SUCCEEDED"][data-execution-phase="OBJECTIVE_VERIFIED"][data-result-verified="true"]').waitFor();
  assert(await card.locator("h2").innerText() === mission.title, "UI must show the submitted objective");
  if (compact) {
    // Home's recent list intentionally shows an outcome summary, with full result in detail.
    assert(await card.getByRole("link", { name: "Abrir missão", exact: true }).getAttribute("href") === `/missions/${mission.taskId}`, "Home must retain a link to the persisted verified result");
  } else {
    const result = card.getByRole("region", { name: "Resultado verificado", exact: true }).locator("p");
    await result.waitFor({ state: "visible" });
    assert(await result.innerText() === mission.result, "UI must show the actual persisted verified result");
  }
}
async function stopped() { for (let i = 0; i < 60; i++) { if (!(await health()) && !existsSync(join(dir, "supervisor.pid"))) return; await delay(500); } throw new Error("Safe shutdown did not exit or left a stale PID"); }
let collision;
let browser;
let page;
let browserMission;
const browserObjective = "Objetivo pelo navegador de teste";
try {
  collision = createServer((socket) => socket.destroy());
  await new Promise((accept, reject) => { collision.once("error", reject); collision.listen(port, "127.0.0.1", accept); });
  let result = await launch(); assert(result.code !== 0 && result.output.includes(String(port)), "Port collision must fail clearly"); assert(collision.listening, "Existing process must survive collision");
  await new Promise((accept) => collision.close(accept)); collision = null;
  writeFileSync(join(dir, "supervisor.pid"), JSON.stringify({ pid: process.pid }));
  result = await launch(); assert(result.code === 0, result.output);
  const first = await health(); assert(first?.service === "beyonder-control-center" && first.status.global === "READY", "Runtime heartbeat must report READY");
  result = await launch(); assert(result.code === 0, "Duplicate launch should reuse the process"); assert((await health()).pid === first.pid, "Duplicate must not create another server");
  const objectiveResult = await command({ type: "submitObjective", objective: "Execute deterministic objective" });
  assert(objectiveResult.status === "PLANNING" && objectiveResult.taskId, `Fixture objective must be durably queued: ${JSON.stringify(objectiveResult)}`);
  assert((await completedMission(objectiveResult.taskId)).status === "succeeded", "Fixture objective must complete asynchronously");
  const tasksHtml = await (await fetch(`${url}/missions`)).text(); assert(tasksHtml.includes("Execute deterministic objective") && tasksHtml.includes("TEST DATA"), "Result and fixture badge must be visible");
  assert((await command({ type: "discoverOpportunities" })).count > 0, "Fixture discovery");
  assert((await command({ type: "pauseRuntime" })).ok, "Pause"); assert(!(await command({ type: "submitObjective", objective: "Paused work must be rejected" })).ok, "Paused objective must fail");
  assert((await command({ type: "resumeRuntime" })).ok, "Resume"); const resumed = await command({ type: "submitObjective", objective: "Resumed work executes" }); assert(resumed.ok && (await completedMission(resumed.taskId)).status === "succeeded", "Resumed work must execute");
  const { chromium } = createRequire(new URL("../../../packages/browser-agent/package.json", import.meta.url))("playwright");
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  // A transient missed update must recover through the real polling lifecycle.
  let missedPoll = false;
  await page.route("**/api/control/missions/*", async (route) => {
    if (!missedPoll) { missedPoll = true; await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) }); }
    else await route.continue();
  });
  await page.locator("#objective").fill(browserObjective);
  const submitted = page.waitForResponse((response) => response.url().endsWith("/api/control/command") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Iniciar missão", exact: true }).click();
  const queued = await (await submitted).json();
  assert(queued.ok && queued.status === "PLANNING" && queued.taskId, "Browser objective must be durably queued");
  browserMission = await completedMission(queued.taskId);
  assertVerifiedMission(browserMission, queued.taskId, browserObjective);
  const missionSelector = `[data-mission-id="${queued.taskId}"]`;
  // No navigation or manual refresh may deliver the initial result to Command.
  await assertMissionCard(page.getByRole("region", { name: "Command Beyonder", exact: true }).locator(missionSelector), browserMission);
  assert(missedPoll, "Polling recovery must be exercised");
  assert((await health())?.pid === first.pid, "Supervisor must stay alive through execution and verification");
  const home = await (await fetch(`${url}/api/control/overview`)).json();
  assertVerifiedMission(home.recentMissions.find((mission) => mission.taskId === queued.taskId), queued.taskId, browserObjective);
  await page.reload();
  await assertMissionCard(page.locator(".home-recent").locator(missionSelector), browserMission, true);
  await page.goto(`${url}/missions`);
  await assertMissionCard(page.locator(".mission-list").locator(missionSelector), browserMission);
  await page.goto(`${url}/opportunities`);
  const [prepared] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/control/command") && response.request().method() === "POST"),
    page.getByRole("button", { name: "Preparar candidatura" }).first().click()
  ]);
  const application = await prepared.json();
  assert(application.ok && application.workRunId && application.approvalId, "Browser application preparation");
  await page.goto(`${url}/decisions`);
  const approvalSelector = `[data-approval-id="${application.approvalId}"]`;
  await page.locator(`${approvalSelector}[data-state="PENDING"]`).waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  const [approved] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/control/command") && response.request().method() === "POST"),
    page.locator(approvalSelector).locator('button[data-command="approveAction"]').click()
  ]);
  assert((await approved.json()).status === "CONSUMED", "Fixture approval must be consumed");
  await page.locator(`${approvalSelector}[data-state="CONSUMED"]`).waitFor();
  await page.goto(`${url}/tasks`);
  await page.locator(`[data-work-run-id="${application.workRunId}"][data-state="APPLICATION_SENT"][data-application-status="SENT"]`).waitFor();
  await page.screenshot({ path: join(tmpdir(), "beyonder-control-hardening.png"), fullPage: true });
  assert(errors.length === 0, `Browser errors: ${errors.join(", ")}`);
  await page.goto(`${url}/settings`);
  await page.getByRole("button", { name: "Parar Beyonder", exact: true }).click();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  assert((await health())?.ok, "Cancelled shutdown must keep the server alive");
  await page.getByRole("button", { name: "Parar Beyonder", exact: true }).click();
  const shutdown = page.waitForResponse((response) => response.url().endsWith("/api/control/command") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Parar com segurança", exact: true }).click();
  assert((await (await shutdown).json()).ok, "Shutdown should respond before termination");
  await browser.close(); browser = null; await stopped();
  result = await launch(); assert(result.code === 0, result.output); assert((await health())?.status.global === "READY", "Restart must become READY");
  const restartedMission = await completedMission(browserMission.taskId);
  assertVerifiedMission(restartedMission, browserMission.taskId, browserObjective);
  assert(restartedMission.result === browserMission.result, "Verified result must survive supervisor restart");
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  const restoredCard = page.locator(".home-recent").locator(`[data-mission-id="${browserMission.taskId}"]`);
  await assertMissionCard(restoredCard, browserMission, true);
  await restoredCard.getByRole("link", { name: "Abrir missão", exact: true }).click();
  await assertMissionCard(page.locator(`[data-mission-id="${browserMission.taskId}"]`), browserMission);
  assert(errors.length === 0, `Browser errors after restart: ${errors.join(", ")}`);
  await browser.close(); browser = null;
  assert((await command({ type: "safeShutdown" })).ok, "Second shutdown"); await stopped();
  console.log(JSON.stringify({ status: "PASS", production: true, browserE2E: true, verifiedPersistedResult: true, homePollingRecovery: true, refreshPersistence: true, restartPersistence: true, heartbeat: true, duplicateLaunch: true, stalePidRecovery: true, portCollision: true, safeShutdown: true, restart: true, monetaryCostUsd: 0 }, null, 2));
} catch (error) {
  const evidence = fileURLToPath(new URL("../../../artifacts/supervisor-smoke/", import.meta.url));
  mkdirSync(evidence, { recursive: true });
  if (existsSync(join(dir, "control-center.log"))) copyFileSync(join(dir, "control-center.log"), join(evidence, "control-center.log"));
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(evidence, "home.png"), fullPage: true }).catch(() => {});
    writeFileSync(join(evidence, "page.html"), await page.content().catch(() => "Page unavailable"));
  }
  const overview = await fetch(`${url}/api/control/overview`, { signal: AbortSignal.timeout(2000) }).then((response) => response.json()).catch(() => null);
  writeFileSync(join(evidence, "failure.json"), JSON.stringify({ error: String(error), browserMission, overview, health: await health() }, null, 2));
  throw error;
} finally {
  if (browser) await browser.close();
  if (collision?.listening) await new Promise((accept) => collision.close(accept));
  if (existsSync(join(dir, "supervisor.pid"))) { const pid = JSON.parse(readFileSync(join(dir, "supervisor.pid"))).pid; try { process.kill(pid, "SIGTERM"); } catch {} await delay(1000); }
  rmSync(dir, { recursive: true, force: true });
}
