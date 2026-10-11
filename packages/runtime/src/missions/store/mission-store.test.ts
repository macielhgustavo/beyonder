import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";
import { openDatabase } from "../../db/client.js";
import { ToolRisk, ToolSideEffect } from "@beyonder/tools";
import {
  SqliteMissionStore,
  SqliteMissionEventStore,
  SqliteEvidenceStore,
  SqliteActionStore
} from "./mission-store.js";
import type { MissionSnapshot, MissionNode } from "../contracts/mission.js";
import type { MissionEvent } from "../events/mission-events.js";
import type { EvidenceRecord } from "../evidence/evidence.js";
import type { ActionIntent, ActionReceipt } from "../actions/action-protocol.js";
import { evidenceFromBrowserCapture } from "../evidence/evidence.js";

function makeNode(id: string, dependsOn: string[] = []): MissionNode {
  return {
    schemaVersion: 1,
    missionId: "mission-1",
    id,
    spec: { id, kind: "EXECUTE", description: `Node ${id}`, dependsOn, maxAttempts: 3 },
    state: "PENDING",
    attempt: 0
  };
}

function makeSnapshot(): MissionSnapshot {
  return {
    schemaVersion: 1,
    missionId: "mission-1",
    contract: {
      schemaVersion: 1,
      id: "mission-1",
      objective: "Test mission",
      successCriteria: [],
      constraints: {
        maxNodeAttempts: 3,
        maxMissionReplans: 2,
        maxRecoveryAttempts: 3,
        maxSideEffectLevel: ToolSideEffect.EXTERNAL_ACTION,
        maxRiskLevel: ToolRisk.HIGH
      },
      autonomyLevel: "BOUNDED_AUTONOMOUS",
      origin: { kind: "USER" },
      createdAt: new Date().toISOString()
    },
    planRevision: 1,
    nodes: [makeNode("a"), makeNode("b", ["a"])],
    state: "RUNNING",
    replans: 0,
    recoveryAttempts: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

describe("Mission persistence (SQLite, in-memory)", () => {
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  describe("SqliteMissionStore", () => {
    it("creates and retrieves a mission snapshot", async () => {
      const store = new SqliteMissionStore(db.db);
      const snapshot = makeSnapshot();
      await store.create(snapshot);
      const loaded = await store.get("mission-1");
      expect(loaded).toBeDefined();
      expect(loaded?.missionId).toBe("mission-1");
      expect(loaded?.nodes.length).toBe(2);
      expect(loaded?.nodes[1].spec.dependsOn).toEqual(["a"]);
    });

    it("updates node state and persists outcomes", async () => {
      const store = new SqliteMissionStore(db.db);
      const snapshot = makeSnapshot();
      await store.create(snapshot);

      snapshot.nodes[0].state = "COMPLETED";
      snapshot.nodes[0].outcome = {
        status: "COMPLETED",
        observationSummary: "finished",
        completedAt: new Date().toISOString()
      };
      await store.update(snapshot);

      const reloaded = await store.get("mission-1");
      expect(reloaded?.nodes[0].state).toBe("COMPLETED");
      expect(reloaded?.nodes[0].outcome?.observationSummary).toBe("finished");
    });

    it("lists missions", async () => {
      const store = new SqliteMissionStore(db.db);
      await store.create(makeSnapshot());
      const all = await store.list();
      expect(all.length).toBe(1);
      expect(all[0].missionId).toBe("mission-1");
    });

    it("returns undefined for missing mission", async () => {
      const store = new SqliteMissionStore(db.db);
      expect(await store.get("nonexistent")).toBeUndefined();
    });
  });

  describe("SqliteMissionEventStore", () => {
    let store: SqliteMissionEventStore;

    beforeEach(async () => {
      await new SqliteMissionStore(db.db).create(makeSnapshot());
      store = new SqliteMissionEventStore(db.db);
    });

    it("appends events with monotonic seq and lists them in order", async () => {
      const events: MissionEvent[] = [
        { schemaVersion: 1, seq: 1, missionId: "mission-1", type: "MISSION_CREATED", recordedAt: new Date().toISOString(), payload: {} },
        { schemaVersion: 1, seq: 2, missionId: "mission-1", type: "NODE_STARTED", recordedAt: new Date().toISOString(), payload: { nodeId: "a" } },
        { schemaVersion: 1, seq: 3, missionId: "mission-1", type: "NODE_COMPLETED", recordedAt: new Date().toISOString(), payload: { nodeId: "a" } }
      ];
      for (const event of events) await store.append(event);

      const listed = await store.list("mission-1");
      expect(listed.map((e) => e.type)).toEqual(["MISSION_CREATED", "NODE_STARTED", "NODE_COMPLETED"]);
      expect(await store.lastSeq("mission-1")).toBe(3);
    });

    it("duplicate (missionId, seq) insert is idempotent", async () => {
      const event: MissionEvent = {
        schemaVersion: 1, seq: 1, missionId: "mission-1", type: "MISSION_CREATED",
        recordedAt: new Date().toISOString(), payload: {}
      };
      await store.append(event);
      await store.append(event); // same seq — must not throw or duplicate
      const listed = await store.list("mission-1");
      expect(listed.length).toBe(1);
    });

    it("list with afterSeq returns only newer events", async () => {
      // seq 1 already used by first test — use 2..6
      for (let seq = 2; seq <= 6; seq++) {
        await store.append({ schemaVersion: 1, seq, missionId: "mission-1", type: "OBSERVATION_RECORDED", recordedAt: new Date().toISOString(), payload: {} });
      }
      const recent = await store.list("mission-1", 3);
      expect(recent.map((e) => e.seq)).toEqual([4, 5, 6]);
    });
  });

  describe("SqliteEvidenceStore", () => {
    it("attaches and lists evidence by mission", async () => {
      const missionStore = new SqliteMissionStore(db.db);
      await missionStore.create(makeSnapshot());
      const store = new SqliteEvidenceStore(db.db);

      const evidence = evidenceFromBrowserCapture({
        missionId: "mission-1",
        nodeId: "a",
        url: "https://example.com",
        excerpt: "key fact",
        fullContent: "full page"
      });
      await store.attach(evidence);

      const listed = await store.listByMission("mission-1");
      expect(listed.length).toBe(1);
      expect(listed[0].evidenceKind).toBe("BROWSER_CAPTURE");
      expect(listed[0].provenance.kind).toBe("BROWSER");
      expect(await store.get(evidence.id)).toBeDefined();
    });

    it("relates claims to evidence", async () => {
      const missionStore = new SqliteMissionStore(db.db);
      await missionStore.create(makeSnapshot());
      const evidenceStore = new SqliteEvidenceStore(db.db);
      const evidence = evidenceFromBrowserCapture({
        missionId: "mission-1",
        url: "https://example.com",
        excerpt: "claim support",
        fullContent: "full"
      });
      await evidenceStore.attach(evidence);

      await evidenceStore.relateClaim({
        missionId: "mission-1",
        claimId: "claim-1",
        claim: "The service supports API access",
        evidenceId: evidence.id,
        relation: "SUPPORTED",
        assessedAt: new Date().toISOString()
      });

      const relations = await evidenceStore.claimRelations("mission-1", "claim-1");
      expect(relations.length).toBe(1);
      expect(relations[0].relation).toBe("SUPPORTED");
    });
  });

  describe("SqliteActionStore", () => {
    it("persists intent before commit and receipt after (ADR 0009)", async () => {
      const missionStore = new SqliteMissionStore(db.db);
      await missionStore.create(makeSnapshot());
      const store = new SqliteActionStore(db.db);

      const intent: ActionIntent = {
        schemaVersion: 1,
        id: "intent-1",
        missionId: "mission-1",
        nodeId: "a",
        what: "Submit application",
        why: "Mission objective requires applying",
        target: "https://jobs.example.com/apply",
        parameters: { coverLetter: "..." },
        idempotencyKey: "mission-1:a:apply",
        risk: ToolRisk.HIGH,
        sideEffectLevel: "EXTERNAL_ACTION",
        requiresApproval: true,
        approvalActionType: "APPLY_TO_OPPORTUNITY",
        createdAt: new Date().toISOString()
      };
      await store.saveIntent(intent);
      expect(await store.getIntent("intent-1")).toBeDefined();

      const receipt: ActionReceipt = {
        schemaVersion: 1,
        id: "receipt-1",
        actionIntentId: "intent-1",
        provider: "browser",
        externalId: "ext-123",
        state: "COMMITTED",
        committedAt: new Date().toISOString(),
        observedEffect: "Application submitted"
      };
      await store.saveReceipt(receipt);

      const receipts = await store.listReceiptsByIntent("intent-1");
      expect(receipts.length).toBe(1);
      expect(receipts[0].state).toBe("COMMITTED");
    });

    it("idempotency key uniqueness rejects duplicate intents", async () => {
      const missionStore = new SqliteMissionStore(db.db);
      await missionStore.create(makeSnapshot());
      const store = new SqliteActionStore(db.db);

      const base: ActionIntent = {
        schemaVersion: 1,
        id: "intent-1",
        missionId: "mission-1",
        nodeId: "a",
        what: "x", why: "y", target: "z",
        parameters: {},
        idempotencyKey: "same-key",
        risk: "LOW",
        sideEffectLevel: "WRITE",
        requiresApproval: false,
        createdAt: new Date().toISOString()
      };
      await store.saveIntent(base);
      // Same idempotency key with a different id must be rejected by SQLite unique constraint
      await expect(store.saveIntent({ ...base, id: "intent-2" })).rejects.toThrow();
    });

    it("lists intents by mission", async () => {
      const missionStore = new SqliteMissionStore(db.db);
      await missionStore.create(makeSnapshot());
      const store = new SqliteActionStore(db.db);
      const intent: ActionIntent = {
        schemaVersion: 1,
        id: "intent-1",
        missionId: "mission-1",
        nodeId: "a",
        what: "x", why: "y", target: "z",
        parameters: { k: "v" },
        idempotencyKey: "key-1",
        risk: "LOW",
        sideEffectLevel: "READ",
        requiresApproval: false,
        createdAt: new Date().toISOString()
      };
      await store.saveIntent(intent);
      const intents = await store.listIntentsByMission("mission-1");
      expect(intents.length).toBe(1);
      expect(intents[0].parameters).toEqual({ k: "v" });
    });
  });
});
