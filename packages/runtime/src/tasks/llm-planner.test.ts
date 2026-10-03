import { describe, expect, it, vi } from "vitest";
import { ToolExecutor, ToolRegistry, ToolRisk, ToolSideEffect, createToolInputSchema, type ToolDescriptor, type ToolDefinition } from "@beyonder/tools";
import type { ModelCandidate, RouteDecision } from "../models/adaptive-types.js";
import type { ModelResponse } from "../types.js";
import type { IntelligenceTask } from "../intelligence/contracts.js";
import { DEFAULT_TASK_BUDGET } from "./contracts.js";
import { LlmPlanner } from "./llm-planner.js";
import { AutonomousTaskExecutor } from "./task-executor.js";

const tool: ToolDescriptor = {
  id: "fixture.read",
  name: "Fixture Read",
  description: "Read deterministic fixture",
  risk: ToolRisk.LOW,
  sideEffects: [ToolSideEffect.READ],
  capabilities: ["fixture"]
};

function task(): IntelligenceTask {
  return { id: "task-planner", input: "Find the fixture value", type: "planning", complexity: 0.3, risk: 0.1, estimatedTokens: 200, requirements: {} };
}

function candidate(): ModelCandidate {
  return {
    provider: "fixture-provider",
    model: "fixture-model",
    capabilities: ["text"],
    contextWindow: 4096,
    toolCalling: "no",
    predictedQuality: 0.8,
    historicalSuccess: 1,
    reliability: 1,
    monetaryCostUsd: 0,
    shadowCostUsd: 0,
    latencyPenalty: 0,
    failureRisk: 0,
    effectiveResourceCost: 0,
    utility: 1,
    quota: { provider: "fixture-provider", model: "fixture-model", requestsPerMinute: "unknown", requestsPerDay: "unknown", tokensPerMinute: "unknown", tokensPerDay: "unknown", requestQuotaTotal: "unknown", requestQuotaRemaining: "unknown", tokenQuotaTotal: "unknown", tokenQuotaRemaining: "unknown", resetAt: "unknown", health: "healthy", lastUpdatedAt: "unknown" },
    performance: { provider: "fixture-provider", model: "fixture-model", taskType: "planning", samples: 0, successes: 0, failures: 0, successRate: 0, avgEvaluationScore: 0, avgLatencyMs: 0, avgMonetaryCostUsd: 0, avgShadowCostUsd: 0, avgAttempts: 0 },
    benchmarkCapability: null,
    capabilityEvidence: { bibScore: null, bibSamples: 0, realScore: null, realSamples: 0, predictedScore: 0.8, source: "metadata" },
    explanation: { positives: [], penalties: [], constraints: [] }
  };
}

function router(contentOrError: string | Error): { route: ReturnType<typeof vi.fn>; completeForCandidate: ReturnType<typeof vi.fn> } {
  const selected = candidate();
  const route: RouteDecision = { task: task(), economicState: "normal", candidates: [selected], selected, explored: false, reason: "test" };
  return {
    route: vi.fn(async () => route),
    completeForCandidate: vi.fn(async (): Promise<ModelResponse> => {
      if (contentOrError instanceof Error) throw contentOrError;
      return { content: contentOrError, provider: selected.provider, model: selected.model, estimatedCostUsd: 0 };
    })
  };
}

function validPlanJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "llm-plan",
    taskId: "task-planner",
    objective: "Find the fixture value",
    createdAt: new Date(0).toISOString(),
    revision: 1,
    steps: [{ id: "read", description: "Read the fixture", status: "PENDING", allowedToolCapabilities: ["fixture"] }],
    ...overrides
  });
}

