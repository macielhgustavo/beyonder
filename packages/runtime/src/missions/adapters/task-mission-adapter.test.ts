import { describe, it, expect } from "vitest";
import { ToolRisk, ToolSideEffect } from "@beyonder/tools";
import type { IntelligenceTask } from "../../intelligence/contracts.js";
import {
  taskToMissionContract,
  taskToMissionPlan,
  liftTaskToMission
} from "./task-mission-adapter.js";

function makeTask(overrides: Partial<IntelligenceTask> = {}): IntelligenceTask {
  return {
    id: "task-1",
    input: "Summarize the repository structure.",
    type: "research",
    complexity: 0.4,
    risk: 0.2,
    estimatedTokens: 1200,
    requirements: {},
    ...overrides
  };
}

describe("Task → Mission adapter (ADR 0006)", () => {
  it("derives a conservative contract for a plain research task", () => {
    const task = makeTask();
    const contract = taskToMissionContract(task);

    expect(contract.objective).toBe(task.input);
    expect(contract.autonomyLevel).toBe("PREPARE_ONLY");
    expect(contract.constraints.maxSideEffectLevel).toBe(ToolSideEffect.NONE);
    expect(contract.constraints.maxRiskLevel).toBe(ToolRisk.LOW);
    expect(contract.successCriteria).toHaveLength(1);
    expect(contract.requiredEvidence?.[0].required).toBe(true);
    expect(contract.origin).toEqual({ kind: "INTERNAL" });
  });

  it("upgrades side-effect ceiling but not autonomy when a task uses tools", () => {
    const task = makeTask({ requirements: { toolUse: true } });
    const contract = taskToMissionContract(task);

    // Tool use allows READ side effects, but never silently grants autonomy.
    expect(contract.constraints.maxSideEffectLevel).toBe(ToolSideEffect.READ);
    expect(contract.autonomyLevel).toBe("READ_ONLY");
  });

  it("honors explicit origin metadata (e.g. OPPORTUNITY from v0.8)", () => {
    const task = makeTask();
    const contract = taskToMissionContract(task, {
      origin: { kind: "OPPORTUNITY", opportunityId: "opp-42" }
    });

    expect(contract.origin).toEqual({ kind: "OPPORTUNITY", opportunityId: "opp-42" });
  });

  it("produces an EXECUTE → VERIFY plan whose verify depends on execute", () => {
    const task = makeTask();
    const contract = taskToMissionContract(task);
    const plan = taskToMissionPlan(contract, task);

    expect(plan.missionId).toBe(contract.id);
    expect(plan.nodes).toHaveLength(2);
    const [execute, verify] = plan.nodes;
    expect(execute.kind).toBe("EXECUTE");
    expect(execute.action).toMatchObject({ kind: "TASK", taskType: "research" });
    expect(verify.kind).toBe("VERIFY");
    expect(verify.dependsOn).toEqual([execute.id]);
    expect(execute.dependsOn).toEqual([]);
  });

  it("lifts a task to a kernel-validated mission", () => {
    const { contract, plan } = liftTaskToMission(makeTask());
    expect(plan.missionId).toBe(contract.id);
    expect(plan.nodes.map((n) => n.kind)).toEqual(["EXECUTE", "VERIFY"]);
  });

  it("propagates attempt limits from options into nodes and contract", () => {
    const { contract, plan } = liftTaskToMission(makeTask(), { maxNodeAttempts: 5 });
    expect(contract.constraints.maxNodeAttempts).toBe(5);
    expect(plan.nodes[0].maxAttempts).toBe(5);
  });

  it("generates unique mission ids for the same task", () => {
    const a = taskToMissionContract(makeTask());
    const b = taskToMissionContract(makeTask());
    expect(a.id).not.toBe(b.id);
  });
});
