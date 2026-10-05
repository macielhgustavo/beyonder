import { describe, expect, it, vi } from "vitest";
import { ToolExecutor, ToolRegistry } from "@beyonder/tools";
import type { IntelligenceTask, TaskOutcome } from "../intelligence/contracts.js";
import { analyzeGoalContract } from "../intelligence/goal-contract.js";
import type { ModelCandidate } from "../models/adaptive-types.js";
import type { InferenceAttempt } from "../models/inference.js";
import type { ModelRouter } from "../models/model-router.js";
import { ObjectiveVerifier } from "./completion.js";
import type { Plan, TaskExecution } from "./contracts.js";
import { ModelObjectiveVerifier } from "./model-objective-verifier.js";
import { AutonomousTaskExecutor } from "./task-executor.js";

const candidate = (model: string): ModelCandidate => ({ provider: "fixture", model, monetaryCostUsd: 0, shadowCostUsd: 0.001, utility: 1 } as ModelCandidate);

function comparisonTask(id = "objective-task"): IntelligenceTask {
  const input = "Compare filas e logs append-only para este pipeline e explique os trade-offs.";
  return {
    id,
    input,
    type: "reasoning",
    complexity: 0.5,
    risk: 0.1,
    estimatedTokens: 500,
    requirements: { reasoning: true, planning: true, directResponse: false },
    goalContract: analyzeGoalContract(input, "reasoning")
  };
}

function execution(task: IntelligenceTask, result: string, producer = "producer"): TaskExecution {
  const now = new Date().toISOString();
  return {
    id: "exec-objective",
    task,
    plan: { id: "plan", taskId: task.id, objective: task.input, revision: 1, createdAt: now, steps: [{ id: "answer", description: "Answer", kind: "DIRECT_RESPONSE", status: "COMPLETED" }] },
    state: "EXECUTION_FINISHED",
    executionPhase: "EXECUTION_FINISHED",
    budget: { maxSteps: 10, maxRetries: 1, maxReplans: 0, maxToolInvocations: 0, maxDurationMs: 10_000, maxMonetaryCostUsd: 0, maxShadowCostUsd: 1, maxConsecutiveFailures: 2, maxNoProgressSteps: 2 },
    usage: { steps: 1, toolInvocations: 0, retries: 0, replans: 0, durationMs: 10, monetaryCostUsd: 0, shadowCostUsd: 0.001, consecutiveFailures: 0, noProgressSteps: 0 },
    checkpoints: [],
    steps: [{ id: "step", stepId: "answer", attempt: 1, status: "COMPLETED", startedAt: now, completedAt: now, observationSummary: result }],
    attempts: [{ id: "attempt", taskId: task.id, stepId: "answer", phase: "DIRECT_RESPONSE", attempt: 1, provider: "fixture", model: producer, startedAt: now, completedAt: now, status: "SUCCEEDED", monetaryCostUsd: 0, shadowCostUsd: 0.001 }],
    result,
    economicState: "normal",
    startedAt: now,
    completedAt: now
  };
}

function fakeRouter(models: string[], complete: (system: string, model: string) => string) {
  const attempts = new Map<string, InferenceAttempt>();
  const outcomes: TaskOutcome[] = [];
  const router = {
    route: vi.fn(async (task: IntelligenceTask, economicState: string) => ({ task, economicState, selected: candidate(models[0]!), candidates: models.map(candidate), reason: "fixture", explored: false })),
    canAttempt: vi.fn(async () => true),
    completeForPlanningCandidate: vi.fn(async (messages: Array<{ role: string; content: string }>, model: ModelCandidate) => ({ provider: model.provider, model: model.model, estimatedCostUsd: 0, content: complete(messages[0]?.content ?? "", model.model) })),
    recordAttempt: vi.fn(async (attempt: InferenceAttempt) => { attempts.set(attempt.id, { ...attempt }); }),
    attemptsFor: vi.fn(async (taskId: string) => [...attempts.values()].filter((attempt) => attempt.taskId === taskId)),
    recordOutcome: vi.fn(async (outcome: TaskOutcome) => { outcomes.push(outcome); })
  };
  return { router: router as unknown as ModelRouter, attempts, outcomes, complete: router.completeForPlanningCandidate };
}

