import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EmptyDashboardDataSource } from "../data/empty";
import { LocalDashboardDataSource, resolveBenchmarkDbPath } from "../data/local";

let dir: string | undefined;
afterEach(() => {
  vi.unstubAllEnvs();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("Control Center data source", () => {
  it("aggregates all durable missions beyond the display page without deriving historical evidence or double-counting checkpoints", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "beyonder-mission-aggregates-"));
    const dbPath = path.join(dir, "runtime.sqlite"), db = new Database(dbPath), today = new Date().toISOString();
    db.exec("CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)");
    const ids: string[] = [];
    for (let i = 0; i < 230; i++) {
      const id = `exec_${i}`; ids.push(id);
      const execution = { id, task: { id: `task_${i}` }, state: "COMPLETED", objectiveStatus: "SUCCEEDED", startedAt: today, completedAt: today, usage: { shadowCostUsd: 0.01 }, plan: { steps: [] } };
      insertState(db, `control-center:task:${id}`, execution);
      if (i > 200) insertState(db, `task-checkpoint:task_${i}`, { version: 1, execution });
    }
    insertState(db, "control-center:tasks:index", ids);
    db.close();
    const source = new LocalDashboardDataSource(dbPath, path.join(dir, "absent-providers.json"));
    const projection = vi.spyOn(source, "getTasks").mockRejectedValue(new Error("Accounting must not render historical browser evidence"));
    expect((await source.getEconomySummary()).shadowCostUsd).toBeCloseTo(2.3);
    projection.mockRestore();
    expect((await source.getHome()).today.completedTasks).toBe(230);
    expect(await source.getTasks({ offset: 225, limit: 20 })).toHaveLength(5);
  });
  it("keeps inference health unknown when only a public model catalog was validated", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "beyonder-catalog-only-"));
    const providerPath = path.join(dir, "providers.json"), now = new Date().toISOString();
    writeFileSync(providerPath, JSON.stringify({ version: 1, updatedAt: now, providers: { "kilo-gateway": { providerId: "kilo-gateway", state: "READY", classification: "KEYLESS", attempts: 1, lastUpdatedAt: now, validation: { status: "validated", models: ["stepfun/step-3.7-flash:free"] } } } }));
    const provider = (await new LocalDashboardDataSource(path.join(dir, "absent.sqlite"), providerPath).getProviders()).find(provider => provider.id === "kilo-gateway");
    expect(provider).toMatchObject({ configured: true, verified: false, health: null, runway: { state: "UNKNOWN" } });
  });
  it("uses the installation BIB from both dashboard and CLI working directories", () => {
    vi.stubEnv("BEYONDER_REPO_ROOT", "/installation/beyonder");
    vi.stubEnv("BEYONDER_BENCHMARK_DB_PATH", "./data/observed.sqlite");
    expect(resolveBenchmarkDbPath()).toBe("/installation/beyonder/data/observed.sqlite");
    vi.stubEnv("BEYONDER_BENCHMARK_DB_PATH", "/evidence/observed.sqlite");
    expect(resolveBenchmarkDbPath()).toBe("/evidence/observed.sqlite");
  });

  it("retrieves a persisted mission beyond the first 200 without projecting history or a stale queued identity", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "beyonder-mission-history-"));
    const dbPath = path.join(dir, "runtime.sqlite"), db = new Database(dbPath);
    db.exec("CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)");
    const ids = [];
    for (let i = 0; i < 215; i++) {
      const id = `exec_${i}`; ids.push(id);
      insertState(db, `control-center:task:${id}`, { id, task: { id: `task_${i}` }, state: "COMPLETED", objectiveStatus: "SUCCEEDED", result: `answer ${i}`, startedAt: new Date(1000 + i).toISOString(), completedAt: new Date(2000 + i).toISOString(), usage: {}, plan: { steps: [] } });
    }
    insertState(db, "control-center:tasks:index", ids);
    db.prepare("INSERT INTO state VALUES (?, ?, ?)").run("control-center:task:task_0", JSON.stringify({ id: "task_0", task: { id: "task_0" }, state: "PLANNING", startedAt: new Date(1000).toISOString() }), "2000-01-01T00:00:00Z");
    db.close();
    const source = new LocalDashboardDataSource(dbPath);
    expect((await source.getTasks({ limit: 1 }))[0].taskId).toBe("task_214");
    expect(await source.getTask("task_0")).toMatchObject({ taskId: "task_0", result: "answer 0", resultVerified: true, objectiveStatus: "SUCCEEDED" });
  });
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
      steps: [
        { stepId: "read", status: "COMPLETED", toolCall: { tool: "browser.extractText" }, toolResult: { success: true, sideEffects: ["READ"] } },
        { stepId: "respond", status: "COMPLETED" }
      ]
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
    expect((await source.getTasks())[0]).toMatchObject({ result: "4821", provider: "deterministic", model: "tool-result-format", tool: "browser.extractText" });
    expect((await source.getOpportunities())[0].rewardLabel).toBe("$25.00");
    expect((await source.getApprovals())[0].payloadPreview).toContain("[REDACTED]");
    expect((await source.getMemories())[0].content).toContain("[REDACTED]");
    expect(JSON.stringify((await source.getAuditEvents())[0].details)).not.toContain("secret-token");
  });
});

function insertState(db: Database.Database, key: string, value: unknown) {
  db.prepare("INSERT INTO state VALUES (?, ?, ?)").run(key, JSON.stringify(value), new Date().toISOString());
}
