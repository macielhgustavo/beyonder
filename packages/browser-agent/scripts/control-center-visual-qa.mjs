import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { classifyRequestFailure } from "./network-failures.mjs";

const baseUrl = process.env.CONTROL_CENTER_URL ?? "http://127.0.0.1:4187";
const repoRoot = process.env.GITHUB_WORKSPACE ?? path.resolve(process.cwd(), "../..");
const outputDir = process.env.VISUAL_QA_DIR ?? path.join(repoRoot, "artifacts", "control-center-visual-qa");
const label = process.env.VISUAL_QA_LABEL ?? "capture";

const routes = [
  ["home", "/"],
  ["missions", "/missions"],
  ["opportunities", "/opportunities"],
  ["work", "/tasks"],
  ["decisions", "/decisions"],
  ["resources", "/resources"],
  ["memory", "/memory"],
  ["history", "/audit"],
  ["settings", "/settings"]
];

const profiles = [
  { name: "desktop", viewport: { width: 1440, height: 1000 }, isMobile: false },
  { name: "notebook", viewport: { width: 1366, height: 768 }, isMobile: false },
  { name: "mobile", viewport: { width: 390, height: 844 }, isMobile: true }
];

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = {
  label,
  baseUrl,
  generatedAt: new Date().toISOString(),
  profiles: {},
  journey: {
    fixtureBacked: process.env.BEYONDER_CONTROL_FIXTURE === "1",
    semanticModelAnswerClaimed: false,
    steps: [],
    captures: {}
  },
  summary: { consoleErrors: 0, pageErrors: 0, requestFailures: 0, benignPrefetchAborts: 0, benignNavigationAborts: 0, benignRscStreamAborts: 0, horizontalOverflows: 0, interactionFailures: 0 }
};

const pageLifecycles = new WeakMap();
function attachDiagnostics(page, diagnostics) {
  diagnostics.benignPrefetchAborts = [];
  diagnostics.benignNavigationAborts = [];
  diagnostics.benignRscStreamAborts = [];
  const lifecycle = { generation: 0, replacement: null, requests: new WeakMap() };
  pageLifecycles.set(page, lifecycle);
  page.on("request", (request) => lifecycle.requests.set(request, { generation: lifecycle.generation, documentUrl: page.url() }));
  page.on("console", (msg) => {
    if (msg.type() === "error") diagnostics.consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(String(error)));
  page.on("requestfailed", (request) => {
    const headers = request.headers();
    const prefetchHeaders = Object.fromEntries(["rsc", "next-router-prefetch", "next-router-segment-prefetch"].filter((key) => headers[key] !== undefined).map((key) => [key, headers[key]]));
    const failure = { url: request.url(), method: request.method(), errorText: request.failure()?.errorText ?? "failed", headers: prefetchHeaders, navigation: request.isNavigationRequest() };
    const started = lifecycle.requests.get(request);
    if (started) { failure.documentUrl = started.documentUrl; failure.response = started.response; }
    if (lifecycle.replacement && started?.documentUrl === lifecycle.replacement.from) {
      failure.documentReplacement = { ...lifecycle.replacement, requestPredatesReplacement: started.generation < lifecycle.generation };
    }
    const detail = `${failure.method} ${failure.url} :: ${failure.errorText}`;
    const classification = classifyRequestFailure(failure, baseUrl);
    if (classification === "benign-rsc-prefetch-abort") diagnostics.benignPrefetchAborts.push({ ...failure, classification });
    else if (classification === "benign-rsc-stream-cancellation") diagnostics.benignRscStreamAborts.push({ ...failure, classification });
    else if (classification) diagnostics.benignNavigationAborts.push({ ...failure, classification });
    else diagnostics.requestFailures.push({ ...failure, detail, classification: "unclassified-request-failure" });
  });
  page.on("response", (response) => {
    const started = lifecycle.requests.get(response.request());
    if (started) started.response = { status: response.status(), contentType: response.headers()["content-type"] };
    if (response.status() >= 400) diagnostics.requestFailures.push(`${response.request().method()} ${response.url()} :: HTTP ${response.status()}`);
  });
}

async function navigate(page, url, options) {
  const lifecycle = pageLifecycles.get(page);
  lifecycle.replacement = { from: page.url(), to: url, reason: "qa-document-navigation" };
  lifecycle.generation++;
  try { return await page.goto(url, options); }
  finally { lifecycle.replacement = null; }
}

async function closePage(page) {
  const lifecycle = pageLifecycles.get(page);
  lifecycle.replacement = { from: page.url(), to: null, reason: "qa-page-close" };
  lifecycle.generation++;
  await page.close();
}

async function inspectPage(page) {
  return await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    bodyTextLength: document.body.innerText.trim().length,
    dialogs: document.querySelectorAll('[role="dialog"]').length
  }));
}

