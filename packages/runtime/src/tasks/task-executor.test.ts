import { describe, expect, it, vi } from "vitest";
import {
  DefaultToolPolicy,
  ToolExecutor,
  ToolRegistry,
  ToolRisk,
  ToolSideEffect,
  createToolInputSchema,
  type ToolDefinition
} from "@beyonder/tools";
import type { IntelligenceTask } from "../intelligence/contracts.js";
import type { EconomicState } from "../types.js";
import { AutonomousTaskExecutor } from "./task-executor.js";
import { assertTaskStateTransition, InvalidTaskStateTransitionError } from "./state-machine.js";
import type { Plan } from "./contracts.js";

const schema = createToolInputSchema((input) => ({ success: true as const, data: input }));

function task(overrides: Partial<IntelligenceTask> = {}): IntelligenceTask {
  return {
    id: "task-1",
    input: "Find the build number",
    type: "tool-use",
    complexity: 0.3,
    risk: 0.1,
    estimatedTokens: 256,
    requirements: {},
    ...overrides
  };
}

function plan(steps: Plan["steps"]): Plan {
  return {
    id: "plan-1",
    taskId: "task-1",
    objective: "Find the build number",
    steps,
    createdAt: "2026-10-03T00:00:00.000Z",
    revision: 1
  };
}

function step(id: string, tool = "fixture.read", dependencies?: string[]): Plan["steps"][number] {
  return {
    id,
    description: `Run ${id}`,
    status: "PENDING",
    dependencies,
    allowedToolCapabilities: ["fixture"],
    action: {
      id: `call-${id}`,
      tool,
      arguments: { value: id }
    }
  };
}

function definition(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: "fixture.read",
    name: "Fixture Read",
    description: "Deterministic test tool",
    inputSchema: schema,
    risk: ToolRisk.LOW,
    sideEffects: ToolSideEffect.READ,
    capabilities: ["fixture"],
    execute: async (input) => ({ output: { ok: true, input } }),
    ...overrides
  };
}

function executorFor(defs: ToolDefinition[], policy = new DefaultToolPolicy()) {
  const registry = new ToolRegistry().registerMany(defs);
  const toolExecutor = new ToolExecutor(registry, { policy });
  return new AutonomousTaskExecutor({
    toolExecutor,
    getAvailableTools: (context) => registry.getAvailableTools(context, toolExecutor.policy),
    telemetry: { record: vi.fn(async () => {}) }
  });
}

async function run(inputPlan: Plan, defs: ToolDefinition[], budget: Parameters<AutonomousTaskExecutor["execute"]>[0]["budget"] = {}, economicState: EconomicState = "survival") {
  return executorFor(defs).execute({ task: task(), plan: inputPlan, economicState, budget });
}

describe("task execution state machine", () => {
  it("allows known state transitions", () => {
    expect(() => assertTaskStateTransition("CREATED", "PLANNING")).not.toThrow();
    expect(() => assertTaskStateTransition("PLANNING", "READY")).not.toThrow();
    expect(() => assertTaskStateTransition("RUNNING", "RECOVERING")).not.toThrow();
    expect(() => assertTaskStateTransition("RUNNING", "COMPLETED")).not.toThrow();
  });

  it("rejects invalid state transitions explicitly", () => {
    expect(() => assertTaskStateTransition("COMPLETED", "RUNNING")).toThrow(InvalidTaskStateTransitionError);
  });
});

