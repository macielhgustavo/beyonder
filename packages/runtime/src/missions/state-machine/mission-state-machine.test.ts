import { describe, it, expect } from "vitest";
import {
  assertMissionStateTransition,
  canTransition,
  isTerminalMissionState,
  InvalidMissionStateTransitionError,
  type MissionState
} from "./mission-state-machine.js";

describe("Mission state machine", () => {
  it("allows CREATED -> READY", () => {
    expect(canTransition("CREATED", "READY")).toBe(true);
  });

  it("allows READY -> RUNNING", () => {
    expect(canTransition("READY", "RUNNING")).toBe(true);
  });

  it("allows RUNNING -> WAITING_INPUT", () => {
    expect(canTransition("RUNNING", "WAITING_INPUT")).toBe(true);
  });

  it("allows WAITING_INPUT -> RUNNING (input provided)", () => {
    expect(canTransition("WAITING_INPUT", "RUNNING")).toBe(true);
  });

  it("allows RUNNING -> PAUSED and PAUSED -> RUNNING", () => {
    expect(canTransition("RUNNING", "PAUSED")).toBe(true);
    expect(canTransition("PAUSED", "RUNNING")).toBe(true);
  });

  it("allows RUNNING -> VERIFYING -> SUCCEEDED", () => {
    expect(canTransition("RUNNING", "VERIFYING")).toBe(true);
    expect(canTransition("VERIFYING", "SUCCEEDED")).toBe(true);
  });

  it("blocks FAILED -> RUNNING (terminal invariant)", () => {
    expect(canTransition("FAILED", "RUNNING")).toBe(false);
  });

  it("blocks SUCCEEDED -> any state (terminal invariant)", () => {
    for (const target of ["RUNNING", "READY", "PAUSED", "FAILED", "REPLANNING"] as MissionState[]) {
      expect(canTransition("SUCCEEDED", target)).toBe(false);
    }
  });

  it("blocks CANCELLED -> RUNNING (terminal invariant)", () => {
    expect(canTransition("CANCELLED", "RUNNING")).toBe(false);
  });

  it("blocks CREATED -> SUCCEEDED (must verify first)", () => {
    expect(canTransition("CREATED", "SUCCEEDED")).toBe(false);
  });

  it("blocks VERIFYING -> READY (invalid)", () => {
    expect(canTransition("VERIFYING", "READY")).toBe(false);
  });

  it("assertMissionStateTransition throws on invalid transitions", () => {
    expect(() => assertMissionStateTransition("FAILED", "RUNNING")).toThrow(InvalidMissionStateTransitionError);
  });

  it("assertMissionStateTransition does not throw on valid transitions", () => {
    expect(() => assertMissionStateTransition("CREATED", "READY")).not.toThrow();
  });

  it("identifies all terminal states", () => {
    expect(isTerminalMissionState("SUCCEEDED")).toBe(true);
    expect(isTerminalMissionState("FAILED")).toBe(true);
    expect(isTerminalMissionState("CANCELLED")).toBe(true);
    expect(isTerminalMissionState("RUNNING")).toBe(false);
    expect(isTerminalMissionState("PAUSED")).toBe(false);
  });
});