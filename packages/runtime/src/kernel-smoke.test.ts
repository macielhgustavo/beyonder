/**
 * v0.7 smoke: Task → Mission lift → budget-backed authority → orchestration.
 * Zero-cost by construction: no model calls, no network, in-memory SQLite.
 */
import { describe, it, expect } from "vitest";
import { openDatabase } from "./db/client.js";
import { BudgetAccountant } from "./economy/budget-accountant.js";
import { resolveComputeEconomy } from "./economy/compute-economy-config.js";
import {
  SqliteMissionStore,
  SqliteMissionEventStore,
  MissionOrchestrator,
  MissionScheduler,
  BudgetBackedResourceAuthority,
  liftTaskToMission
} from "./missions/index.js";
import type { MissionSnapshot } from "./missions/index.js";
import type { IntelligenceTask } from "./intelligence/contracts.js";

describe("v0.7 kernel smoke: full Task → Mission → budget-backed run", () => {
  it("lifts a task, plans, and runs EXECUTE → VERIFY under real budget authority", async () => {
    const client = openDatabase(":memory:");
    const store = new SqliteMissionStore(client.db);
    const events = new SqliteMissionEventStore(client.db);

    const task: IntelligenceTask = {
      id: "smoke-task-1",
      input: "Compile a zero-cost research summary.",
      type: "research",
      complexity: 0.4,
      risk: 0.1,
      estimatedTokens: 800,
      requirements: {}
    };

    // 1. Lift the legacy task into kernel contracts (validated plan).
    const { contract, plan } = liftTaskToMission(task);
    expect(plan.nodes.map((n) => n.kind)).toEqual(["EXECUTE", "VERIFY"]);

    // 2. Persist the mission as a snapshot.
    const snapshot: MissionSnapshot = {
      schemaVersion: 1,
      missionId: contract.id,
      contract,
      planRevision: 1,
      nodes: plan.nodes.map((spec) => ({
        schemaVersion: 1,
        missionId: contract.id,
        id: spec.id,
        spec,
        state: "PENDING",
        attempt: 0
      })),
      state: "READY",
      replans: 0,
      recoveryAttempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await store.create(snapshot);

    const orchestrator = new MissionOrchestrator(events, {
      get: async (id) => store.get(id),
      update: async (m) => { await store.update(m); }
    });
    const scheduler = new MissionScheduler({ maxConcurrency: 1 });

    // 3. Real economy behind the kernel seam (zero-cost mode: nothing spends).
    const accountant = new BudgetAccountant(
      client.sqlite,
      resolveComputeEconomy({ mode: "zero_cost" })
    );
    const authority = new BudgetBackedResourceAuthority(accountant);

    // 4. RUN.
    let current = await orchestrator.transition(snapshot, "RUNNING", {});

    // EXECUTE node.
    const ready = scheduler.pickReadyNodes(current);
    expect(ready.map((n) => n.spec.kind)).toEqual(["EXECUTE"]);
    const decision = await authority.authorize({
      missionId: current.missionId,
      nodeId: ready[0].id,
      kind: "MONEY",
      estimatedAmount: 0
    });
    expect(decision.status).toBe("AUTHORIZED");

    await orchestrator.startNode(current, ready[0].id);
    await orchestrator.completeNode(current, ready[0].id, {
      status: "COMPLETED",
      observationSummary: "Research summary produced.",
      artifactType: "TASK_OUTPUT",
      artifactRef: "memory://smoke/task-output",
      completedAt: new Date().toISOString()
    });

    // VERIFY node.
    const verifyReady = scheduler.pickReadyNodes(current);
    expect(verifyReady.map((n) => n.spec.kind)).toEqual(["VERIFY"]);
    await orchestrator.startNode(current, verifyReady[0].id);
    await orchestrator.completeNode(current, verifyReady[0].id, {
      status: "COMPLETED",
      observationSummary: "Output matches success criteria.",
      evidenceIds: ["ev-smoke-1"],
      completedAt: new Date().toISOString()
    });

    // 5. Terminal state.
    current = await orchestrator.transition(current, "VERIFYING", {});
    current = await orchestrator.transition(current, "SUCCEEDED", {
      satisfiedCriteria: ["task-output-produced"]
    });
    expect(current.state).toBe("SUCCEEDED");
    expect(current.nodes.every((n) => n.state === "COMPLETED")).toBe(true);

    // 6. Audit trail persisted: events replayable.
    const lastSeq = await events.lastSeq(current.missionId);
    expect(lastSeq).toBeGreaterThan(0);
  });
});