describe("AutonomousTaskExecutor", () => {
  it("completes a normal multi-step plan and checkpoints every step", async () => {
    const outcome = await run(plan([step("one"), step("two", "fixture.read", ["one"])]), [definition()]);

    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.execution.steps).toHaveLength(2);
    expect(outcome.execution.usage.toolInvocations).toBe(2);
    expect(outcome.execution.checkpoints).toHaveLength(2);
    expect(outcome.execution.checkpoints.at(-1)?.completedSteps).toEqual(["one", "two"]);
  });

  it("executes exactly one tool action per step attempt", async () => {
    const execute = vi.fn(async (input) => ({ output: input }));
    const outcome = await run(plan([step("one")]), [definition({ execute })]);

    expect(outcome.status).toBe("COMPLETED");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("fails a non-retryable step failure", async () => {
    const outcome = await run(plan([step("bad", "missing.tool")]), [definition()]);

    expect(outcome.status).toBe("FAILED");
    expect(outcome.execution.steps[0]?.toolResult?.error?.code).toBe("TOOL_NOT_FOUND");
  });

  it("retries retryable failures up to the retry budget", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({ output: "ok" });

    const outcome = await run(plan([step("retry")]), [definition({ execute })], { maxRetries: 1 });

    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.execution.usage.retries).toBe(1);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("stops when max steps is exhausted", async () => {
    const outcome = await run(plan([step("one"), step("two")]), [definition()], { maxSteps: 1 });

    expect(outcome.status).toBe("BUDGET_EXHAUSTED");
    expect(outcome.failureReason).toBe("maxSteps");
    expect(outcome.execution.steps).toHaveLength(1);
  });

  it("stops when max tool invocations is exhausted", async () => {
    const outcome = await run(plan([step("one"), step("two")]), [definition()], { maxToolInvocations: 1 });

    expect(outcome.status).toBe("BUDGET_EXHAUSTED");
    expect(outcome.failureReason).toBe("maxToolInvocations");
  });

  it("blocks policy-denied tool execution without retrying", async () => {
    const outcome = await run(plan([step("danger")]), [definition({
      risk: ToolRisk.CRITICAL,
      sideEffects: ToolSideEffect.SYSTEM
    })]);

    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.execution.usage.retries).toBe(0);
    expect(outcome.execution.steps[0]?.toolResult?.error?.code).toBe("POLICY_DENIED");
  });

  it("honors monetary budget through tool policy", async () => {
    const outcome = await run(plan([step("paid")]), [definition({
      cost: { monetaryCostUsd: 0.01 }
    })], { maxMonetaryCostUsd: 0 });

    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.execution.steps[0]?.toolResult?.error?.code).toBe("POLICY_DENIED");
  });

  it("honors shadow budget through tool policy", async () => {
    const outcome = await run(plan([step("shadow")]), [definition({
      cost: { shadowCostUsd: 0.03 }
    })], { maxShadowCostUsd: 0.01 });

    expect(outcome.status).toBe("BLOCKED");
  });

  it("cancels before executing a step when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const execute = vi.fn(async () => ({ output: "nope" }));
    const outcome = await executorFor([definition({ execute })]).execute({
      task: task(),
      plan: plan([step("one")]),
      economicState: "survival",
      signal: controller.signal
    });

    expect(outcome.status).toBe("CANCELLED");
    expect(execute).not.toHaveBeenCalled();
  });

  it("detects no-progress repeated action and observation", async () => {
    const repeated = {
      id: "repeat",
      description: "Repeat",
      status: "PENDING" as const,
      allowedToolCapabilities: ["fixture"],
      action: { id: "same-call", tool: "fixture.read", arguments: { value: "same" } }
    };
    const outcome = await run(plan([{ ...repeated, id: "a" }, { ...repeated, id: "b" }, { ...repeated, id: "c" }]), [definition({
      execute: async () => ({ output: "same observation" })
    })], { maxNoProgressSteps: 2 });

    expect(outcome.status).toBe("FAILED");
    expect(outcome.failureReason).toBe("NO_PROGRESS");
  });

  it("stops after consecutive failures reach the configured limit", async () => {
    const outcome = await run(plan([step("one"), step("two")]), [definition({
      execute: async () => {
        throw new Error("temporary");
      }
    })], { maxRetries: 0, maxConsecutiveFailures: 1 });

    expect(outcome.status).toBe("FAILED");
    expect(outcome.execution.usage.consecutiveFailures).toBe(1);
  });

  it("records router choice and available tool context without bypassing tool runtime", async () => {
    const route = vi.fn(async () => ({
      task: task(),
      economicState: "survival" as const,
      candidates: [],
      selected: undefined,
      explored: false,
      reason: "test"
    }));
    const outcome = await new AutonomousTaskExecutor({
      toolExecutor: new ToolExecutor(new ToolRegistry().register(definition())),
      getAvailableTools: async () => [{ id: "fixture.read", name: "Fixture", description: "", risk: ToolRisk.LOW, sideEffects: [ToolSideEffect.READ], capabilities: ["fixture"] }],
      modelRouter: { route, recordOutcome: vi.fn(async () => {}) } as never
    }).execute({ task: task(), plan: plan([step("one")]), economicState: "survival" });

    expect(outcome.status).toBe("COMPLETED");
    expect(route).toHaveBeenCalledOnce();
  });
});

