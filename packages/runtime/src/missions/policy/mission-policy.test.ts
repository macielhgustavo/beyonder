import { describe, it, expect } from "vitest";
import { MissionPolicyEngine } from "./mission-policy.js";
import { ToolRisk, ToolSideEffect } from "@beyonder/tools";
import type { MissionContract, MissionNode, MissionNodeAction } from "../contracts/mission.js";

function makeContract(overrides: Partial<MissionContract["constraints"]> = {}, autonomyLevel: MissionContract["autonomyLevel"] = "BOUNDED_AUTONOMOUS"): MissionContract {
  return {
    schemaVersion: 1,
    id: "mission-1",
    objective: "Test",
    successCriteria: [],
    constraints: {
      maxNodeAttempts: 3,
      maxMissionReplans: 2,
      maxRecoveryAttempts: 3,
      maxSideEffectLevel: ToolSideEffect.EXTERNAL_ACTION,
      maxRiskLevel: ToolRisk.HIGH,
      ...overrides
    },
    autonomyLevel,
    origin: { kind: "USER" },
    createdAt: new Date().toISOString()
  };
}

function makeNode(id = "node-1"): MissionNode {
  return {
    schemaVersion: 1,
    missionId: "mission-1",
    id,
    spec: { id, kind: "EXECUTE", description: "x", dependsOn: [], maxAttempts: 3 },
    state: "PENDING",
    attempt: 0
  };
}

const resolver = (capabilityId: string) => {
  const capabilities: Record<string, { risk: ToolRisk; sideEffectLevel: ToolSideEffect; requiresApproval: boolean }> = {
    "web.read": { risk: ToolRisk.LOW, sideEffectLevel: ToolSideEffect.READ, requiresApproval: false },
    "form.submit": { risk: ToolRisk.MEDIUM, sideEffectLevel: ToolSideEffect.EXTERNAL_ACTION, requiresApproval: true },
    "payment.send": { risk: ToolRisk.CRITICAL, sideEffectLevel: ToolSideEffect.FINANCIAL, requiresApproval: true }
  };
  return capabilities[capabilityId];
};

describe("Mission policy engine", () => {
  const engine = new MissionPolicyEngine(resolver);

  it("denies transitions from terminal states", () => {
    expect(engine.canTransition("SUCCEEDED", "RUNNING").allowed).toBe(false);
    expect(engine.canTransition("FAILED", "RUNNING").allowed).toBe(false);
    expect(engine.canTransition("CANCELLED", "RUNNING").allowed).toBe(false);
  });

  it("allows external action within contract bounds", () => {
    const action: MissionNodeAction = { kind: "EXTERNAL_ACTION", capabilityId: "form.submit", parameters: {} };
    expect(engine.actionAllowed(makeContract(), makeNode(), action).allowed).toBe(true);
  });

  it("denies external action when risk exceeds contract max", () => {
    const action: MissionNodeAction = { kind: "EXTERNAL_ACTION", capabilityId: "payment.send", parameters: {} };
    const decision = engine.actionAllowed(makeContract({ maxRiskLevel: ToolRisk.MEDIUM }), makeNode(), action);
    expect(decision.allowed).toBe(false);
  });

  it("denies external action when side effect exceeds contract max", () => {
    const action: MissionNodeAction = { kind: "EXTERNAL_ACTION", capabilityId: "form.submit", parameters: {} };
    const decision = engine.actionAllowed(makeContract({ maxSideEffectLevel: ToolSideEffect.READ }), makeNode(), action);
    expect(decision.allowed).toBe(false);
  });

  it("denies external action for READ_ONLY missions", () => {
    const action: MissionNodeAction = { kind: "EXTERNAL_ACTION", capabilityId: "form.submit", parameters: {} };
    const decision = engine.actionAllowed(makeContract({}, "READ_ONLY"), makeNode(), action);
    expect(decision.allowed).toBe(false);
  });

  it("denies external action for PREPARE_ONLY missions", () => {
    const action: MissionNodeAction = { kind: "EXTERNAL_ACTION", capabilityId: "form.submit", parameters: {} };
    const decision = engine.actionAllowed(makeContract({}, "PREPARE_ONLY"), makeNode(), action);
    expect(decision.allowed).toBe(false);
  });

  it("denies unresolvable capability", () => {
    const action: MissionNodeAction = { kind: "EXTERNAL_ACTION", capabilityId: "unknown.capability", parameters: {} };
    expect(engine.actionAllowed(makeContract(), makeNode(), action).allowed).toBe(false);
  });

  it("denies forbidden capability by contract", () => {
    const action: MissionNodeAction = { kind: "CAPABILITY", capabilityId: "payment.send" };
    const contract = makeContract();
    contract.constraints.forbiddenCapabilities = ["payment.send"];
    const decision = engine.actionAllowed(contract, makeNode(), action);
    expect(decision.allowed).toBe(false);
  });

  it("denies node run when attempt budget is exhausted", () => {
    const node = makeNode();
    node.attempt = 3;
    expect(engine.nodeCanRun(makeContract(), node).allowed).toBe(false);
  });

  it("denies node run after deadline", () => {
    const contract = makeContract({ deadlineAt: new Date(Date.now() - 1000).toISOString() });
    expect(engine.nodeCanRun(contract, makeNode()).allowed).toBe(false);
  });

  it("allows node run within bounds", () => {
    expect(engine.nodeCanRun(makeContract(), makeNode()).allowed).toBe(true);
  });

  it("denies action from node of another mission", () => {
    const foreignNode = { ...makeNode(), missionId: "mission-2" };
    const action: MissionNodeAction = { kind: "EXTERNAL_ACTION", capabilityId: "form.submit", parameters: {} };
    expect(engine.actionAllowed(makeContract(), foreignNode as MissionNode, action).allowed).toBe(false);
  });
});