function addDiagnostics(diagnostics) {
  report.summary.consoleErrors += diagnostics.consoleErrors.length;
  report.summary.pageErrors += diagnostics.pageErrors.length;
  report.summary.requestFailures += diagnostics.requestFailures.length;
  report.summary.benignPrefetchAborts += diagnostics.benignPrefetchAborts.length;
  report.summary.benignNavigationAborts += diagnostics.benignNavigationAborts.length;
  report.summary.benignRscStreamAborts += diagnostics.benignRscStreamAborts.length;
  if (diagnostics.overflow?.overflowX) report.summary.horizontalOverflows += 1;
}

async function capture(page, fileName) {
  await page.screenshot({
    path: path.join(outputDir, fileName),
    fullPage: true,
    animations: "disabled"
  });
}

// Phase 1: cold-start surfaces. This intentionally preserves empty/first-run states.
for (const profile of profiles) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    isMobile: profile.isMobile,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: "dark"
  });
  const profileReport = { routes: {} };
  report.profiles[profile.name] = profileReport;

  for (const [name, route] of routes) {
    const page = await context.newPage();
    const diagnostics = { consoleErrors: [], pageErrors: [], requestFailures: [], overflow: null, title: null, url: null };
    attachDiagnostics(page, diagnostics);

    const response = await navigate(page, `${baseUrl}${route}`, { waitUntil: "networkidle", timeout: 45_000 });
    diagnostics.url = page.url();
    diagnostics.title = await page.title();
    diagnostics.status = response?.status() ?? null;
    diagnostics.overflow = await inspectPage(page);

    await capture(page, `${label}-${profile.name}-${name}.png`);

    profileReport.routes[name] = diagnostics;
    await closePage(page);
    addDiagnostics(diagnostics);
  }

  await context.close();
}

// Phase 2: exercise real Control Center interactions over the fixture-safe runtime.
// This proves product flow and persisted state. It deliberately does NOT claim the
// fixture produced a semantic LLM answer for the objective text.
const journeyContext = await browser.newContext({
  viewport: profiles[0].viewport,
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
  colorScheme: "dark"
});
const journeyPage = await journeyContext.newPage();
const journeyDiagnostics = { consoleErrors: [], pageErrors: [], requestFailures: [], overflow: null };
report.journey.diagnostics = journeyDiagnostics;
attachDiagnostics(journeyPage, journeyDiagnostics);
journeyPage.on("dialog", (dialog) => void dialog.accept());

async function journeyStep(name, action) {
  const startedAt = Date.now();
  try {
    const detail = await action();
    report.journey.steps.push({ name, ok: true, durationMs: Date.now() - startedAt, ...(detail ?? {}) });
    return true;
  } catch (error) {
    report.summary.interactionFailures += 1;
    report.journey.steps.push({ name, ok: false, durationMs: Date.now() - startedAt, error: String(error) });
    return false;
  }
}

await journeyStep("complete-first-run", async () => {
  await navigate(journeyPage, baseUrl, { waitUntil: "networkidle", timeout: 45_000 });
  const button = journeyPage.getByRole("button", { name: "Concluir verificação inicial" });
  const present = await button.isVisible().catch(() => false);
  if (present) {
    const [completed] = await Promise.all([
      journeyPage.waitForResponse((response) => response.url().endsWith("/api/control/command") && response.request().method() === "POST"),
      button.click()
    ]);
    if (!(await completed.json()).ok) throw new Error("First-run completion failed.");
    await button.waitFor({ state: "hidden" });
  }
  return { present };
});

