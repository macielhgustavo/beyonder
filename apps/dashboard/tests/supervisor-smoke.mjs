import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const dir = mkdtempSync(join(tmpdir(), "beyonder-supervisor-test-"));
const launcher = fileURLToPath(new URL("../bin/launch-control-center.mjs", import.meta.url));
const url = "http://127.0.0.1:4187";
const visualDir = process.env.BEYONDER_VISUAL_QA_DIR || join(process.cwd(), "apps/dashboard/test-artifacts");
rmSync(visualDir, { recursive: true, force: true });
mkdirSync(visualDir, { recursive: true });

const env = {
  ...process.env,
  BEYONDER_CONTROL_RUNTIME_DIR: dir,
  BEYONDER_DB_PATH: join(dir, "runtime.sqlite"),
  BEYONDER_PROVIDER_STATE_PATH: join(dir, "providers.json"),
  BEYONDER_CONTROL_NO_OPEN: "1",
  BEYONDER_CONTROL_FIXTURE: "1",
  BEYONDER_MODEL_PROVIDER: "none"
};

function launch() {
  return new Promise((accept, reject) => {
    let output = "";
    const child = spawn(process.execPath, [launcher], { env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (data) => output += data);
    child.stderr.on("data", (data) => output += data);
    child.once("error", reject);
    child.once("exit", (code) => accept({ code, output }));
  });
}

async function command(body) {
  const response = await fetch(`${url}/api/control/command`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: url },
    body: JSON.stringify(body)
  });
  return response.json();
}

