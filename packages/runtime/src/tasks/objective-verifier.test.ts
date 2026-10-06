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
  it.each(["Qual é a capital do Canadá?", "O que significa HTTP 410?", "Para que serve uma chave primária em SQL?"])("independently verifies static factual relevance for %s", async (input) => {
    const task = { ...comparisonTask(), input, type: "chat" as const, requirements: { directResponse: true }, goalContract: analyzeGoalContract(input, "chat") };
    const { router } = fakeRouter(["producer", "verifier"], () => JSON.stringify({ satisfied: false, confidence: 0.95, relevance: false, completeness: false, consistentWithEvidence: true, reason: "Neighboring answer is irrelevant", missingRequirements: ["relevant-answer"], recoveryRecommendation: "NONE" }));
    const verdict = await new ModelObjectiveVerifier(router).evaluate(execution(task, "Borboletas têm asas coloridas."));
    expect(verdict.taskCompleted).toBe(false);
    expect(verdict.method).toBe("independent-semantic-objective-verifier");
  });
  it.each(["Retorne somente JSON válido descrevendo HTTP 404.", "Return only valid JSON with ready set to true.", "Forneça somente JSON com status igual pronto."])("enforces explicit JSON output in the goal contract for %s", (input) => {
    const task = { ...comparisonTask(), input, goalContract: analyzeGoalContract(input, "chat") };
    expect(task.goalContract.outputFormat).toBe("JSON");
    expect(new ObjectiveVerifier().evaluate(execution(task, "Plain text instead of JSON"))).toMatchObject({ taskCompleted: false, objectiveStatus: "FAILED", missingRequirements: ["json-output-format"] });
  });
  it("requires current external evidence instead of accepting a fluent unsupported answer", () => {
    const input = "Qual é a versão estável atual do Python?";
    const task: IntelligenceTask = { ...comparisonTask("current"), input, type: "research", requirements: { browser: true, toolUse: true, tools: ["browser"] }, goalContract: analyzeGoalContract(input, "research") };
    const verdict = new ObjectiveVerifier().evaluate(execution(task, "Python 3.x is current."));
    expect(verdict).toMatchObject({ taskCompleted: false, objectiveStatus: "NEEDS_CAPABILITY", recoveryRecommendation: "ENABLE_CAPABILITY" });
  });
  it.each(["vendor/same-model:free", "same_model", "Same-Model"])("rechecks physical independence from the actual gateway response (%s)", async reportedModel => {
    const task = comparisonTask("resolved-alias");
    const verdict = JSON.stringify({ satisfied: true, confidence: 1, relevance: true, completeness: true, consistentWithEvidence: true, reason: "Satisfied", missingRequirements: [], recoveryRecommendation: "NONE" });
    const { router, complete, attempts } = fakeRouter(["gateway-alias", "independent-verifier"], () => verdict);
    complete.mockImplementation(async (_messages, model) => ({ provider: model.provider, model: model.model, estimatedCostUsd: 0, content: verdict, attribution: { requestedModel: model.model, reportedModel: model.model === "gateway-alias" ? reportedModel : "independent-verifier" } }));
    expect(await new ModelObjectiveVerifier(router).evaluate(execution(task, "A complete comparison.", "same-model"))).toMatchObject({ taskCompleted: true });
    expect([...attempts.values()].find(attempt => attempt.model === "gateway-alias")).toMatchObject({ status: "FAILED", failureClass: "INVALID_OUTPUT" });
    expect([...attempts.values()].find(attempt => attempt.model === "independent-verifier")).toMatchObject({ status: "SUCCEEDED" });
  });

  it("rejects incompatible TypeScript before a permissive semantic verdict can certify it", async () => {
    const input = "Implemente um cache LRU em TypeScript com capacidade fixa.";
    const task: IntelligenceTask = { ...comparisonTask("lru"), input, type: "coding", requirements: { coding: true }, goalContract: analyzeGoalContract(input, "coding") };
    const { router, complete } = fakeRouter(["producer", "verifier"], () => JSON.stringify({ satisfied: true, confidence: 1, relevance: true, completeness: true, consistentWithEvidence: true, reason: "Looks correct", missingRequirements: [], recoveryRecommendation: "NONE" }));
    const result = "```typescript\nfunction evict<K,V>(cache:Map<K,V>) { const key=cache.keys().next().value; cache.delete(key); }\n```";
    expect(await new ModelObjectiveVerifier(router).evaluate(execution(task, result))).toMatchObject({ taskCompleted: false, objectiveStatus: "FAILED", missingRequirements: ["typescript-typecheck"] });
    expect(complete).not.toHaveBeenCalled();
  });

  it.each([25, 87, 39])("provides actual completed calculator evidence to independent verification (%s)", async value => {
    const task = { ...comparisonTask(), input: "Explique um cálculo em várias etapas.", goalContract: analyzeGoalContract("Explique um cálculo em várias etapas.", "reasoning") };
    const { router, complete } = fakeRouter(["producer", "verifier"], () => JSON.stringify({ satisfied: true, confidence: 0.95, relevance: true, completeness: true, consistentWithEvidence: true, reason: "Observed calculator result matches", missingRequirements: [], recoveryRecommendation: "NONE" }));
    const ex = execution(task, "Result and explanation: " + value);
    ex.steps.unshift({ ...ex.steps[0]!, toolCall: {id: "calc", tool: "calculator", arguments: {operation: "add", operands: [value, 0]}}, toolResult: {success: true, output: {value}, durationMs: 0, sideEffects: []} });
    expect((await new ModelObjectiveVerifier(router).evaluate(ex)).taskCompleted).toBe(true);
    const request = JSON.parse(complete.mock.calls[0]![0][1]!.content);
    expect(request.toolEvidence).toContainEqual(expect.objectContaining({tool: "calculator", observedOutput: JSON.stringify({value})}));
  });
  it("sends the complete coding result and fails closed above the review limit", async () => {
    const { router, complete } = fakeRouter(["producer", "verifier"], () => JSON.stringify({ satisfied: true, confidence: 0.95, relevance: true, completeness: true, consistentWithEvidence: true, reason: "Complete result reviewed", missingRequirements: [], recoveryRecommendation: "NONE" }));
    const result = "Full program: " + "x".repeat(5_000) + " important final invariant";
    await new ModelObjectiveVerifier(router).evaluate(execution(comparisonTask(), result));
    expect(JSON.parse(complete.mock.calls[0]![0][1]!.content).result).toBe(result);
    expect((await new ModelObjectiveVerifier(router).evaluate(execution(comparisonTask(), "x".repeat(16_001)))).objectiveStatus).toBe("NEEDS_CAPABILITY");
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("does not let the answer producer certify its own open-ended answer", async () => {
    const task = comparisonTask();
    const { router, complete } = fakeRouter(["producer"], () => JSON.stringify({ satisfied: true }));
    const verdict = await new ModelObjectiveVerifier(router).evaluate(execution(task, "A comparison with trade-offs."));
    expect(verdict).toMatchObject({ taskCompleted: false, objectiveStatus: "NEEDS_CAPABILITY", recoveryRecommendation: "ENABLE_CAPABILITY" });
    expect(complete).not.toHaveBeenCalled();
  });

  it.each(["vendor/same-model:free", "same_model", "Same-Model"])("does not invent verifier independence across gateway aliases: %s", async model => {
    const { router, complete } = fakeRouter([model], () => JSON.stringify({ satisfied: true }));
    const verdict = await new ModelObjectiveVerifier(router).evaluate(execution(comparisonTask(), "A comparison with trade-offs.", "same-model"));
    expect(verdict.objectiveStatus).toBe("NEEDS_CAPABILITY");
    expect(verdict.reason).toContain("Only the producer is eligible");
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
  it("records terminal completion after independent verification, separately from execution finish", async () => {
    const task = comparisonTask("terminal-time"); let clock = Date.now();
    const { router } = fakeRouter(["producer", "verifier"], system => {
      if (!system.includes("independent objective verifier")) return "Queues distribute work; append-only logs preserve replayable history.";
      clock += 5_000;
      return JSON.stringify({ satisfied: true, confidence: 0.9, relevance: true, completeness: true, consistentWithEvidence: true, reason: "Comparison is complete", missingRequirements: [], recoveryRecommendation: "NONE" });
    });
    const executor = new AutonomousTaskExecutor({ toolExecutor: new ToolExecutor(new ToolRegistry()), getAvailableTools: async () => [], modelRouter: router, completionEvaluator: new ModelObjectiveVerifier(router), now: () => clock });
    const plan: Plan = { id: "plan", taskId: task.id, objective: task.input, revision: 1, createdAt: new Date(clock).toISOString(), steps: [{ id: "answer", description: "Compare", kind: "DIRECT_RESPONSE", status: "PENDING" }] };
    const { execution: result } = await executor.execute({ task, plan, economicState: "normal" });
    expect(Date.parse(result.completedAt!) - Date.parse(result.executionFinishedAt!)).toBe(5_000);
    expect(result.executionPhase).toBe("OBJECTIVE_VERIFIED");
  });
});
