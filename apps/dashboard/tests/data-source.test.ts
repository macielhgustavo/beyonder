import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EmptyDashboardDataSource } from "../data/empty";
import { LocalDashboardDataSource } from "../data/local";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("Control Center data source", () => {
  it("renders useful empty state without runtime data", async () => {
    const source = new EmptyDashboardDataSource();
    const home = await source.getHome();
    expect(home.status.global).toBe("OFFLINE");
    expect(home.firstRun).toBe(true);
    expect(await source.getTasks()).toEqual([]);
    expect(await source.getApprovals()).toEqual([]);
  });

  it("reads local runtime views and redacts sensitive values", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "beyonder-control-center-"));
    const dbPath = path.join(dir, "runtime.sqlite");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE memories (id TEXT PRIMARY KEY, kind TEXT NOT NULL, content TEXT NOT NULL, importance INTEGER NOT NULL, confidence REAL NOT NULL, utility REAL NOT NULL, created_at TEXT NOT NULL, last_accessed_at TEXT, access_count INTEGER NOT NULL, source TEXT, task_id TEXT, keywords TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}');
      CREATE TABLE audit_events (id TEXT PRIMARY KEY, level TEXT NOT NULL, event TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE ledger_entries (id TEXT PRIMARY KEY, type TEXT NOT NULL, amount_usd REAL NOT NULL, description TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
    `);
    insertState(db, "control-center:state", { paused: false, developerMode: false, firstRunComplete: true, lastHeartbeatAt: new Date().toISOString(), currentActivity: null });
    insertState(db, "control-center:tasks:index", ["exec_1"]);
    insertState(db, "control-center:task:exec_1", {
      id: "exec_1",
      state: "COMPLETED",
      task: { id: "task_1" },
      plan: { objective: "Find build number", steps: [{ description: "Read page", status: "COMPLETED" }] },
      usage: { monetaryCostUsd: 0, shadowCostUsd: 0.01, durationMs: 8000 },
      result: "4821",
      startedAt: "2026-10-03T00:00:00Z",
      completedAt: "2026-10-03T00:00:08Z",
      steps: []
    });
    insertState(db, "task-attempts:task_1", [
      { phase: "DIRECT_RESPONSE", provider: "groq", model: "remote-model", status: "FAILED", failureClass: "RATE_LIMITED", monetaryCostUsd: 0, shadowCostUsd: 0 },
      { phase: "DIRECT_RESPONSE", provider: "deterministic", model: "tool-result-format", status: "SUCCEEDED", monetaryCostUsd: 0, shadowCostUsd: 0 }
    ]);
    insertState(db, "opportunities:index", ["opp_1"]);
    insertState(db, "opportunity:item:opp_1", {
      id: "opp_1",
      title: "Fix parser",
      source: "fixture",
      status: "REQUIRES_APPROVAL",
      reward: { type: "FIXED", amount: 25, currency: "USD" },
      metadata: { evaluation: { decision: "REQUIRES_APPROVAL", estimatedSuccessProbability: .82, estimatedMonetaryCostUsd: 0, riskScore: .2, confidence: .8, reasons: ["external, identity, payment, account, or capital action requires approval"] } }
    });
    insertState(db, "approvals:index", ["approval_1"]);
    insertState(db, "approval:approval_1", { approvalId: "approval_1", opportunityId: "opp_1", action: "APPLY_TO_OPPORTUNITY", summary: "Apply", destination: "fixture", payloadPreview: "token=secret-token", risks: ["external action"], createdAt: "2026-10-03T00:01:00Z", status: "PENDING" });
    db.prepare("INSERT INTO memories VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("m1", "economic", "api_key=should-not-leak", 5, .9, .8, "2026-10-03T00:00:00Z", null, 1, "runtime", null, "[\"cost\"]", "{}");
    db.prepare("INSERT INTO audit_events VALUES (?, ?, ?, ?, ?)").run("a1", "info", "approval.requested", JSON.stringify({ token: "secret-token" }), "2026-10-03T00:01:00Z");
    db.close();

    const source = new LocalDashboardDataSource(dbPath, path.join(dir, "providers.json"));
    const home = await source.getHome();
    expect(home.status.global).toBe("WAITING_FOR_YOU");
    expect(home.healthChecks.find((check) => check.label === "Compute")).toMatchObject({ status: "warn", detail: expect.stringContaining("nenhuma inferência foi verificada") });
    expect((await source.getProviders()).filter((provider) => provider.status === "KEYLESS")).toEqual(expect.arrayContaining([expect.objectContaining({ verified: false, health: null })]));
    expect((await source.getTasks())[0]).toMatchObject({ result: "4821", provider: "deterministic", model: "tool-result-format" });
    expect((await source.getOpportunities())[0].rewardLabel).toBe("$25.00");
    expect((await source.getApprovals())[0].payloadPreview).toContain("[REDACTED]");
    expect((await source.getMemories())[0].content).toContain("[REDACTED]");
    expect(JSON.stringify((await source.getAuditEvents())[0].details)).not.toContain("secret-token");
  });
});

function insertState(db: Database.Database, key: string, value: unknown) {
  db.prepare("INSERT INTO state VALUES (?, ?, ?)").run(key, JSON.stringify(value), new Date().toISOString());
}
