import { describe, expect, it } from "vitest";
import type { IntelligenceTask } from "./contracts.js";
import { AdaptiveExecutionController } from "./adaptive-execution-controller.js";
import { EvaluationLayer } from "./evaluation-layer.js";
import type { ModelRouter } from "../models/model-router.js";
import type { ModelCandidate, RouteDecision } from "../models/adaptive-types.js";

const task: IntelligenceTask = {
  id: "task-controller",
  input: "Plan a bounded safe action",
  type: "planning",
  complexity: 0.6,
  risk: 0.1,
  estimatedTokens: 300,
  requirements: {}
};

function candidate(provider: string, model: string, predictedQuality: number, utility: number): ModelCandidate {
  return {
    provider,
    model,
    capabilities: ["text"],
    contextWindow: "unknown",
    toolCalling: "unknown",
    predictedQuality,
    historicalSuccess: 0.7,
    reliability: 0.9,
    monetaryCostUsd: 0,
    shadowCostUsd: 0.001,
    latencyPenalty: 0.1,
    failureRisk: 0.1,
    effectiveResourceCost: 0.0011,
    utility,
    quota: {
      provider,
      model,
      requestsPerMinute: "unknown",
      requestsPerDay: "unknown",
      tokensPerMinute: "unknown",
      tokensPerDay: "unknown",
      requestQuotaTotal: "unknown",
      requestQuotaRemaining: "unknown",
      tokenQuotaTotal: "unknown",
      tokenQuotaRemaining: "unknown",
      resetAt: "unknown",
      health: "healthy",
      lastUpdatedAt: "unknown"
    },
    performance: {
      provider,
      model,
      taskType: "planning",
      samples: 0,
      successes: 0,
      failures: 0,
      successRate: 0.5,
      avgEvaluationScore: 0.5,
      avgLatencyMs: 0,
      avgMonetaryCostUsd: 0,
      avgShadowCostUsd: 0,
      avgAttempts: 0
    },
    explanation: { positives: [], penalties: [], constraints: [] }
  };
}

function route(candidates: ModelCandidate[], state: RouteDecision["economicState"] = "normal"): RouteDecision {
  return {
    task,
    economicState: state,
    candidates,
    selected: candidates[0],
    explored: false,
    reason: "test route"
  };
}

describe("AdaptiveExecutionController", () => {
  it("retries a transient execution failure within the bounded attempt limit", async () => {
    const first = candidate("p1", "m1", 0.8, 0.8);
    let calls = 0;
    const router = {
      route: async () => route([first]),
      completeForCandidate: async () => {
        calls += 1;
        if (calls === 1) throw new Error("temporary failure");
        return { content: "Create a bounded safe plan and validate the result.", provider: "p1", model: "m1", estimatedCostUsd: 0 };
      }
    } as unknown as ModelRouter;
    const controller = new AdaptiveExecutionController(router, new EvaluationLayer());
    const result = await controller.execute({ task, economicState: "normal", messages: [] });
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.success).toBe(false);
    expect(result.exhausted).toBe(false);
  });

  it("escalates to a stronger candidate when deterministic evaluation is insufficient", async () => {
    const first = candidate("p1", "m1", 0.6, 0.9);
    const second = candidate("p2", "m2", 0.9, 0.8);
    const router = {
      route: async () => route([first, second]),
      completeForCandidate: async (_messages: unknown, selected: ModelCandidate) => ({
        content: selected.provider === "p1" ? "" : "Create a bounded safe plan, validate it, and return the result.",
        provider: selected.provider,
        model: selected.model,
        estimatedCostUsd: 0
      })
    } as unknown as ModelRouter;
    const controller = new AdaptiveExecutionController(router, new EvaluationLayer());
    const result = await controller.execute({ task, economicState: "normal", messages: [] });
    expect(result.attempts).toHaveLength(2);
    expect(result.selectedCandidate?.provider).toBe("p2");
    expect(result.evaluation?.passed).toBe(true);
  });

  it("keeps survival to one attempt and halted to zero attempts", async () => {
    const first = candidate("p1", "m1", 0.8, 0.8);
    const router = {
      route: async (_task: unknown, state: RouteDecision["economicState"]) => state === "halted" ? route([], "halted") : route([first], state),
      completeForCandidate: async () => { throw new Error("failure"); }
    } as unknown as ModelRouter;
    const controller = new AdaptiveExecutionController(router, new EvaluationLayer());
    const survival = await controller.execute({ task, economicState: "survival", messages: [] });
    expect(survival.attempts).toHaveLength(1);
    const halted = await controller.execute({ task, economicState: "halted", messages: [] });
    expect(halted.attempts).toHaveLength(0);
  });
});