describe("LlmPlanner", () => {
  it("accepts only a valid structured JSON plan", async () => {
    const mock = router(validPlanJson());
    const plan = await new LlmPlanner({ modelRouter: mock as never }).createPlan({ objective: task().input, task: task(), memoryContext: [], availableTools: [tool], budget: DEFAULT_TASK_BUDGET, economicState: "normal" });
    expect(plan.id).toBe("llm-plan");
    expect(mock.completeForCandidate).toHaveBeenCalledOnce();
  });

  it.each([
    ["free text", "do these steps"],
    ["invalid JSON", "{broken"],
    ["missing capability", validPlanJson({ steps: [{ id: "read", description: "Read", status: "PENDING", allowedToolCapabilities: ["missing"] }] })],
    ["prohibited capability", validPlanJson({ steps: [{ id: "read", description: "Run shell", status: "PENDING", allowedToolCapabilities: ["shell.execute"] }] })],
    ["excessive plan", validPlanJson({ steps: Array.from({ length: 13 }, (_, index) => ({ id: `step-${index}`, description: "step", status: "PENDING" })) })]
  ])("falls back safely for %s", async (_label, response) => {
    const mock = router(response);
    const fallback = { createPlan: vi.fn(() => ({ id: "fallback", taskId: task().id, objective: task().input, createdAt: new Date(0).toISOString(), revision: 1, steps: [{ id: "safe", description: "Safe fallback", status: "PENDING" as const }] })) };
    const plan = await new LlmPlanner({ modelRouter: mock as never, deterministicFallback: fallback }).createPlan({ objective: task().input, task: task(), memoryContext: [], availableTools: [tool], budget: DEFAULT_TASK_BUDGET, economicState: "normal" });
    expect(plan.id).toBe("fallback");
    expect(fallback.createPlan).toHaveBeenCalledOnce();
  });

  it("falls back when the selected model is unavailable", async () => {
    const mock = router(new Error("MODEL_UNAVAILABLE"));
    const fallback = { createPlan: vi.fn(() => ({ id: "fallback", taskId: task().id, objective: task().input, createdAt: new Date(0).toISOString(), revision: 1, steps: [{ id: "safe", description: "Safe fallback", status: "PENDING" as const }] })) };
    const plan = await new LlmPlanner({ modelRouter: mock as never, deterministicFallback: fallback }).createPlan({ objective: task().input, task: task(), memoryContext: [], availableTools: [tool], budget: DEFAULT_TASK_BUDGET, economicState: "normal" });
    expect(plan.id).toBe("fallback");
  });

  it("tries the next routed candidate after an operational model failure", async () => {
    const first = candidate();
    const second = { ...candidate(), provider: "second-provider", model: "second-model" };
    const route = vi.fn(async () => ({ task: task(), economicState: "normal" as const, candidates: [first, second], selected: first, explored: false, reason: "test" }));
    const completeForCandidate = vi.fn()
      .mockRejectedValueOnce(new Error("RATE_LIMITED"))
      .mockResolvedValueOnce({ content: validPlanJson(), provider: second.provider, model: second.model, estimatedCostUsd: 0 });
    const plan = await new LlmPlanner({ modelRouter: { route, completeForCandidate } as never }).createPlan({ objective: task().input, task: task(), memoryContext: [], availableTools: [tool], budget: DEFAULT_TASK_BUDGET, economicState: "normal" });
    expect(plan.id).toBe("llm-plan");
    expect(completeForCandidate).toHaveBeenCalledTimes(2);
  });

  it("feeds a validated LLM plan into the existing executor", async () => {
    const mock = router(validPlanJson());
    const planner = new LlmPlanner({ modelRouter: mock as never });
    const plan = await planner.createPlan({ objective: task().input, task: task(), memoryContext: [], availableTools: [tool], budget: DEFAULT_TASK_BUDGET, economicState: "normal" });
    const definition: ToolDefinition = {
      id: "fixture.read",
      name: "Fixture Read",
      description: "Fixture",
      inputSchema: createToolInputSchema((input) => ({ success: true as const, data: input })),
      risk: ToolRisk.LOW,
      sideEffects: ToolSideEffect.READ,
      capabilities: ["fixture"],
      execute: async () => ({ output: "LLM_PLAN_OK" })
    };
    const registry = new ToolRegistry().register(definition);
    const outcome = await new AutonomousTaskExecutor({
      toolExecutor: new ToolExecutor(registry),
      actionPlanner: { decide: () => ({ call: { id: "read-call", tool: "fixture.read", arguments: {} } }) }
    }).execute({ task: task(), plan, economicState: "normal", completionCriteria: { expectedText: "LLM_PLAN_OK" } });
    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.success).toBe(true);
  });
});
