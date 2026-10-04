import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./client.js";
import { StateStore } from "../memory/state-store.js";

describe("SQLite crash and concurrent local owners", () => {
  it("preserves acknowledged terminal state across concurrent access and SIGKILL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "beyonder-sqlite-crash-"));
    const path = join(directory, "runtime.sqlite");
    const dashboard = openDatabase(path);
    const cli = openDatabase(path);
    const dashboardState = new StateStore(dashboard.db);
    const cliState = new StateStore(cli.db);
    const fixture = fileURLToPath(new URL("./crash-writer-fixture.ts", import.meta.url));
    const child = spawn(process.execPath, ["--import", "tsx", fixture, path], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`writer did not acknowledge: ${stderr}`)), 10_000);
      child.stdout.on("data", (chunk) => { if (String(chunk).includes("ACK")) { clearTimeout(timer); resolve(); } });
      child.once("error", reject);
      child.once("exit", (code) => { if (code && code !== 137) reject(new Error(`writer exited ${code}: ${stderr}`)); });
    });

    for (let index = 0; index < 30; index++) {
      await dashboardState.set("control-center:state", { lastHeartbeatAt: new Date().toISOString(), index });
      await cliState.set("crash:cli", { index });
      expect(await cliState.get("crash:terminal", null)).toMatchObject({ state: "COMPLETED" });
    }
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
    dashboard.sqlite.close();
    cli.sqlite.close();

    const restarted = openDatabase(path);
    try {
      const state = new StateStore(restarted.db);
      expect(restarted.sqlite.pragma("quick_check", { simple: true })).toBe("ok");
      expect(restarted.sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(await state.get("crash:terminal", null)).toMatchObject({ state: "COMPLETED" });
      expect({
        journalMode: restarted.sqlite.pragma("journal_mode", { simple: true }),
        synchronous: restarted.sqlite.pragma("synchronous", { simple: true }),
        busyTimeout: restarted.sqlite.pragma("busy_timeout", { simple: true }),
        foreignKeys: restarted.sqlite.pragma("foreign_keys", { simple: true })
      }).toEqual({ journalMode: "wal", synchronous: 1, busyTimeout: 5000, foreignKeys: 1 });
      expect(stderr).not.toMatch(/SQLITE_BUSY|double.close|exit 134/i);
    } finally {
      restarted.sqlite.close();
    }
  }, 20_000);
});
