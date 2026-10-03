#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const repoRoot = resolve(new URL("../../..", import.meta.url).pathname);
const url = process.env.BEYONDER_CONTROL_CENTER_URL ?? "http://127.0.0.1:4187";
const runtimeDir = process.env.XDG_RUNTIME_DIR ?? "/tmp";
const lockPath = `${runtimeDir}/beyonder-control-center.pid`;

async function main() {
  if (await healthy()) return open();
  if (isRunningFromLock()) {
    await waitUntilHealthy();
    return open();
  }
  mkdirSync(dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, String(process.pid));
  const child = spawn("pnpm", ["--filter", "@beyonder/control-center", "dev"], {
    cwd: repoRoot,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: "4187" }
  });
  child.unref();
  await waitUntilHealthy();
  return open();
}

async function healthy() {
  try {
    const response = await fetch(`${url}/api/control/health`, { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

function isRunningFromLock() {
  if (!existsSync(lockPath)) return false;
  const pid = Number(readFileSync(lockPath, "utf8"));
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilHealthy() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await healthy()) return;
    await delay(500);
  }
  throw new Error("Control Center did not become healthy within 30 seconds.");
}

function open() {
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(opener, [url], { detached: true, stdio: "ignore" }).unref();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
