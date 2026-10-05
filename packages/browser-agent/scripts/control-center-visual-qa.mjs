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
  summary: { consoleErrors: 0, pageErrors: 0, requestFailures: 0, horizontalOverflows: 0 }
};

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

    page.on("console", (msg) => {
      if (msg.type() === "error") diagnostics.consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => diagnostics.pageErrors.push(String(error)));
    page.on("requestfailed", (request) => {
      const url = request.url();
      if (!url.includes("/_next/webpack-hmr")) diagnostics.requestFailures.push(`${request.method()} ${url} :: ${request.failure()?.errorText ?? "failed"}`);
    });

    const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle", timeout: 45_000 });
    diagnostics.url = page.url();
    diagnostics.title = await page.title();
    diagnostics.status = response?.status() ?? null;
    diagnostics.overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      bodyTextLength: document.body.innerText.trim().length,
      dialogs: document.querySelectorAll('[role="dialog"]').length
    }));

    await page.screenshot({
      path: path.join(outputDir, `${label}-${profile.name}-${name}.png`),
      fullPage: true,
      animations: "disabled"
    });

    profileReport.routes[name] = diagnostics;
    report.summary.consoleErrors += diagnostics.consoleErrors.length;
    report.summary.pageErrors += diagnostics.pageErrors.length;
    report.summary.requestFailures += diagnostics.requestFailures.length;
    if (diagnostics.overflow?.overflowX) report.summary.horizontalOverflows += 1;
    await page.close();
  }

  const missionPage = await context.newPage();
  await missionPage.goto(`${baseUrl}/missions`, { waitUntil: "networkidle", timeout: 45_000 });
  const missionHref = await missionPage.locator('a[href^="/missions/"]').first().getAttribute("href").catch(() => null);
  if (missionHref) {
    await missionPage.goto(`${baseUrl}${missionHref}`, { waitUntil: "networkidle", timeout: 45_000 });
    const missionOverflow = await missionPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    await missionPage.screenshot({
      path: path.join(outputDir, `${label}-${profile.name}-mission-detail.png`),
      fullPage: true,
      animations: "disabled"
    });
    profileReport.missionDetail = { href: missionHref, overflowX: missionOverflow };
    if (missionOverflow) report.summary.horizontalOverflows += 1;
  } else {
    profileReport.missionDetail = { href: null, note: "No mission detail link in fixture." };
  }
  await missionPage.close();
  await context.close();
}

await browser.close();
await fs.writeFile(path.join(outputDir, `${label}-report.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.summary));

if (process.env.STRICT_VISUAL_QA === "1" && (report.summary.consoleErrors || report.summary.pageErrors || report.summary.horizontalOverflows)) {
  process.exitCode = 1;
}
