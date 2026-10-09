#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, openSync, closeSync, linkSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const port = controlPort(process.env.BEYONDER_CONTROL_PORT);
const url = `http://127.0.0.1:${port}`;
const runtimeDir = process.env.BEYONDER_CONTROL_RUNTIME_DIR ?? join(process.env.XDG_RUNTIME_DIR ?? join(homedir(), ".cache"), "beyonder-control");
const lockPath = join(runtimeDir, "supervisor.pid");
const logPath = join(runtimeDir, "control-center.log");
const isSupervisor = process.argv.includes("--supervise");
function controlPort(raw) {
  if (raw === undefined || raw === "") return 4187;
  if (!/^\d+$/.test(raw)) throw new Error("BEYONDER_CONTROL_PORT deve ser uma porta TCP válida.");
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) throw new Error("BEYONDER_CONTROL_PORT deve estar entre 1024 e 65535.");
  return parsed;
}
async function health() {
  try { const response = await fetch(`${url}/api/control/health`, { signal: AbortSignal.timeout(1500) }); const result = await response.json(); return result.service === "beyonder-control-center" ? result : null; } catch { return null; }
}
function running() {
  try { const record = JSON.parse(readFileSync(lockPath, "utf8")); if (!Number.isInteger(record.pid) || record.pid <= 0) throw new Error(); process.kill(record.pid, 0); if (process.platform === "linux" && (!readFileSync(`/proc/${record.pid}/cmdline`, "utf8").includes("--supervise") || record.repoRoot !== repoRoot)) throw new Error("Stale supervisor PID"); return record; }
  catch { rmSync(lockPath, { force: true }); return null; }
}
async function freePort() {
  await new Promise((accept, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error(`Porta ${port} ocupada. Nenhum processo foi encerrado. Libere a porta e tente novamente.`)));
    server.listen(port, "127.0.0.1", () => server.close(accept));
  });
}
async function ready() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await health();
    if (result?.status.heartbeat === "ONLINE" || result?.status.heartbeat === "PAUSED") return result;
    if (!running()) throw new Error(`Beyonder não iniciou. Consulte ${logPath}`);
    await delay(500);
  }
  throw new Error(`Beyonder não respondeu em 30 segundos. Consulte ${logPath}`);
}
function openBrowser() {
  if (process.env.BEYONDER_CONTROL_NO_OPEN === "1") return;
  const child = spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" });
  child.on("error", () => {}); child.unref();
}
async function supervise() {
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  if (running()) return;
  const temporary = `${lockPath}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ pid: process.pid, repoRoot }), { mode: 0o600 });
  try { linkSync(temporary, lockPath); } catch (error) { if (error.code === "EEXIST") return; throw error; } finally { rmSync(temporary, { force: true }); }
  let child;
  let timer;
  const cleanup = () => { clearInterval(timer); try { if (JSON.parse(readFileSync(lockPath, "utf8")).pid === process.pid) rmSync(lockPath, { force: true }); } catch {} };
  try {
    await freePort();
    if (!existsSync(join(repoRoot, "apps/dashboard/.next/BUILD_ID"))) throw new Error("Execute pnpm control-center:build antes de abrir o Beyonder.");
    child = spawn(process.execPath, [join(repoRoot, "apps/dashboard/node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: join(repoRoot, "apps/dashboard"), stdio: "inherit",
      env: { ...process.env, DOTENV_CONFIG_PATH: process.env.DOTENV_CONFIG_PATH ?? join(repoRoot, ".env"), BEYONDER_REPO_ROOT: repoRoot, BEYONDER_NODE_PATH: process.execPath, BEYONDER_DB_PATH: resolve(repoRoot, process.env.BEYONDER_DB_PATH ?? "data/beyonder.sqlite"), NODE_ENV: "production" }
    });
    writeFileSync(temporary, JSON.stringify({ pid: process.pid, childPid: child.pid, repoRoot }), { mode: 0o600 });
    renameSync(temporary, lockPath);
    const stop = () => { clearInterval(timer); child.kill("SIGTERM"); };
    process.once("SIGTERM", stop); process.once("SIGINT", stop);
    let checking = false;
    timer = setInterval(async () => { if (checking) return; checking = true; try { const result = await health(); if (result?.shutdownReady) stop(); } finally { checking = false; } }, 500);
    await new Promise((accept, reject) => { child.once("error", reject); child.once("exit", (code) => { process.exitCode = code ?? 0; accept(); }); });
  } finally { cleanup(); }
}
async function main() {
  if (isSupervisor) return supervise();
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  if (process.argv.includes("--restart")) {
    const result = await health();
    if (result) {
      const response = await fetch(`${url}/api/control/command`, { method: "POST", headers: { "content-type": "application/json", origin: url, authorization: `Bearer ${JSON.parse(readFileSync(join(process.env.BEYONDER_CONTROL_AUTH_DIR ?? join(homedir(), ".beyonder", "control-center"), "auth-token.json"), "utf8")).token}` }, body: JSON.stringify({ type: "safeShutdown" }) });
      if (!response.ok) throw new Error("Não foi possível solicitar parada segura.");
      for (let i = 0; i < 120 && running(); i++) await delay(500);
      if (running()) throw new Error("Aguardando conclusão da parada segura. Tente reiniciar depois.");
    }
  }
  const existing = await health();
  if (existing && running()?.childPid === existing.pid) return openBrowser();
  if (existing) throw new Error("Já existe um Beyonder sem supervisor nesta porta. Encerre essa instância antes de iniciar.");
  if (!running()) {
    await freePort();
    if (!existsSync(join(repoRoot, "apps/dashboard/.next/BUILD_ID"))) throw new Error("Execute pnpm control-center:build antes de abrir o Beyonder.");
    const fd = openSync(logPath, "a", 0o600);
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--supervise"], { cwd: repoRoot, detached: true, stdio: ["ignore", fd, fd], env: process.env });
    closeSync(fd); child.unref();
    // Give the supervisor time to acquire the exclusive PID file.
    await delay(500);
  }
  await ready(); openBrowser();
}
main().catch((error) => {
  console.error(error.message);
  if (!isSupervisor && process.env.BEYONDER_CONTROL_NO_OPEN !== "1" && process.platform === "linux") {
    const notification = spawn("notify-send", ["Beyonder não iniciou", error.message], { detached: true, stdio: "ignore" });
    notification.on("error", () => {}); notification.unref();
  }
  process.exitCode = 1;
});
