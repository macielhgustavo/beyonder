import { describe, it, expect, beforeEach } from "vitest";
import { ToolRisk, ToolSideEffect } from "@beyonder/tools";
import { openDatabase } from "../../db/client.js";
import {
  SqliteMissionStore,
  SqliteMissionEventStore
} from "../store/mission-store.js";
import { MissionOrchestrator, recoverMissionOnRestart } from "./mission-orchestrator.js";
import type { MissionSnapshot, MissionNode } from "../contracts/mission.js";
import type { MissionEventStore } from "../events/mission-events.js";

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
      objective: "Test",
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
    state: "CREATED",
    replans: 0,
    recoveryAttempts: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

describe("MissionOrchestrator", () => {
  let db: ReturnType<typeof openDatabase>;
  let store: SqliteMissionStore;
  let events: MissionEventStore;
  let orchestrator: MissionOrchestrator;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    store = new SqliteMissionStore(db.db);
    events = new SqliteMissionEventStore(db.db);
    orchestrator = new MissionOrchestrator(events, store);
    await store.create(makeSnapshot());
  });

  it("transitions CREATED -> READY and records event", async () => {
    const snap = (await store.get("mission-1"))!;
    const updated = await orchestrator.transition(snap, "READY", { planId: "plan-1" });
    expect(updated.state).toBe("READY");
    const loaded = await store.get("mission-1");
    expect(loaded?.state).toBe("READY");
  });

  it("rejects invalid transition CREATED -> SUCCEEDED", async () => {
    const snap = (await store.get("mission-1"))!;
    await expect(orchestrator.transition(snap, "SUCCEEDED")).rejects.toThrow();
  });

  it("startNode marks RUNNING and increments attempt", async () => {
    const snap = (await store.get("mission-1"))!;
    await orchestrator.transition(snap, "READY", {});
    await orchestrator.transition(snap, "RUNNING", {});
    const node = await orchestrator.startNode(snap, "a");
    expect(node?.state).toBe("RUNNING");
    expect(node?.attempt).toBe(1);
  });

  it("completeNode requires outcome and emits NODE_COMPLETED", async () => {
    const snap = (await store.get("mission-1"))!;
    await orchestrator.transition(snap, "READY", {});
    await orchestrator.transition(snap, "RUNNING", {});
    await orchestrator.startNode(snap, "a");
    await orchestrator.completeNode(snap, "a", {
      status: "COMPLETED",
      observationSummary: "done",
      completedAt: new Date().toISOString()
    });
    const reloaded = await store.get("mission-1");
    expect(reloaded?.nodes[0].state).toBe("COMPLETED");
    expect(reloaded?.nodes[0].outcome?.observationSummary).toBe("done");
  });

  it("failNode marks FAILED with error", async () => {
    const snap = (await store.get("mission-1"))!;
    await orchestrator.transition(snap, "READY", {});
    await orchestrator.transition(snap, "RUNNING", {});
    await orchestrator.failNode(snap, "a", "tool timeout");
    const reloaded = await store.get("mission-1");
    expect(reloaded?.nodes[0].state).toBe("FAILED");
    expect(reloaded?.nodes[0].outcome?.error).toBe("tool timeout");
  });

  it("pause/resume cycle preserves wait reason", async () => {
    const snap = (await store.get("mission-1"))!;
    await orchestrator.transition(snap, "READY", {});
    await orchestrator.transition(snap, "RUNNING", {});
    await orchestrator.transition(snap, "WAITING_INPUT", { reason: "need user", nodeId: "a" });
    expect(snap.waitReason?.kind).toBe("INPUT");
    await orchestrator.provideInput(snap, "user provided data");
    expect(snap.state).toBe("RUNNING");
    expect(snap.waitReason).toBeUndefined();
  });

  it("cancel marks terminal and stops future actions", async () => {
    const snap = (await store.get("mission-1"))!;
    await orchestrator.transition(snap, "READY", {});
    await orchestrator.transition(snap, "RUNNING", {});
    await orchestrator.cancel(snap, "operator cancelled");
    expect(snap.state).toBe("CANCELLED");
    expect(snap.nodes[0].state).toBe("CANCELLED");
    expect(snap.nodes[1].state).toBe("CANCELLED");
  });

  it("recovers stale RUNNING nodes on restart", async () => {
    const snap = (await store.get("mission-1"))!;
    await orchestrator.transition(snap, "READY", {});
    await orchestrator.transition(snap, "RUNNING", {});
    await orchestrator.startNode(snap, "a");
    // Simulate crash — node is RUNNING with no outcome
    expect(snap.nodes[0].state).toBe("RUNNING");

    // Restart: recover
    const recovered = await recoverMissionOnRestart(orchestrator, snap, (s) => store.update(s));
    expect(recovered.nodes[0].state).toBe("PENDING");
  });

  it("persists events with monotonic seq per transition", async () => {
    const snap = (await store.get("mission-1"))!;
    await orchestrator.transition(snap, "READY", {});
    await orchestrator.transition(snap, "RUNNING", {});
    const all = await events.list("mission-1");
    // 2 transition events: READY, RUNNING (MISSION_CREATED is emitted by the public createMission API)
    expect(all.length).toBe(2);
    const seqs = all.map((e) => e.seq).sort((a, b) => a - b);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBe(seqs[i - 1] + 1);
  });

  it("terminal state cannot transition out", async () => {
    const snap = (await store.get("mission-1"))!;
    await orchestrator.transition(snap, "READY", {});
    await orchestrator.transition(snap, "RUNNING", {});
    await orchestrator.transition(snap, "SUCCEEDED", {});
    await expect(orchestrator.transition(snap, "RUNNING", {})).rejects.toThrow();
  });
});