import { describe, it, expect } from "vitest";
import { ToolRisk, ToolSideEffect } from "@beyonder/tools";
import {
  validateMissionPlan,
  findCycles,
  MISSION_NODE_KINDS,
  type MissionPlanValidationCode,
  type MissionPlanValidationIssue,
  type MissionPlanValidationContext
} from "./plan-validation.js";
import type { MissionPlanProposal, MissionNodeSpec } from "./mission.js";

function makeContext(overrides: Partial<MissionPlanValidationContext> = {}): MissionPlanValidationContext {
  return {
    availableCapabilities: ["web.read", "file.write", "code.execute"],
    forbiddenCapabilities: new Set(["shell.execute", "payment"]),
    grantableApprovalTypes: new Set(["APPLY_TO_OPPORTUNITY", "SUBMIT_DELIVERABLE"]),
    maxNodes: 20,
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
    ...overrides
  };
}

function makeNode(overrides: Partial<MissionNodeSpec> = {}): MissionNodeSpec {
  return {
    id: `node-${crypto.randomUUID().slice(0, 8)}`,
    kind: "EXECUTE",
    description: "Do something",
    dependsOn: [],
    maxAttempts: 3,
    ...overrides
  };
}

function makeProposal(nodes: MissionNodeSpec[], overrides: Partial<MissionPlanProposal> = {}): MissionPlanProposal {
  return {
    schemaVersion: 1,
    missionId: "mission-1",
    revision: 1,
    objective: "Test mission",
    nodes,
    proposedAt: new Date().toISOString(),
    ...overrides
  };
}

function expectIssue(result: ReturnType<typeof validateMissionPlan>, index: number): MissionPlanValidationIssue {
  expect(result.valid).toBe(false);
  if (!result.valid) return result.issues[index];
  throw new Error("expected invalid result");
}

