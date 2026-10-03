import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalDashboardDataSource } from "../data/local";
import { EmptyDashboardDataSource } from "../data/empty";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("dashboard data sources", () => {
  it("keeps empty states stable when there is no runtime data", async () => {
    const source = new EmptyDashboardDataSource();
    expect((await source.getTasks()).length).toBe(0);
    expect((await source.getProviders()).length).toBe(0);
    expect((await source.getOverview()).runtimeStatus).toBe("unknown");
  });

  it("reads bounded local memory, ledger, audit and router telemetry without exposing secrets", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "beyonder-dashboard-"));
    const dbPath = path.join(dir, "runtime.sqlite");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE ledger_entries (id TEXT PRIMARY KEY, type TEXT NOT NULL, amount_usd REAL NOT NULL, description TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
      CREATE TABLE memories (id TEXT PRIMARY KEY, kind TEXT NOT NULL, content TEXT NOT NULL, importance INTEGER NOT NULL, confidence REAL NOT NULL, utility REAL NOT NULL, created_at TEXT NOT NULL, last_accessed_at TEXT, access_count INTEGER NOT NULL, source TEXT, task_id TEXT, keywords TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}');
      CREATE TABLE audit_events (id TEXT PRIMARY KEY, level TEXT NOT NULL, event TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
    db.prepare("INSERT INTO ledger_entries VALUES (?, ?, ?, ?, ?, ?)").run("l1", "capital", 10, "capital", "{}", "2026-10-03T00:00:00Z");
    db.prepare("INSERT INTO ledger_entries VALUES (?, ?, ?, ?, ?, ?)").run("l2", "expense", 2, "compute", "{}", "2026-10-03T01:00:00Z");
    db.prepare("INSERT INTO memories VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("m1", "semantic", "api_key=should-never-leak", 4, .9, .8, "2026-10-03T01:00:00Z", null, 1, "runtime", null, "[\"provider\"]", "{}");
    db.prepare("INSERT INTO audit_events VALUES (?, ?, ?, ?, ?)").run("a1", "error", "provider.failed", JSON.stringify({ token: "secret-token", message: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456" }), "2026-10-03T01:01:00Z");
    db.prepare("INSERT INTO audit_events VALUES (?, ?, ?, ?, ?)").run("c1", "debug", "router.candidate_scored", JSON.stringify({ taskId: "task-1", provider: "groq", model: "qwen", utility: .87 }), "2026-10-03T01:02:00Z");
    db.prepare("INSERT INTO audit_events VALUES (?, ?, ?, ?, ?)").run("c2", "debug", "router.candidate_scored", JSON.stringify({ taskId: "task-1", provider: "kilo", model: "llama", utility: .82 }), "2026-10-03T01:02:01Z");
    db.prepare("INSERT INTO audit_events VALUES (?, ?, ?, ?, ?)").run("s1", "debug", "shadow_cost.calculated", JSON.stringify({ taskId: "task-1", provider: "groq", model: "qwen", scarcity: .07, shadowCostUsd: .01 }), "2026-10-03T01:02:02Z");
    db.prepare("INSERT INTO audit_events VALUES (?, ?, ?, ?, ?)").run("r1", "info", "router.selected", JSON.stringify({ taskId: "task-1", provider: "groq", model: "qwen", predictedQuality: .91, historicalSuccess: .86, reliability: .93, monetaryCostUsd: 0, shadowCostUsd: .01, latencyPenalty: .03, failureRisk: .07, effectiveResourceCost: .17, utility: .87 }), "2026-10-03T01:02:03Z");
    db.close();

    const source = new LocalDashboardDataSource(dbPath);
    const economy = await source.getEconomy();
    expect(economy.balanceUsd).toBe(8);
    expect(economy.expensesUsd).toBe(2);

    const memories = await source.getMemories({ limit: 1 });
    expect(memories).toHaveLength(1);
    expect(memories[0].content).toContain("[REDACTED]");
    expect(memories[0].content).not.toContain("should-never-leak");

    const events = await source.getAuditEvents({ level: "error", limit: 1 });
    expect(events[0].details.token).toBe("[REDACTED]");
    expect(JSON.stringify(events[0].details)).not.toContain("abcdefghijklmnopqrstuvwxyz123456");

    const overview = await source.getOverview();
    expect(overview.runtimeStatus).toBe("unknown");
    expect(overview.effectiveResourceCost).toBe(.17);
    expect(overview.recentDecisions[0].selectedLabel).toBe("qwen / groq");
    expect(overview.recentDecisions[0].alternatives).toEqual([{ label: "llama / kilo", utility: .82 }]);
    expect(overview.recentDecisions[0].penalties).toContainEqual({ label: "quota scarcity", value: .07 });
    expect(overview.modelUsage).toEqual([{ label: "qwen / groq", value: 100 }]);
  });
});
