import { chromium } from "playwright";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const require = createRequire(path.join(root, "package.json"));
const Database = require("better-sqlite3");
const { providers } = await import(require.resolve("@beyonder/compute"));
const dir = process.env.CONTROLLED_ACCEPTANCE_DIR ?? "/tmp/beyonder-controlled-acceptance";
await fs.mkdir(dir, { recursive: true });
const dbPath = path.join(dir, "runtime.sqlite"), providerPath = path.join(dir, "providers.json"), scenarioPath = path.join(dir, "scenario.json");
const preload = fileURLToPath(new URL("./controlled-inference-preload.mjs", import.meta.url));
const port = Number(process.env.CONTROLLED_ACCEPTANCE_PORT ?? 4194), base = `http://127.0.0.1:${port}`;
const scenarios = [
  { name: "bad-neighbor", objective: "Qual é a capital do Canadá?", badAnswer: "Borboletas possuem asas coloridas e vivem em muitos ecossistemas.", reject: true },
  { name: "neighbor-analog-a", objective: "O que significa HTTP 410?", badAnswer: "Uma árvore possui raízes e folhas.", reject: true },
  { name: "neighbor-analog-b", objective: "Para que serve uma chave primária em SQL?", badAnswer: "Montanhas podem conter diferentes tipos de rochas.", reject: true },
  { name: "format-analog-a", objective: "Return only valid JSON with ready set to true.", badAnswer: "Ready.", reject: true },
  { name: "format-analog-b", objective: "Forneça somente JSON com status igual pronto.", badAnswer: "status: pronto", reject: true },
  { name: "bad-current-no-evidence", objective: "Qual é a versão estável atual do Python?", badAnswer: "Python is currently version 999; no evidence is needed.", reject: true },
  { name: "bad-refusal", objective: "Explique o significado do código HTTP 404.", badAnswer: "I cannot answer that question.", reject: true },
  { name: "bad-empty", objective: "Explique a diferença entre pilha e fila.", badAnswer: " ", reject: true },
  { name: "bad-incomplete", objective: "Compare pilha e fila, incluindo ordem, aplicações e complexidade.", badAnswer: "Uma pilha armazena coisas.", reject: true },
  { name: "bad-format", objective: "Retorne somente JSON válido descrevendo o significado de HTTP 404.", badAnswer: "O recurso não foi encontrado.", reject: true },
  { name: "bad-code", objective: "Escreva uma função TypeScript que retorne a soma de uma lista vazia como zero.", badAnswer: "def sum_values(xs): return None", reject: true },
  { name: "bad-unsupported-claim", objective: "Compare as vantagens de backup local e remoto sem inventar garantias.", badAnswer: "Backups remotos nunca falham e garantem recuperação infinita.", reject: true },
  { name: "cloud-first", objective: "Explique o significado do código HTTP 404.", expectCloud: true },
  { name: "cloud-provider-recovery", objective: "Explique o significado do código HTTP 404.", failFirstCloud: true, expectCloud: true, requiresRecovery: true },
  { name: "provider-timeout", objective: "Explique o significado do código HTTP 404.", timeoutFirstCloud: true, expectCloud: true, requiresRecovery: true },
  { name: "efficient-trivial-cloud", objective: "Responda somente o nome da capital do Canadá.", goodAnswer: "Ottawa", scoreByProvider: { groq: 0.99, gemini: 0.86 }, latencyByProvider: { groq: 10000, gemini: 1 }, expectProvider: "gemini" },
  { name: "efficiency-analog-a", objective: "Responda somente o nome da capital da Austrália.", goodAnswer: "Canberra", scoreByProvider: { groq: 0.99, gemini: 0.86 }, latencyByProvider: { groq: 10000, gemini: 1 }, expectProvider: "gemini" },
  { name: "efficiency-analog-b", objective: "Responda somente o nome da capital da Nova Zelândia.", goodAnswer: "Wellington", scoreByProvider: { groq: 0.99, gemini: 0.86 }, latencyByProvider: { groq: 10000, gemini: 1 }, expectProvider: "gemini" },
  { name: "difficult-quality-floor", objective: "Escreva uma função TypeScript que some uma lista, retorne zero para lista vazia e explique a prova por indução.", goodAnswer: "export function sum(xs: readonly number[]): number { return xs.reduce((a, b) => a + b, 0); } A base vazia vale zero; cada passo adiciona o próximo elemento ao acumulador.", scoreByProvider: { groq: 0.99, gemini: 0.1 }, localScore: 0.1, strongVerifier: true, expectProvider: "groq" },
  { name: "local-emergency", objective: "Explique o significado do código HTTP 404.", failProviders: ["groq", "gemini"], expectProvider: "ollama" },
  { name: "local-inadequate", objective: "Explique o significado do código HTTP 404.", failProviders: ["groq", "gemini"], localScore: 0.1, reject: true },
  { name: "no-capability", objective: "Explique o significado do código HTTP 404.", cloudScore: 0.1, localScore: 0.1, reject: true },
  { name: "refresh-during-mission", objective: "Explique o significado do código HTTP 404.", expectCloud: true, delayMs: 1500, refreshDuring: true }
];
await fs.writeFile(scenarioPath, JSON.stringify(scenarios[0]));
const serverLog = await fs.open(path.join(dir, "supervisor.log"), "a");
const startServer = () => spawn(process.execPath, [path.join(root, "apps/dashboard/bin/launch-control-center.mjs"), "--supervise"], { cwd: root, stdio: ["ignore", serverLog.fd, serverLog.fd], env: { ...process.env, NODE_OPTIONS: `--import ${preload}`, CONTROLLED_SCENARIO_FILE: scenarioPath, BEYONDER_CONTROL_FIXTURE: "0", BEYONDER_MODEL_PROVIDER: "auto", BEYONDER_DB_PATH: dbPath, BEYONDER_PROVIDER_STATE_PATH: providerPath, OLLAMA_BASE_URL: "http://127.0.0.1:11599", BEYONDER_CONTROL_PORT: String(port), BEYONDER_CONTROL_RUNTIME_DIR: path.join(dir, "supervisor"), GROQ_API_KEY: "controlled-harness-not-a-secret", GEMINI_API_KEY: "controlled-harness-not-a-secret" } });
let server = startServer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const report = { controlled: true, realCloudInference: false, monetaryCostUsd: 0, cases: [] };
const save = () => fs.writeFile(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
try {
  let ready = false;
  for (let i = 0; i < 60; i++) { try { await page.goto(base); ready = true; break; } catch { await new Promise((resolve) => setTimeout(resolve, 500)); } }
  assert(ready, "Controlled production supervisor did not start");
  const onboarding = page.locator('[data-command="completeFirstRun"]');
  if (await onboarding.count()) await onboarding.click();
  for (const scenario of scenarios) {
    await fs.writeFile(scenarioPath, JSON.stringify(scenario));
    const now = new Date().toISOString();
    const state = { version: 1, updatedAt: now, providers: Object.fromEntries(providers.map((provider) => [provider.id, { providerId: provider.id, state: ["groq", "gemini"].includes(provider.id) ? "READY" : "SKIPPED", classification: "AUTO_WITH_HUMAN_GATE", attempts: 1, lastUpdatedAt: now, validation: { status: "validated", models: provider.id === "groq" ? ["llama-3.3-70b-versatile", ...(scenario.strongVerifier ? ["openai/gpt-oss-120b"] : [])] : provider.id === "gemini" ? ["gemini-2.5-flash"] : [] } }])) };
    await fs.writeFile(providerPath, JSON.stringify(state));
    const db = new Database(dbPath);
    db.prepare("DELETE FROM state WHERE key LIKE 'provider-health:%' OR key LIKE 'model-health:%'").run();
    db.prepare("DELETE FROM memories").run();
    const insert = db.prepare("INSERT INTO memories(id,kind,content,importance,confidence,utility,created_at,last_accessed_at,access_count,source,keywords,metadata) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
    // Synthetic performance evidence is confined to this controlled database.
    // It establishes test capability envelopes, never evidence of real model quality.
    for (const [provider, model] of [["groq", "llama-3.3-70b-versatile"], ...(scenario.strongVerifier ? [["groq", "openai/gpt-oss-120b"]] : []), ["gemini", "gemini-2.5-flash"], ["ollama", "controlled-local"], ["ollama", "controlled-local-verifier"]]) for (const taskType of ["chat", "reasoning", "planning", "coding", "research", "tool-use", "browser"]) for (let i = 0; i < 25; i++) {
      const score = provider === "ollama" ? scenario.localScore ?? 0.98 : scenario.scoreByProvider?.[provider] ?? scenario.cloudScore ?? 0.98;
      insert.run(`${provider}-${model}-${taskType}-${i}`, "economic", "Controlled capability envelope", 1, 1, 1, now, now, 0, "controlled-harness", "[]", JSON.stringify({ provider, model, taskType, success: score > 0.5, evaluationScore: score, latencyMs: scenario.latencyByProvider?.[provider] ?? (provider === "groq" ? 1 : 1000), monetaryCostUsd: 0, shadowCostUsd: 0, attempts: 1, controlled: true }));
    }
    db.close();
    await page.goto(base);
    await page.locator("#objective").fill(scenario.objective);
    const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/control/command") && response.request().method() === "POST");
    await page.locator('.objective-box button[type="submit"]').click();
    const queued = await (await responsePromise).json();
    assert(queued.taskId, JSON.stringify(queued));
    if (scenario.refreshDuring) await page.reload();
    let mission;
    for (let i = 0; i < 180; i++) { const payload = await (await page.request.get(`${base}/api/control/missions/${queued.taskId}`)).json(); if (["succeeded", "failed", "blocked"].includes(payload.mission?.status) && payload.mission.objectiveStatus && payload.mission.executionPhase !== "EXECUTING") { mission = payload.mission; break; } await page.waitForTimeout(500); }
    const success = mission?.status === "succeeded" && mission.resultVerified;
    const noUnjustifiedLocal = !scenario.expectCloud || scenario.requiresRecovery || !mission?.attempts?.some((attempt) => attempt.provider === "ollama");
    const recovered = !scenario.requiresRecovery || mission?.attempts?.some((attempt) => attempt.status === "FAILED" && ["PROVIDER_UNAVAILABLE", "TIMEOUT"].includes(attempt.failureClass));
    const noWeakLocal = !["local-inadequate", "no-capability"].includes(scenario.name) || !mission?.attempts?.some((attempt) => attempt.provider === "ollama");
    const producer = mission?.attempts?.filter((attempt) => attempt.phase === "DIRECT_RESPONSE" && attempt.status === "SUCCEEDED").at(-1);
    const verifier = mission?.attempts?.find((attempt) => attempt.phase === "OBJECTIVE_VERIFICATION" && attempt.status === "SUCCEEDED");
    const independentlyVerified = !success || Boolean(producer && verifier && (producer.provider !== verifier.provider || producer.model !== verifier.model));
    if (mission) await page.waitForFunction(({ id, state }) => document.querySelector(`.command-mission [data-mission-id="${id}"]`)?.getAttribute("data-state") === state, { id: queued.taskId, state: mission.status });
    const ok = recovered && noUnjustifiedLocal && noWeakLocal && independentlyVerified && (scenario.reject ? !success && Boolean(mission) : success && (scenario.expectCloud ? ["groq", "gemini"].includes(mission.provider) : mission.provider === scenario.expectProvider));
    report.cases.push({ ...scenario, taskId: queued.taskId, ok, mission });
    await save();
    console.log(JSON.stringify({ name: scenario.name, ok, status: mission?.status, objectiveStatus: mission?.objectiveStatus, provider: mission?.provider }));
    await page.screenshot({ path: path.join(dir, `${scenario.name}.png`), fullPage: true });
  }
  const interruptedScenario = { name: "checkpoint-restart-resume", objective: "Explique o significado do código HTTP 404.", delayMs: 5000 };
  await fs.writeFile(scenarioPath, JSON.stringify(interruptedScenario));
  await page.goto(base);
  await page.locator("#objective").fill(interruptedScenario.objective);
  const interruptedResponse = page.waitForResponse((response) => response.url().endsWith("/api/control/command") && response.request().method() === "POST");
  await page.locator('.objective-box button[type="submit"]').click();
  const interrupted = await (await interruptedResponse).json();
  assert(interrupted.taskId, "Interrupted journey was not persisted");
  let inFlight = false;
  for (let i = 0; i < 30; i++) {
    const payload = await (await page.request.get(`${base}/api/control/missions/${interrupted.taskId}`)).json();
    if (payload.mission?.attempts?.some((attempt) => attempt.phase === "DIRECT_RESPONSE" && attempt.status === "STARTED")) { inFlight = true; break; }
    await page.waitForTimeout(100);
  }
  assert(inFlight, "Did not observe an in-flight persisted inference before interruption");
  const crashed = new Promise((resolve) => server.once("exit", resolve));
  const owner = JSON.parse(await fs.readFile(path.join(dir, "supervisor/supervisor.pid"), "utf8"));
  process.kill(owner.childPid, "SIGKILL");
  await crashed;
  server = startServer();
  for (let i = 0; i < 60; i++) { try { await page.goto(base); break; } catch { await new Promise((resolve) => setTimeout(resolve, 500)); } }
  await page.goto(`${base}/missions/${interrupted.taskId}`);
  page.once("dialog", (dialog) => dialog.accept());
  const resumedResponse = page.waitForResponse((response) => response.url().endsWith("/api/control/command") && response.request().method() === "POST");
  await page.locator('[data-command="resumeTask"]').click();
  const resumed = await (await resumedResponse).json();
  assert(resumed.ok, `Checkpoint resume failed: ${JSON.stringify(resumed)}`);
  const resumedMission = (await (await page.request.get(`${base}/api/control/missions/${interrupted.taskId}`)).json()).mission;
  assert(resumedMission?.resultVerified && resumedMission.objectiveStatus === "SUCCEEDED", "Resumed mission did not verify");
  await page.locator(`[data-mission-id="${interrupted.taskId}"][data-state="succeeded"][data-result-verified="true"]`).waitFor();
  report.checkpointRestartResume = true;
  report.cases.push({ ...interruptedScenario, taskId: interrupted.taskId, ok: true, mission: resumedMission });
  await save();
  await page.goto(base);
  await page.locator('[data-command="pauseRuntime"]').click();
  await page.locator('[data-command="resumeRuntime"]').click();
  await page.locator('[data-command="pauseRuntime"]').waitFor();
  report.pauseResumeThroughUi = true;
  await page.goto(`${base}/settings`);
  await page.getByRole("button", { name: "Parar Beyonder", exact: true }).click();
  const stopped = new Promise((resolve) => server.once("exit", resolve));
  await page.getByRole("button", { name: "Parar com segurança", exact: true }).click();
  await stopped;
  server = startServer();
  for (let i = 0; i < 60; i++) { try { await page.goto(base); break; } catch { await new Promise((resolve) => setTimeout(resolve, 500)); } }
  const persisted = report.cases.at(-1);
  await page.goto(`${base}/missions/${persisted.taskId}`);
  const afterRestart = await (await page.request.get(`${base}/api/control/missions/${persisted.taskId}`)).json();
  report.restartPreserved = afterRestart.mission?.result === persisted.mission?.result && afterRestart.mission?.resultVerified === true;
  assert(report.restartPreserved, "Verified result lost after supervisor restart");
  await page.locator(`[data-mission-id="${persisted.taskId}"][data-state="succeeded"][data-result-verified="true"]`).waitFor();
  report.pass = report.cases.every((entry) => entry.ok) && report.restartPreserved;
  await save();
  if (!report.pass) process.exitCode = 1;
} finally {
  await browser.close();
  const stopped = new Promise((resolve) => server.once("exit", resolve));
  if (server.exitCode === null) { server.kill("SIGTERM"); await stopped; }
  await serverLog.close();
}
