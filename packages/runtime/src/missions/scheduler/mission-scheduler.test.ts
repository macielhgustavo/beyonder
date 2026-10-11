import { describe, it, expect } from "vitest";
import { ToolRisk, ToolSideEffect } from "@beyonder/tools";
import { MissionScheduler } from "./mission-scheduler.js";
import type { MissionSnapshot, MissionNode, MissionNodeSpec } from "../contracts/mission.js";
import { isTerminalMissionState } from "../state-machine/mission-state-machine.js";

function makeNode(id: string, dependsOn: string[], overrides: Partial<MissionNode> = {}): MissionNode {
  const spec: MissionNodeSpec = {
    id,
    kind: "EXECUTE",
    description: `Node ${id}`,
    dependsOn,
    maxAttempts: 3,
    ...overrides.spec
  };
  return {
    schemaVersion: 1,
    missionId: "mission-1",
    id,
    spec,
    state: "PENDING",
    attempt: 0,
    ...overrides
  };
}

function makeSnapshot(nodes: MissionNode[], state: MissionSnapshot["state"] = "RUNNING"): MissionSnapshot {
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
    nodes,
    state,
    replans: 0,
    recoveryAttempts: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

describe("Mission scheduler", () => {
  it("picks independent root nodes", () => {
    const scheduler = new MissionScheduler();
    const snapshot = makeSnapshot([makeNode("a", []), makeNode("b", []), makeNode("c", ["a"])]);
    const ready = scheduler.pickReadyNodes(snapshot);
    // Sequential: only one at a time
    expect(ready.length).toBe(1);
    expect(["a", "b"]).toContain(ready[0].id);
  });

  it("node with unmet dependencies is not ready", () => {
    const scheduler = new MissionScheduler();
    const snapshot = makeSnapshot([makeNode("a", ["b"]), makeNode("b", ["c"]), makeNode("c", [])]);
    const ready = scheduler.pickReadyNodes(snapshot);
    expect(ready.map((n) => n.id)).toEqual(["c"]);
  });

  it("node becomes ready after dependency completes (invariant 2)", () => {
    const scheduler = new MissionScheduler();
    const a = makeNode("a", []);
    const b = makeNode("b", ["a"]);
    const snapshot = makeSnapshot([a, b]);
    expect(scheduler.pickReadyNodes(snapshot).map((n) => n.id)).toEqual(["a"]);

    scheduler.markNodeCompleted(snapshot, "a", {
      status: "COMPLETED",
      observationSummary: "done",
      completedAt: new Date().toISOString()
    });
    expect(snapshot.nodes.find((n) => n.id === "a")?.state).toBe("COMPLETED");
    expect(scheduler.pickReadyNodes(snapshot).map((n) => n.id)).toEqual(["b"]);
  });

  it("diamond graph: join waits for both branches", () => {
    const scheduler = new MissionScheduler();
    const start = makeNode("start", []);
    const left = makeNode("left", ["start"]);
    const right = makeNode("right", ["start"]);
    const join = makeNode("join", ["left", "right"]);
    const snapshot = makeSnapshot([start, left, right, join]);

    expect(scheduler.pickReadyNodes(snapshot).map((n) => n.id)).toEqual(["start"]);
    scheduler.markNodeCompleted(snapshot, "start", { status: "COMPLETED", observationSummary: "done", completedAt: new Date().toISOString() });
    const branches = scheduler.pickReadyNodes(snapshot);
    expect(branches.length).toBe(1);
    expect(["left", "right"]).toContain(branches[0].id);

    scheduler.markNodeCompleted(snapshot, "left", { status: "COMPLETED", observationSummary: "done", completedAt: new Date().toISOString() });
    // join still not ready — right pending
    expect(scheduler.pickReadyNodes(snapshot).map((n) => n.id)).toEqual(["right"]);
    scheduler.markNodeCompleted(snapshot, "right", { status: "COMPLETED", observationSummary: "done", completedAt: new Date().toISOString() });
    expect(scheduler.pickReadyNodes(snapshot).map((n) => n.id)).toEqual(["join"]);
  });

  it("terminal mission yields no ready nodes (invariant 11)", () => {
    const scheduler = new MissionScheduler();
    for (const state of ["SUCCEEDED", "FAILED", "CANCELLED"] as const) {
      const snapshot = makeSnapshot([makeNode("a", [])], state);
      expect(scheduler.pickReadyNodes(snapshot)).toEqual([]);
    }
  });

  it("waiting mission yields no ready nodes", () => {
    const scheduler = new MissionScheduler();
    const snapshot = makeSnapshot([makeNode("a", [])], "WAITING_INPUT");
    expect(scheduler.pickReadyNodes(snapshot)).toEqual([]);
  });

  it("paused mission yields no ready nodes", () => {
    const scheduler = new MissionScheduler();
    const snapshot = makeSnapshot([makeNode("a", [])], "PAUSED");
    expect(scheduler.pickReadyNodes(snapshot)).toEqual([]);
  });

  it("markNodeFailed records error outcome", () => {
    const scheduler = new MissionScheduler();
    const snapshot = makeSnapshot([makeNode("a", [])]);
    scheduler.markNodeFailed(snapshot, "a", "tool timeout");
    const node = snapshot.nodes.find((n) => n.id === "a");
    expect(node?.state).toBe("FAILED");
    expect(node?.outcome?.error).toBe("tool timeout");
  });

  it("running node blocks further picks at concurrency 1", () => {
    const scheduler = new MissionScheduler();
    const a = makeNode("a", []);
    a.state = "RUNNING";
    const snapshot = makeSnapshot([a, makeNode("b", [])]);
    expect(scheduler.pickReadyNodes(snapshot)).toEqual([]);
  });

  it("respects maxConcurrency > 1", () => {
    const scheduler = new MissionScheduler({ maxConcurrency: 2 });
    const snapshot = makeSnapshot([makeNode("a", []), makeNode("b", []), makeNode("c", [])]);
    expect(scheduler.pickReadyNodes(snapshot).length).toBe(2);
  });

  it("skipped node marks outcome as skipped", () => {
    const scheduler = new MissionScheduler();
    const snapshot = makeSnapshot([makeNode("a", [])]);
    scheduler.markNodeSkipped(snapshot, "a");
    const node = snapshot.nodes.find((n) => n.id === "a");
    expect(node?.state).toBe("SKIPPED");
    expect(node?.outcome?.status).toBe("SKIPPED");
  });
});
