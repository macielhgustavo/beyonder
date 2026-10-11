import { describe, it, expect } from "vitest";
import {
  DefaultMissionRecoveryPolicy,
  type MissionRecoveryRequest
} from "./mission-recovery.js";

function makeRequest(overrides: Partial<MissionRecoveryRequest> = {}): MissionRecoveryRequest {
  return {
    missionId: "mission-1",
    nodeId: "node-1",
    failureClass: "TRANSIENT",
    attempt: 1,
    maxAttempts: 3,
    missionReplans: 0,
    maxMissionReplans: 2,
    detail: "connection timeout",
    ...overrides
  };
}

describe("Mission recovery policy", () => {
  const policy = new DefaultMissionRecoveryPolicy();

  it("POLICY_BLOCK is never bypassed — fails mission", () => {
    const decision = policy.decide(makeRequest({ failureClass: "POLICY_BLOCK" }));
    expect(decision.action).toBe("FAIL_MISSION");
  });

  it("DEADLINE fails the mission", () => {
    const decision = policy.decide(makeRequest({ failureClass: "DEADLINE" }));
    expect(decision.action).toBe("FAIL_MISSION");
  });

  it("APPROVAL_REQUIRED waits for approval", () => {
    const decision = policy.decide(makeRequest({ failureClass: "APPROVAL_REQUIRED" }));
    expect(decision.action).toBe("WAIT_FOR_APPROVAL");
  });

  it("INPUT_REQUIRED waits without failing", () => {
    const decision = policy.decide(makeRequest({ failureClass: "INPUT_REQUIRED" }));
    expect(decision.action).toBe("WAIT_FOR_INPUT");
  });

  it("UNKNOWN_OUTCOME requires reconciliation, never retry", () => {
    const decision = policy.decide(makeRequest({ failureClass: "UNKNOWN_OUTCOME" }));
    expect(decision.action).toBe("RECONCILE_ACTION");
  });

  it("TRANSIENT retries while attempts remain", () => {
    const decision = policy.decide(makeRequest({ failureClass: "TRANSIENT", attempt: 1, maxAttempts: 3 }));
    expect(decision.action).toBe("RETRY_NODE");
  });

  it("attempts exhausted triggers bounded subgraph replan", () => {
    const decision = policy.decide(makeRequest({ failureClass: "TRANSIENT", attempt: 3, maxAttempts: 3 }));
    expect(decision.action).toBe("SUBGRAPH_REPLAN");
  });

  it("replan budget exhausted fails the mission", () => {
    const decision = policy.decide(
      makeRequest({ failureClass: "TRANSIENT", attempt: 3, maxAttempts: 3, missionReplans: 2, maxMissionReplans: 2 })
    );
    expect(decision.action).toBe("FAIL_MISSION");
  });

  it("CAPABILITY_LOSS resolves alternate implementation", () => {
    const decision = policy.decide(makeRequest({ failureClass: "CAPABILITY_LOSS" }));
    expect(decision.action).toBe("RESOLVE_CAPABILITY");
  });

  it("VERIFICATION_FAILURE triggers local repair", () => {
    const decision = policy.decide(makeRequest({ failureClass: "VERIFICATION_FAILURE" }));
    expect(decision.action).toBe("LOCAL_REPAIR");
  });

  it("EXTERNAL_STATE_CHANGED triggers subgraph replan when budget allows", () => {
    const decision = policy.decide(makeRequest({ failureClass: "EXTERNAL_STATE_CHANGED", missionReplans: 0 }));
    expect(decision.action).toBe("SUBGRAPH_REPLAN");
  });

  it("RESOURCE_EXHAUSTED fails the mission", () => {
    const decision = policy.decide(makeRequest({ failureClass: "RESOURCE_EXHAUSTED" }));
    expect(decision.action).toBe("FAIL_MISSION");
  });
});