describe("objective verification truth", () => {
  it("requires current external evidence instead of accepting a fluent unsupported answer", () => {
    const input = "Qual é a versão estável atual do Python?";
    const task: IntelligenceTask = { ...comparisonTask("current"), input, type: "research", requirements: { browser: true, toolUse: true, tools: ["browser"] }, goalContract: analyzeGoalContract(input, "research") };
    const verdict = new ObjectiveVerifier().evaluate(execution(task, "Python 3.x is current."));
    expect(verdict).toMatchObject({ taskCompleted: false, objectiveStatus: "NEEDS_CAPABILITY", recoveryRecommendation: "ENABLE_CAPABILITY" });
  });

  it("does not let the answer producer certify its own open-ended answer", async () => {
    const task = comparisonTask();
    const { router, complete } = fakeRouter(["producer"], () => JSON.stringify({ satisfied: true }));
    const verdict = await new ModelObjectiveVerifier(router).evaluate(execution(task, "A comparison with trade-offs."));
    expect(verdict).toMatchObject({ taskCompleted: false, objectiveStatus: "NEEDS_CAPABILITY", recoveryRecommendation: "ENABLE_CAPABILITY" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("rejects a neighboring generic answer through an independent structured verdict", async () => {
    const task = comparisonTask();
    const { router } = fakeRouter(["producer", "verifier"], () => JSON.stringify({ satisfied: false, confidence: 96, relevance: true, completeness: false, consistentWithEvidence: true, reason: "It discusses queues but omits append-only logs and material trade-offs.", missingRequirements: ["append-only-log-comparison"], recoveryRecommendation: "RETRY_SYNTHESIS" }));
    const verdict = await new ModelObjectiveVerifier(router).evaluate(execution(task, "Queues decouple producers and consumers."));
    expect(verdict).toMatchObject({ taskCompleted: false, objectiveStatus: "FAILED", recoveryRecommendation: "RETRY_SYNTHESIS", method: "independent-semantic-objective-verifier" });
    expect(verdict.confidence).toBe(0.96);
  });

  it("uses one independent remote verifier before preserving local fallback", async () => {
    const task = comparisonTask("local-verifier");
    const remote = candidate("remote-verifier");
    const local = { ...candidate("local-verifier"), provider: "ollama", local: true, costClass: "FREE_CONFIRMED" as const, externalQuotaConsumption: false, shadowCostUsd: 0 };
    const completeForStructuredCandidate = vi.fn(async (_messages: unknown, model: ModelCandidate) => ({ provider: model.provider, model: model.model, estimatedCostUsd: 0, content: JSON.stringify({ satisfied: true, confidence: 0.9, relevance: true, completeness: true, consistentWithEvidence: true, reason: "Objective and evidence agree.", missingRequirements: [], recoveryRecommendation: "NONE" }) }));
    const router = {
      route: vi.fn(async () => ({ task, economicState: "survival", selected: remote, candidates: [remote, local], reason: "fixture", explored: false })),
      canAttempt: vi.fn(async () => true),
      completeForStructuredCandidate,
      completeForPlanningCandidate: vi.fn(),
      recordAttempt: vi.fn(async () => undefined)
    } as unknown as ModelRouter;
    const verdict = await new ModelObjectiveVerifier(router).evaluate({ ...execution(task, "Queues distribute work while logs retain replayable history."), economicState: "survival" });
    expect(verdict).toMatchObject({ taskCompleted: true, objectiveStatus: "SUCCEEDED" });
    expect(completeForStructuredCandidate.mock.calls[0]?.[1]).toMatchObject({ provider: "fixture", model: "remote-verifier" });
  });

  it("uses one zero-quota local verifier after malformed remote structured output", async () => {
    const task = comparisonTask("local-verifier-after-invalid");
    const remote = candidate("remote-verifier");
    const local = { ...candidate("local-verifier"), provider: "ollama", local: true, costClass: "FREE_CONFIRMED" as const, externalQuotaConsumption: false, shadowCostUsd: 0 };
    const completeForStructuredCandidate = vi.fn(async (_messages: unknown, model: ModelCandidate) => ({
      provider: model.provider,
      model: model.model,
      estimatedCostUsd: 0,
      content: model.local
        ? JSON.stringify({ satisfied: true, confidence: 0.9, relevance: true, completeness: true, consistentWithEvidence: true, reason: "Objective and evidence agree.", missingRequirements: [], recoveryRecommendation: "NONE" })
        : JSON.stringify({ verdict: "PASS", reason: "All criteria satisfied." })
    }));
    const router = {
      route: vi.fn(async () => ({ task, economicState: "survival", selected: remote, candidates: [remote, local], reason: "fixture", explored: false })),
      canAttempt: vi.fn(async () => true),
      completeForStructuredCandidate,
      completeForPlanningCandidate: vi.fn(),
      recordAttempt: vi.fn(async () => undefined)
    } as unknown as ModelRouter;

    const verdict = await new ModelObjectiveVerifier(router).evaluate({ ...execution(task, "Queues distribute work while logs retain replayable history."), economicState: "survival" });

    expect(verdict).toMatchObject({ taskCompleted: true, objectiveStatus: "SUCCEEDED" });
    expect(completeForStructuredCandidate.mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({ provider: "fixture", model: "remote-verifier" }),
      expect.objectContaining({ provider: "ollama", model: "local-verifier" })
    ]);
  });

  it("recovers one refusal with an alternate producer, verifies independently, and attributes the outcome to the recovered producer", async () => {
    const task = comparisonTask("recovery-task");
    const { router, outcomes, complete } = fakeRouter(["first", "alternate"], (system, model) => {
      if (system.includes("independent objective verifier")) return JSON.stringify({ satisfied: true, confidence: 0.91, relevance: true, completeness: true, consistentWithEvidence: true, reason: "The answer compares both mechanisms and their trade-offs.", missingRequirements: [], recoveryRecommendation: "NONE" });
      return model === "first" ? "I don't know." : "Queues coordinate independent consumers; append-only logs additionally retain ordered history for replay. Choose queues for transient work distribution and logs when auditability, replay, and multiple projections justify retention costs.";
    });
    const executor = new AutonomousTaskExecutor({
      toolExecutor: new ToolExecutor(new ToolRegistry()),
      getAvailableTools: async () => [],
      modelRouter: router,
      completionEvaluator: new ModelObjectiveVerifier(router)
    });
    const plan: Plan = { id: "plan", taskId: task.id, objective: task.input, revision: 1, createdAt: new Date().toISOString(), steps: [{ id: "answer", description: "Compare", kind: "DIRECT_RESPONSE", status: "PENDING" }] };
    const outcome = await executor.execute({ task, plan, economicState: "normal", budget: { maxRetries: 1, maxShadowCostUsd: 1 } });

    expect(outcome).toMatchObject({ status: "COMPLETED", success: true, objectiveStatus: "SUCCEEDED" });
    expect(outcome.execution.usage.retries).toBe(1);
    expect(outcome.execution.attempts?.map((attempt) => [attempt.phase, attempt.model, attempt.status])).toEqual([
      ["DIRECT_RESPONSE", "first", "SUCCEEDED"],
      ["DIRECT_RESPONSE", "alternate", "SUCCEEDED"],
      ["OBJECTIVE_VERIFICATION", "first", "SUCCEEDED"]
    ]);
    expect(outcomes.at(-1)).toMatchObject({ provider: "fixture", model: "alternate", success: true, evaluation: { method: "independent-semantic-objective-verifier" } });
    expect(complete).toHaveBeenCalledTimes(3);
  });
});