let missionHref = null;
await journeyStep("submit-objective-via-command", async () => {
  await navigate(journeyPage, baseUrl, { waitUntil: "networkidle", timeout: 45_000 });
  await journeyPage.locator("#objective").fill("Responda apenas OK");
  const [submitted] = await Promise.all([
    journeyPage.waitForResponse((response) => response.url().endsWith("/api/control/command") && response.request().method() === "POST"),
    journeyPage.getByRole("button", { name: "Iniciar missão" }).click()
  ]);
  const queued = await submitted.json();
  if (!queued.ok || !queued.taskId) throw new Error("Objective was not durably queued.");
  const card = journeyPage.getByRole("region", { name: "Command Beyonder", exact: true }).locator(`[data-mission-id="${queued.taskId}"]`);
  await card.locator(':scope[data-state="succeeded"][data-objective-status="SUCCEEDED"][data-execution-phase="OBJECTIVE_VERIFIED"][data-result-verified="true"]').waitFor({ timeout: 45_000 });
  const persisted = await (await journeyPage.request.get(`${baseUrl}/api/control/missions/${queued.taskId}`)).json();
  const result = await card.getByRole("region", { name: "Resultado verificado", exact: true }).locator("p").innerText();
  if (!persisted.ok || !persisted.mission.resultVerified || persisted.mission.result !== result) throw new Error("Home result does not match the persisted verified mission.");
  const link = card.locator('a[href^="/missions/"]');
  missionHref = await link.getAttribute("href");
  if (!missionHref) throw new Error("Mission was submitted but no persisted mission detail link appeared.");
  const commandCapture = `${label}-desktop-command-result.png`;
  await capture(journeyPage, commandCapture);
  report.journey.commandResultCapture = commandCapture;
  return { objective: "Responda apenas OK", missionHref, semanticAssertion: false };
});

await journeyStep("discover-opportunities-via-ui", async () => {
  await navigate(journeyPage, `${baseUrl}/opportunities`, { waitUntil: "networkidle", timeout: 45_000 });
  const [discovered] = await Promise.all([
    journeyPage.waitForResponse((response) => response.url().endsWith("/api/control/command") && response.request().method() === "POST"),
    journeyPage.getByRole("button", { name: "Procurar agora" }).click()
  ]);
  const discovery = await discovered.json();
  if (!discovery.ok || discovery.count <= 0) throw new Error("Discovery did not persist opportunities.");
  await journeyPage.locator(".opportunity-row").first().waitFor({ state: "visible", timeout: 45_000 });
  const count = await journeyPage.locator(".opportunity-row").count();
  return { discoveredRows: count };
});

await journeyStep("prepare-application-via-ui", async () => {
  const prepare = journeyPage.getByRole("button", { name: "Preparar candidatura" }).first();
  if (!(await prepare.isVisible().catch(() => false))) throw new Error("Fixture opportunity did not expose application preparation.");
  const [prepared] = await Promise.all([
    journeyPage.waitForResponse((response) => response.url().endsWith("/api/control/command") && response.request().method() === "POST"),
    prepare.click()
  ]);
  const application = await prepared.json();
  if (!application.ok || !application.approvalId || !application.workRunId) throw new Error("Application preparation was not persisted with an approval boundary.");
  await navigate(journeyPage, `${baseUrl}/decisions`, { waitUntil: "networkidle", timeout: 45_000 });
  await journeyPage.locator(`[data-approval-id="${application.approvalId}"][data-state="PENDING"]`).waitFor();
  const approvals = await journeyPage.locator(".approval-card").count();
  return { available: true, approvalCards: approvals };
});

// Populated-state screenshots after the journey. Capture both desktop and mobile
// against the exact same persisted backend state.
const journeyRoutes = [
  ["journey-home", "/"],
  ["journey-missions", "/missions"],
  ["journey-opportunities", "/opportunities"],
  ["journey-decisions", "/decisions"],
  ["journey-work", "/tasks"],
  ["journey-history", "/audit"],
  ["journey-memory", "/memory"]
];
if (missionHref) journeyRoutes.splice(2, 0, ["journey-mission-detail", missionHref]);

await closePage(journeyPage);
await journeyContext.close();

for (const profile of profiles) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    isMobile: profile.isMobile,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: "dark"
  });
  const captures = {};
  report.journey.captures[profile.name] = captures;

  for (const [name, route] of journeyRoutes) {
    const page = await context.newPage();
    const diagnostics = { consoleErrors: [], pageErrors: [], requestFailures: [], overflow: null };
    attachDiagnostics(page, diagnostics);
    const response = await navigate(page, `${baseUrl}${route}`, { waitUntil: "networkidle", timeout: 45_000 });
    diagnostics.status = response?.status() ?? null;
    diagnostics.overflow = await inspectPage(page);
    await capture(page, `${label}-${profile.name}-${name}.png`);
    captures[name] = diagnostics;
    await closePage(page);
    addDiagnostics(diagnostics);
  }
  await context.close();
}

journeyDiagnostics.overflow = { overflowX: false };
addDiagnostics(journeyDiagnostics);

await browser.close();
await fs.writeFile(path.join(outputDir, `${label}-report.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ summary: report.summary, journey: report.journey.steps }));

if (process.env.STRICT_VISUAL_QA === "1" && (
  report.summary.consoleErrors ||
  report.summary.pageErrors ||
  report.summary.requestFailures ||
  report.summary.horizontalOverflows ||
  report.summary.interactionFailures
)) {
  process.exitCode = 1;
}
