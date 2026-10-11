import { nanoid } from "nanoid";
import type { MissionEvent, MissionEventStore } from "../events/mission-events.js";
import type {
  MissionSnapshot,
  MissionState,
  MissionNode,
  MissionNodeOutcome
} from "../contracts/mission.js";
import {
  assertMissionStateTransition,
  isTerminalMissionState
} from "../state-machine/mission-state-machine.js";

/**
 * Orchestrates mission state mutations with crash-safe, transactional
 * event+snapshot updates (ADR 0007, ADR 0012).
 *
 * Every mutation follows the same protocol:
 * 1. validate the transition against the state machine
 * 2. append the event (idempotent by missionId+seq)
 * 3. update the materialized snapshot
 * 4. persist the snapshot
 *
 * The model layer never calls these methods directly; only the runtime
 * orchestrator does (ADR 0010).
 */
export interface MissionEventRecorder {
  record(event: MissionEvent): Promise<void>;
  nextSeq(missionId: string): Promise<number>;
}

export class MissionOrchestrator {
  constructor(
    private readonly events: MissionEventStore,
    private readonly snapshots: {
      get(missionId: string): Promise<MissionSnapshot | undefined>;
      update(mission: MissionSnapshot): Promise<void>;
    },
    private readonly now: () => Date = () => new Date()
  ) {}

  async nextSeq(missionId: string): Promise<number> {
    return (await this.events.lastSeq(missionId)) + 1;
  }

  /** Transition the mission state machine, appending the event first. */
  async transition(snapshot: MissionSnapshot, to: MissionState, payload: Record<string, unknown> = {}): Promise<MissionSnapshot> {
    if (snapshot.state === to) return snapshot;
    assertMissionStateTransition(snapshot.state, to);
    const previous = snapshot.state;

    const seq = await this.nextSeq(snapshot.missionId);
    const event: MissionEvent = {
      schemaVersion: 1,
      seq,
      missionId: snapshot.missionId,
      type: "MISSION_STATE_CHANGED",
      recordedAt: this.now().toISOString(),
      payload: { from: previous, to, ...payload }
    };
    await this.events.append(event);

    snapshot.state = to;
    snapshot.updatedAt = this.now().toISOString();
    if (isTerminalMissionState(to)) {
      snapshot.completedAt = this.now().toISOString();
    }
    if (to === "WAITING_INPUT" || to === "WAITING_APPROVAL" || to === "WAITING_RESOURCE" || to === "WAITING_EXTERNAL") {
      snapshot.waitReason = {
        kind: to === "WAITING_INPUT" ? "INPUT" : to === "WAITING_APPROVAL" ? "APPROVAL" : to === "WAITING_RESOURCE" ? "RESOURCE" : "EXTERNAL",
        detail: String(payload.reason ?? "waiting"),
        nodeId: typeof payload.nodeId === "string" ? payload.nodeId : undefined,
        since: this.now().toISOString()
      };
    } else {
      snapshot.waitReason = undefined;
    }
    await this.snapshots.update(snapshot);
    return snapshot;
  }

  async emit(snapshot: MissionSnapshot, type: MissionEvent["type"], payload: Record<string, unknown> = {}): Promise<void> {
    const seq = await this.nextSeq(snapshot.missionId);
    await this.events.append({
      schemaVersion: 1,
      seq,
      missionId: snapshot.missionId,
      type,
      recordedAt: this.now().toISOString(),
      payload
    });
  }

  /** Node start — crash before this event means the node never ran. */
  async startNode(snapshot: MissionSnapshot, nodeId: string): Promise<MissionNode | undefined> {
    const node = snapshot.nodes.find((n) => n.id === nodeId);
    if (!node) return undefined;
    node.state = "RUNNING";
    node.attempt += 1;
    await this.emit(snapshot, "NODE_STARTED", { nodeId, attempt: node.attempt });
    await this.snapshots.update(snapshot);
    return node;
  }

