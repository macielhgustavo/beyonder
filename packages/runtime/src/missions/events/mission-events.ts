/**
 * v0.7 Mission events — append-only log (ADR 0007).
 *
 * Events are the source of truth for mission execution history. The
 * materialized MissionSnapshot is rebuilt from events after crashes.
 */
export const MISSION_EVENT_SCHEMA_VERSION = 1;

export type MissionEventType =
  | "MISSION_CREATED"
  | "PLAN_ACCEPTED"
  | "PLAN_REJECTED"
  | "NODE_READY"
  | "NODE_STARTED"
  | "NODE_COMPLETED"
  | "NODE_FAILED"
  | "NODE_SKIPPED"
  | "TOOL_CALLED"
  | "OBSERVATION_RECORDED"
  | "EVIDENCE_ATTACHED"
  | "REPLAN_REQUESTED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_GRANTED"
  | "APPROVAL_REJECTED"
  | "ACTION_INTENT_PERSISTED"
  | "ACTION_COMMITTED"
  | "ACTION_UNKNOWN_OUTCOME"
  | "ACTION_RECEIPT_RECORDED"
  | "ACTION_RECONCILED"
  | "MISSION_PAUSED"
  | "MISSION_RESUMED"
  | "MISSION_INPUT_PROVIDED"
  | "VERIFICATION_STARTED"
  | "VERIFICATION_COMPLETED"
  | "MISSION_STATE_CHANGED"
  | "MISSION_RECOVERED"
  | "MISSION_SUCCEEDED"
  | "MISSION_FAILED"
  | "MISSION_CANCELLED";

export interface MissionEventBase {
  schemaVersion: number;
  /** Per-mission monotonic sequence number, starting at 1. */
  seq: number;
  missionId: string;
  type: MissionEventType;
  recordedAt: string;
}

export interface MissionEvent extends MissionEventBase {
  payload: Record<string, unknown>;
}

/** Idempotent append: (missionId, seq) is the unique key. */
export interface MissionEventStore {
  append(event: MissionEvent): Promise<void>;
  list(missionId: string, afterSeq?: number, limit?: number): Promise<MissionEvent[]>;
  /** Highest seq currently persisted for the mission; 0 when none. */
  lastSeq(missionId: string): Promise<number>;
}
