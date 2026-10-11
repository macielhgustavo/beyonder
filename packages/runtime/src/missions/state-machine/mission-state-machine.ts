import type { MissionState } from "../contracts/mission.js";

export class InvalidMissionStateTransitionError extends Error {
  constructor(readonly from: MissionState, readonly to: MissionState) {
    super(`Invalid mission state transition: ${from} -> ${to}`);
    this.name = "InvalidMissionStateTransitionError";
  }
}

export const TERMINAL_MISSION_STATES = new Set<MissionState>([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED"
]);

/** ADR 0012 invariant 1: terminal missions never return to running. */
const ALLOWED_TRANSITIONS: Record<MissionState, readonly MissionState[]> = {
  CREATED: ["READY", "FAILED", "CANCELLED"],
  READY: ["RUNNING", "PAUSED", "CANCELLED"],
  RUNNING: [
    "RUNNING",
    "WAITING_INPUT",
    "WAITING_APPROVAL",
    "WAITING_RESOURCE",
    "WAITING_EXTERNAL",
    "PAUSED",
    "RECOVERING",
    "REPLANNING",
    "VERIFYING",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED"
  ],
  WAITING_INPUT: ["RUNNING", "PAUSED", "REPLANNING", "FAILED", "CANCELLED"],
  WAITING_APPROVAL: ["RUNNING", "PAUSED", "REPLANNING", "FAILED", "CANCELLED"],
  WAITING_RESOURCE: ["RUNNING", "PAUSED", "REPLANNING", "FAILED", "CANCELLED"],
  WAITING_EXTERNAL: ["RUNNING", "PAUSED", "REPLANNING", "FAILED", "CANCELLED"],
  PAUSED: ["READY", "RUNNING", "CANCELLED"],
  RECOVERING: ["RUNNING", "REPLANNING", "WAITING_RESOURCE", "FAILED", "CANCELLED"],
  REPLANNING: ["READY", "RUNNING", "WAITING_INPUT", "FAILED", "CANCELLED"],
  VERIFYING: ["RUNNING", "REPLANNING", "SUCCEEDED", "FAILED", "CANCELLED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: []
};

export function canTransition(from: MissionState, to: MissionState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertMissionStateTransition(from: MissionState, to: MissionState): void {
  if (!canTransition(from, to)) throw new InvalidMissionStateTransitionError(from, to);
}

export function isTerminalMissionState(state: MissionState): boolean {
  return TERMINAL_MISSION_STATES.has(state);
}