  /** Node completion requires a persisted outcome (invariant 3). */
  async completeNode(snapshot: MissionSnapshot, nodeId: string, outcome: MissionNodeOutcome): Promise<void> {
    const node = snapshot.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    node.state = "COMPLETED";
    node.outcome = outcome;
    await this.emit(snapshot, "NODE_COMPLETED", { nodeId, observation: outcome.observationSummary });
    await this.snapshots.update(snapshot);
  }

  async failNode(snapshot: MissionSnapshot, nodeId: string, error: string): Promise<void> {
    const node = snapshot.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    node.state = "FAILED";
    node.outcome = { status: "FAILED", observationSummary: error, error, completedAt: this.now().toISOString() };
    await this.emit(snapshot, "NODE_FAILED", { nodeId, error });
    await this.snapshots.update(snapshot);
  }

  async skipNode(snapshot: MissionSnapshot, nodeId: string, reason: string): Promise<void> {
    const node = snapshot.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    node.state = "SKIPPED";
    node.outcome = { status: "SKIPPED", observationSummary: reason, completedAt: this.now().toISOString() };
    await this.emit(snapshot, "NODE_SKIPPED", { nodeId, reason });
    await this.snapshots.update(snapshot);
  }

  async pause(snapshot: MissionSnapshot, reason: string): Promise<MissionSnapshot> {
    return this.transition(snapshot, "PAUSED", { reason });
  }

  async resume(snapshot: MissionSnapshot): Promise<MissionSnapshot> {
    assertMissionStateTransition(snapshot.state, "RUNNING");
    await this.emit(snapshot, "MISSION_RESUMED", {});
    return this.transition(snapshot, "RUNNING", {});
  }

  /** Invariant 11: cancelled missions start no new actions; scheduler blocks on terminal state. */
  async cancel(snapshot: MissionSnapshot, reason: string): Promise<MissionSnapshot> {
    if (isTerminalMissionState(snapshot.state)) return snapshot;
    const result = await this.transition(snapshot, "CANCELLED", { reason });
    for (const node of snapshot.nodes) {
      if (node.state === "PENDING" || node.state === "READY" || node.state === "WAITING") {
        node.state = "CANCELLED";
      }
    }
    await this.emit(snapshot, "MISSION_CANCELLED", { reason });
    await this.snapshots.update(snapshot);
    return result;
  }

  async provideInput(snapshot: MissionSnapshot, input: string): Promise<MissionSnapshot> {
    if (snapshot.state !== "WAITING_INPUT") {
      throw new Error(`Mission is not waiting for input (state: ${snapshot.state}).`);
    }
    await this.emit(snapshot, "MISSION_INPUT_PROVIDED", { input });
    return this.transition(snapshot, "RUNNING", { input });
  }
}

/**
 * Restart recovery (ADR 0012): rebuild materialized state and resolve
 * stale RUNNING nodes. Called once on process startup for each
 * non-terminal mission.
 */
export async function recoverMissionOnRestart(
  orchestrator: MissionOrchestrator,
  snapshot: MissionSnapshot,
  persist: (snapshot: MissionSnapshot) => Promise<void>
): Promise<MissionSnapshot> {
  // Stale RUNNING nodes: no node completion without a persisted outcome,
  // so any RUNNING node at restart is treated as a failed attempt that
  // will be re-queued by the scheduler if attempts remain.
  for (const node of snapshot.nodes) {
    if (node.state === "RUNNING") {
      node.state = "PENDING";
      await orchestrator.emit(snapshot, "MISSION_RECOVERED", {
        nodeId: node.id,
        detail: "stale RUNNING node reset to PENDING on restart"
      });
    }
  }

  if (snapshot.state === "RUNNING" || snapshot.state === "RECOVERING") {
    await orchestrator.emit(snapshot, "MISSION_RECOVERED", { detail: "restart recovery" });
  } else if (snapshot.state === "PAUSED" || snapshot.state.startsWith("WAITING")) {
    // Long pauses survive restarts; wait reason is persisted.
  }

  await persist(snapshot);
  return snapshot;
}
