import { describe, expect, it } from "vitest";
import { ToolRisk, ToolSideEffect, type ToolDescriptor } from "@beyonder/tools";
import type { IntelligenceTask } from "../intelligence/contracts.js";
import { DEFAULT_TASK_BUDGET, type Plan, type TaskExecution } from "./contracts.js";
import { DeterministicCompletionEvaluator } from "./completion.js";
import { DeterministicPlanner, validatePlan } from "./planner.js";
import { DefaultRecoveryPolicy } from "./recovery.js";

const tools: ToolDescriptor[] = [
  {
    id: "safe-objective",
    name: "Safe Objective",
    description: "Safe objective",
    risk: ToolRisk.NONE,
    sideEffects: [ToolSideEffect.NONE],
    capabilities: ["objective-normalization", "deterministic"]
  },
  {
    id: "browser.observe",
    name: "Observe",
    description: "Observe",
    risk: ToolRisk.LOW,
    sideEffects: [ToolSideEffect.READ],
    capabilities: ["browser", "browser:observe"]
  }
];

function task(): IntelligenceTask {
  return {
    id: "task-1",
    input: "Find build number",
    type: "planning",
    complexity: 0.4,
    risk: 0.1,
    estimatedTokens: 300,
    requirements: {}
  };
}

function request() {
  return {
    objective: "Find build number",
    task: task(),
    memoryContext: [],
    availableTools: tools,
    budget: DEFAULT_TASK_BUDGET,
    economicState: "survival" as const
  };
}

describe("DeterministicPlanner", () => {
  it("creates a simple structured plan", () => {
    const plan = new DeterministicPlanner().createPlan(request());

    expect(plan.objective).toBe("Find build number");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.allowedToolCapabilities).toContain("objective-normalization");
    expect(validatePlan(plan, request()).valid).toBe(true);
  });

  it("keeps plan size bounded by budget", () => {
    const tooLarge: Plan = {
      id: "plan",
      taskId: "task-1",
      objective: "too large",
      createdAt: new Date().toISOString(),
      revision: 1,
      steps: Array.from({ length: 3 }, (_, index) => ({
        id: `s${index}`,
        description: "step",
        status: "PENDING" as const
      }))
    };

    const result = validatePlan(tooLarge, { ...request(), budget: { ...DEFAULT_TASK_BUDGET, maxSteps: 2 } });
    expect(result.valid).toBe(false);
    expect(result.valid ? [] : result.issues.map((issue) => issue.code)).toContain("EXCESSIVE_PLAN_SIZE");
  });

  it("rejects invalid schema", () => {
    const result = validatePlan({ freeform: "do stuff" }, request());
    expect(result.valid).toBe(false);
    expect(result.valid ? "" : result.issues[0]?.code).toBe("INVALID_PLAN");
  });

  it("rejects unsupported capabilities", () => {
    const plan = new DeterministicPlanner().createPlan(request());
    plan.steps[0]!.allowedToolCapabilities = ["browser:click"];

    const result = validatePlan(plan, request());
    expect(result.valid).toBe(false);
    expect(result.valid ? [] : result.issues.map((issue) => issue.code)).toContain("UNSUPPORTED_CAPABILITY");
  });

  it("rejects prohibited capabilities", () => {
    const plan = new DeterministicPlanner().createPlan(request());
    plan.steps[0]!.allowedToolCapabilities = ["shell.execute"];

    const result = validatePlan(plan, request());
    expect(result.valid).toBe(false);
    expect(result.valid ? [] : result.issues.map((issue) => issue.code)).toContain("PROHIBITED_CAPABILITY");
  });

  it("validates dependency ordering references", () => {
    const plan = new DeterministicPlanner().createPlan(request());
    plan.steps[0]!.dependencies = ["missing"];

    const result = validatePlan(plan, request());
    expect(result.valid).toBe(false);
    expect(result.valid ? [] : result.issues.map((issue) => issue.code)).toContain("INVALID_DEPENDENCY");
  });

  it("increments replan revision and preserves completed steps", () => {
    const planner = new DeterministicPlanner();
    const first = planner.createPlan(request());
    first.steps[0]!.status = "COMPLETED";
    const revised = planner.revisePlan!({
      ...request(),
      previousPlan: first,
      completedSteps: [first.steps[0]!],
      observations: ["done"],
      reason: "selector changed"
    });

    expect(revised.revision).toBe(2);
    expect(revised.steps[0]?.status).toBe("COMPLETED");
  });
});

describe("DefaultRecoveryPolicy", () => {
  const policy = new DefaultRecoveryPolicy();
  const base = {
    step: { id: "s1", description: "step", status: "FAILED" as const },
    attemptCount: 1,
    previousObservations: [],
    remainingBudget: {
      steps: 5,
      toolInvocations: 5,
      retries: 1,
      replans: 1,
      durationMs: 1000,
      monetaryCostUsd: 0,
      shadowCostUsd: 0,
      consecutiveFailures: 2,
      noProgressSteps: 2
    }
  };

  it("retries retryable errors", () => {
    expect(policy.decide({ ...base, failure: { code: "TIMEOUT", message: "slow" } }).type).toBe("RETRY");
  });

  it("does not retry policy denial", () => {
    expect(policy.decide({ ...base, failure: { code: "POLICY_DENIED", message: "denied" } }).type).toBe("BLOCK");
  });

  it("asks for replan on invalid arguments when budget remains", () => {
    expect(policy.decide({ ...base, failure: { code: "INVALID_ARGUMENTS", message: "bad" } }).type).toBe("REPLAN");
  });

  it("fails when recovery budget is exhausted", () => {
    expect(policy.decide({
      ...base,
      remainingBudget: { ...base.remainingBudget, retries: 0 },
      failure: { code: "TIMEOUT", message: "slow" }
    }).type).toBe("FAIL");
  });
});

describe("DeterministicCompletionEvaluator", () => {
  const evaluator = new DeterministicCompletionEvaluator();

  function execution(result: string, state: TaskExecution["state"] = "COMPLETED"): TaskExecution {
    return {
      id: "exec",
      task: task(),
      plan: new DeterministicPlanner().createPlan(request()),
      state,
      budget: DEFAULT_TASK_BUDGET,
      usage: {
        steps: 1,
        toolInvocations: 1,
        retries: 0,
        replans: 0,
        durationMs: 10,
        monetaryCostUsd: 0,
        shadowCostUsd: 0,
        consecutiveFailures: 0,
        noProgressSteps: 0
      },
      checkpoints: [],
      steps: [],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      result
    };
  }

  it("passes exact deterministic text completion", () => {
    expect(evaluator.evaluate(execution("Build number: 4821"), { expectedText: "4821" })).toMatchObject({ status: "PASS", taskCompleted: true });
  });

  it("fails incomplete text completion", () => {
    expect(evaluator.evaluate(execution("Build number unknown"), { expectedText: "4821" })).toMatchObject({ status: "FAIL", taskCompleted: false });
  });

  it("fails wrong structured result", () => {
    expect(evaluator.evaluate(execution("{\"build\":\"1234\"}"), { expectedJsonField: { path: ["build"], equals: "4821" } })).toMatchObject({ status: "FAIL" });
  });

  it("reports blocked and exhausted terminal states distinctly", () => {
    expect(evaluator.evaluate(execution("", "BLOCKED")).status).toBe("BLOCKED");
    expect(evaluator.evaluate(execution("", "BUDGET_EXHAUSTED")).status).toBe("BUDGET_EXHAUSTED");
  });
});