async function health() {
  try {
    return await (await fetch(`${url}/api/control/health`, { signal: AbortSignal.timeout(1000) })).json();
  } catch {
    return null;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function stopped() {
  for (let i = 0; i < 60; i++) {
    if (!(await health()) && !existsSync(join(dir, "supervisor.pid"))) return;
    await delay(500);
  }
  throw new Error("Safe shutdown did not exit or left a stale PID");
}

async function visualAudit(page, name) {
  const overlay = await page.locator("[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay").count();
  assert(overlay === 0, `${name}: framework error overlay visible`);
  assert((await page.locator("body").innerText()).trim().length > 0, `${name}: blank page`);
  assert(await page.locator(".nav-link.is-active").count() === 1, `${name}: active navigation state missing or ambiguous`);

  const layout = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const viewportWidth = window.innerWidth;
    const documentWidth = Math.max(root.scrollWidth, body.scrollWidth);
    const allowedOverflowSelectors = ".task-flow, .table-wrap, .nav, .history-chart";
    const offenders = Array.from(document.querySelectorAll("body *"))
      .filter((node) => node instanceof HTMLElement)
      .filter((node) => !node.closest(allowedOverflowSelectors))
      .map((node) => ({ node, rect: node.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && (rect.left < -2 || rect.right > viewportWidth + 2))
      .slice(0, 12)
      .map(({ node, rect }) => ({
        tag: node.tagName.toLowerCase(),
        className: node.className,
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width)
      }));
    return { viewportWidth, documentWidth, offenders };
  });

  assert(layout.documentWidth <= layout.viewportWidth + 2, `${name}: page-level horizontal overflow ${JSON.stringify(layout)}`);
  assert(layout.offenders.length === 0, `${name}: visual overflow offenders ${JSON.stringify(layout.offenders)}`);
  return layout;
}

async function captureVisualState(page, route, fileName, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(`${url}${route}`, { waitUntil: "load" });
  await page.locator(".main-content").waitFor();
  const audit = await visualAudit(page, `${fileName} (${viewport.width}x${viewport.height})`);
  await page.screenshot({ path: join(visualDir, `${fileName}.png`), fullPage: true });
  return audit;
}

let collision;
let browser;
try {
  collision = createServer((socket) => socket.destroy());
  await new Promise((accept, reject) => {
    collision.once("error", reject);
    collision.listen(4187, "127.0.0.1", accept);
  });
  let result = await launch();
  assert(result.code !== 0 && result.output.includes("4187"), "Port collision must fail clearly");
  assert(collision.listening, "Existing process must survive collision");
  await new Promise((accept) => collision.close(accept));
  collision = null;

  writeFileSync(join(dir, "supervisor.pid"), JSON.stringify({ pid: process.pid }));
  result = await launch();
  assert(result.code === 0, result.output);
  const first = await health();
  assert(first?.service === "beyonder-control-center" && first.status.global === "READY", "Runtime heartbeat must report READY");
  result = await launch();
  assert(result.code === 0, "Duplicate launch should reuse the process");
  assert((await health()).pid === first.pid, "Duplicate must not create another server");

  const objectiveResult = await command({ type: "submitObjective", objective: "Execute deterministic objective" });
  assert(objectiveResult.status === "COMPLETED", `Fixture objective must complete: ${JSON.stringify(objectiveResult)}`);
  const tasksHtml = await (await fetch(`${url}/tasks`)).text();
  assert(tasksHtml.includes("Execute deterministic objective") && tasksHtml.includes("TEST DATA"), "Result and fixture badge must be visible");
  assert((await command({ type: "discoverOpportunities" })).count > 0, "Fixture discovery");
  assert((await command({ type: "pauseRuntime" })).ok, "Pause");
  assert(!(await command({ type: "submitObjective", objective: "Paused work must be rejected" })).ok, "Paused objective must fail");
  assert((await command({ type: "resumeRuntime" })).ok, "Resume");
  assert((await command({ type: "submitObjective", objective: "Resumed work executes" })).ok, "Resumed work must execute");

  const { chromium } = createRequire(new URL("../../../packages/browser-agent/package.json", import.meta.url))("playwright");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(url, { waitUntil: "load" });
  await page.locator("#objective").fill("Objetivo pelo navegador de teste");
  await page.getByRole("button", { name: "Executar", exact: true }).click();
  await page.getByText("Objetivo concluído. Resultado registrado em Trabalhos.", { exact: true }).waitFor();
  await page.goto(`${url}/tasks`, { waitUntil: "load" });
  assert((await page.locator(".task-list").innerText()).includes("Objetivo pelo navegador de teste"), "Browser task result must be visible");

  await page.goto(`${url}/opportunities`, { waitUntil: "load" });
  const prepared = page.waitForResponse((response) => response.url().endsWith("/api/control/command") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Preparar candidatura" }).first().click();
  assert((await (await prepared).json()).ok, "Browser application preparation");

  await page.goto(`${url}/decisions`, { waitUntil: "load" });
  page.once("dialog", (dialog) => dialog.accept());
  const approved = page.waitForResponse((response) => response.url().endsWith("/api/control/command") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Sim, autorizar" }).first().click();
  assert((await (await approved).json()).status === "CONSUMED", "Fixture approval must be consumed");
  await page.goto(`${url}/tasks`, { waitUntil: "load" });
  assert((await page.locator(".main").innerText()).includes("✓ enviada"), "Fixture application state visible");

  const visualQa = {
    desktopHome: await captureVisualState(page, "/", "desktop-home", { width: 1440, height: 1000 }),
    desktopTasks: await captureVisualState(page, "/tasks", "desktop-tasks", { width: 1440, height: 1000 }),
    desktopOpportunities: await captureVisualState(page, "/opportunities", "desktop-opportunities", { width: 1440, height: 1000 }),
    mobileHome: await captureVisualState(page, "/", "mobile-home", { width: 390, height: 844 }),
    mobileTasks: await captureVisualState(page, "/tasks", "mobile-tasks", { width: 390, height: 844 }),
    mobileOpportunities: await captureVisualState(page, "/opportunities", "mobile-opportunities", { width: 390, height: 844 })
  };

  assert(errors.length === 0, `Browser errors: ${errors.join(", ")}`);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${url}/settings`, { waitUntil: "load" });
  await page.getByRole("button", { name: "Parar Beyonder", exact: true }).click();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  assert((await health())?.ok, "Cancelled shutdown must keep the server alive");
  await page.getByRole("button", { name: "Parar Beyonder", exact: true }).click();
  const shutdown = page.waitForResponse((response) => response.url().endsWith("/api/control/command") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Parar com segurança", exact: true }).click();
  assert((await (await shutdown).json()).ok, "Shutdown should respond before termination");
  await browser.close();
  browser = null;
  await stopped();

  result = await launch();
  assert(result.code === 0, result.output);
  assert((await health())?.status.global === "READY", "Restart must become READY");
  assert((await command({ type: "safeShutdown" })).ok, "Second shutdown");
  await stopped();

  console.log(JSON.stringify({
    status: "PASS",
    production: true,
    browserE2E: true,
    visualQa,
    screenshots: Object.keys(visualQa).length,
    heartbeat: true,
    duplicateLaunch: true,
    stalePidRecovery: true,
    portCollision: true,
    safeShutdown: true,
    restart: true,
    monetaryCostUsd: 0
  }, null, 2));
} finally {
  if (browser) await browser.close();
  if (collision?.listening) await new Promise((accept) => collision.close(accept));
  if (existsSync(join(dir, "supervisor.pid"))) {
    const pid = JSON.parse(readFileSync(join(dir, "supervisor.pid"))).pid;
    try { process.kill(pid, "SIGTERM"); } catch {}
    await delay(1000);
  }
  rmSync(dir, { recursive: true, force: true });
}