describe("Mission plan validation", () => {
  it("accepts a valid linear plan", () => {
    const nodes = [
      makeNode({ id: "a", dependsOn: [] }),
      makeNode({ id: "b", dependsOn: ["a"] }),
      makeNode({ id: "c", dependsOn: ["b"] })
    ];
    const result = validateMissionPlan(makeProposal(nodes), makeContext());
    expect(result.valid).toBe(true);
  });

  it("rejects empty plan", () => {
    const result = validateMissionPlan(makeProposal([]), makeContext());
    expect(result.valid).toBe(false);
    expect(expectIssue(result, 0).code).toBe("EMPTY_PLAN");
  });

  it("rejects duplicate node ids", () => {
    const nodes = [makeNode({ id: "a" }), makeNode({ id: "a" })];
    const result = validateMissionPlan(makeProposal(nodes), makeContext());
    expect(result.valid).toBe(false);
    expect(expectIssue(result, 0).code).toBe("DUPLICATE_NODE_ID");
  });

  it("rejects unknown dependencies", () => {
    const nodes = [makeNode({ id: "a", dependsOn: ["missing"] })];
    const result = validateMissionPlan(makeProposal(nodes), makeContext());
    expect(result.valid).toBe(false);
    expect(expectIssue(result, 0).code).toBe("UNKNOWN_DEPENDENCY");
  });

  it("detects direct cycle A -> B -> A", () => {
    const nodes = [
      makeNode({ id: "a", dependsOn: ["b"] }),
      makeNode({ id: "b", dependsOn: ["a"] })
    ];
    const result = validateMissionPlan(makeProposal(nodes), makeContext());
    expect(result.valid).toBe(false);
    expect(expectIssue(result, 0).code).toBe("CYCLE_DETECTED");
  });

  it("detects indirect cycle A -> B -> C -> A", () => {
    const nodes = [
      makeNode({ id: "a", dependsOn: ["c"] }),
      makeNode({ id: "b", dependsOn: ["a"] }),
      makeNode({ id: "c", dependsOn: ["b"] })
    ];
    const result = validateMissionPlan(makeProposal(nodes), makeContext());
    expect(result.valid).toBe(false);
    expect(expectIssue(result, 0).code).toBe("CYCLE_DETECTED");
  });

  it("rejects unknown capability", () => {
    const nodes = [makeNode({ id: "a", requiredCapabilities: ["unknown.capability"] })];
    const result = validateMissionPlan(makeProposal(nodes), makeContext());
    expect(result.valid).toBe(false);
    expect(expectIssue(result, 0).code).toBe("UNKNOWN_CAPABILITY");
  });

  it("rejects forbidden capability", () => {
    const nodes = [makeNode({ id: "a", requiredCapabilities: ["payment"] })];
    const result = validateMissionPlan(makeProposal(nodes), makeContext());
    expect(result.valid).toBe(false);
    expect(expectIssue(result, 0).code).toBe("FORBIDDEN_CAPABILITY");
  });

  it("rejects unknown capability in action", () => {
    const nodes = [makeNode({ id: "a", action: { kind: "CAPABILITY", capabilityId: "unknown.capability" } })];
    const result = validateMissionPlan(makeProposal(nodes), makeContext());
    expect(result.valid).toBe(false);
    expect(expectIssue(result, 0).code).toBe("UNKNOWN_CAPABILITY");
  });

  it("rejects external action without approval dependency", () => {
    const nodes = [makeNode({ id: "a", action: { kind: "EXTERNAL_ACTION", capabilityId: "file.write", parameters: {} } })];
    const result = validateMissionPlan(makeProposal(nodes), makeContext());
    expect(result.valid).toBe(false);
    expect(expectIssue(result, 0).code).toBe("MISSING_APPROVAL_FOR_SIDE_EFFECT");
  });

  it("accepts external action with approval dependency", () => {
    const nodes = [
      makeNode({ id: "approval", kind: "APPROVAL", action: { kind: "GATE", approvalActionType: "SUBMIT_DELIVERABLE" } }),
      makeNode({ id: "action", dependsOn: ["approval"], action: { kind: "EXTERNAL_ACTION", capabilityId: "file.write", parameters: {} } })
    ];
    const result = validateMissionPlan(makeProposal(nodes), makeContext());
    expect(result.valid).toBe(true);
  });

  it("rejects unsupported approval type", () => {
    const nodes = [makeNode({ id: "a", kind: "APPROVAL", action: { kind: "GATE", approvalActionType: "INVALID_TYPE" } })];
    const result = validateMissionPlan(makeProposal(nodes), makeContext());
    expect(result.valid).toBe(false);
    expect(expectIssue(result, 0).code).toBe("UNSUPPORTED_NODE_ACTION");
  });

  it("rejects plan exceeding maxNodes", () => {
    const nodes = Array.from({ length: 25 }, (_, i) => makeNode({ id: `node-${i}` }));
    const result = validateMissionPlan(makeProposal(nodes), makeContext({ maxNodes: 20 }));
    expect(result.valid).toBe(false);
    expect(expectIssue(result, 0).code).toBe("EXCESSIVE_PLAN_SIZE");
  });

  it("accepts diamond graph (parallel branches)", () => {
    const nodes = [
      makeNode({ id: "start" }),
      makeNode({ id: "left", dependsOn: ["start"] }),
      makeNode({ id: "right", dependsOn: ["start"] }),
      makeNode({ id: "join", dependsOn: ["left", "right"] })
    ];
    const result = validateMissionPlan(makeProposal(nodes), makeContext());
    expect(result.valid).toBe(true);
  });

  it("findCycles reports cycles correctly", () => {
    const nodes = [
      makeNode({ id: "a", dependsOn: ["c"] }),
      makeNode({ id: "b", dependsOn: ["a"] }),
      makeNode({ id: "c", dependsOn: ["b"] })
    ];
    const cycles = findCycles(nodes);
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0].length).toBe(3);
  });

  it("findCycles returns empty for acyclic graph", () => {
    const nodes = [makeNode({ id: "a" }), makeNode({ id: "b", dependsOn: ["a"] })];
    expect(findCycles(nodes)).toEqual([]);
  });
});