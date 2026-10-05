import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

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
  summary: { consoleErrors: 0, pageErrors: 0, requestFailures: 0, horizontalOverflows: 0, interactionFailures: 0 }
};

function attachDiagnostics(page, diagnostics) {
  page.on("console", (msg) => {
    if (msg.type() === "error") diagnostics.consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(String(error)));
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (!url.includes("/_next/webpack-hmr")) diagnostics.requestFailures.push(`${request.method()} ${url} :: ${request.failure()?.errorText ?? "failed"}`);
  });
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

    const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle", timeout: 45_000 });
    diagnostics.url = page.url();
    diagnostics.title = await page.title();
    diagnostics.status = response?.status() ?? null;
    diagnostics.overflow = await inspectPage(page);

    await capture(page, `${label}-${profile.name}-${name}.png`);

    profileReport.routes[name] = diagnostics;
    addDiagnostics(diagnostics);
    await page.close();
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
  await journeyPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 45_000 });
  const button = journeyPage.getByRole("button", { name: "Concluir verificação inicial" });
  if (await button.isVisible().catch(() => false)) {
    await button.click();
    await journeyPage.waitForTimeout(700);
  }
  return { present: true };
});

let missionHref = null;
await journeyStep("submit-objective-via-command", async () => {
  await journeyPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 45_000 });
  await journeyPage.locator("#objective").fill("Responda apenas OK");
  await journeyPage.getByRole("button", { name: "Iniciar missão" }).click();

  await journeyPage.waitForFunction(() => {
    const text = document.body.innerText;
    return text.includes("Resultado verificado") || text.includes("Objetivo atendido") || text.includes("Não concluída") || text.includes("Precisa de você");
  }, undefined, { timeout: 45_000 });

  const link = journeyPage.locator('a[href^="/missions/"]').first();
  missionHref = await link.getAttribute("href");
  if (!missionHref) throw new Error("Mission was submitted but no persisted mission detail link appeared.");
  return { objective: "Responda apenas OK", missionHref, semanticAssertion: false };
});

await journeyStep("discover-opportunities-via-ui", async () => {
  await journeyPage.goto(`${baseUrl}/opportunities`, { waitUntil: "networkidle", timeout: 45_000 });
  await journeyPage.getByRole("button", { name: "Procurar agora" }).click();
  await journeyPage.locator(".opportunity-row").first().waitFor({ state: "visible", timeout: 45_000 });
  const count = await journeyPage.locator(".opportunity-row").count();
  return { discoveredRows: count };
});

await journeyStep("prepare-application-via-ui", async () => {
  const prepare = journeyPage.getByRole("button", { name: "Preparar candidatura" }).first();
  if (!(await prepare.isVisible().catch(() => false))) return { available: false, note: "Fixture opportunity did not expose application preparation." };
  await prepare.click();
  await journeyPage.waitForTimeout(900);
  await journeyPage.goto(`${baseUrl}/decisions`, { waitUntil: "networkidle", timeout: 45_000 });
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
  ["journey-history", "/audit"]
];
if (missionHref) journeyRoutes.splice(2, 0, ["journey-mission-detail", missionHref]);

await journeyPage.close();
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
    const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle", timeout: 45_000 });
    diagnostics.status = response?.status() ?? null;
    diagnostics.overflow = await inspectPage(page);
    await capture(page, `${label}-${profile.name}-${name}.png`);
    captures[name] = diagnostics;
    addDiagnostics(diagnostics);
    await page.close();
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
  report.summary.horizontalOverflows ||
  report.summary.interactionFailures
)) {
  process.exitCode = 1;
}
