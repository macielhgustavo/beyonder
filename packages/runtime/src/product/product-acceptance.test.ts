import { describe, expect, it } from "vitest";
import { ComplexityEstimator } from "../intelligence/complexity-estimator.js";
import { analyzeGoalContract } from "../intelligence/goal-contract.js";
import { TaskClassifier } from "../intelligence/task-classifier.js";
import { ObjectiveVerifier, isObviousNonAnswer, outcomeWithCompletion } from "../tasks/completion.js";
import type { TaskExecution } from "../tasks/contracts.js";
import { NON_ANSWER_REGRESSION_RESULTS, PRODUCT_ACCEPTANCE_CORPUS } from "./product-acceptance-corpus.js";

describe("product acceptance corpus", () => {
  it("contains at least fifty realistic objectives without volatile expected answers", () => {
    expect(PRODUCT_ACCEPTANCE_CORPUS.length).toBeGreaterThanOrEqual(50);
    expect(new Set(PRODUCT_ACCEPTANCE_CORPUS.map((item) => item.category)).size).toBeGreaterThanOrEqual(15);
  });

  it.each(PRODUCT_ACCEPTANCE_CORPUS)("$category: $objective", ({ objective, expected }) => {
    const type = new TaskClassifier().classify(objective);
    const contract = analyzeGoalContract(objective, type);
    const requirements = new ComplexityEstimator().estimate(objective, type, contract).requirements;
    if (expected.intent) expect(contract.primaryIntent).toBe(expected.intent);
    if (expected.freshness) expect(contract.freshness).toBe(expected.freshness);
    if (expected.evidence) expect(contract.evidenceRequirement).toBe(expected.evidence);
    if (expected.clarificationRequired !== undefined) expect(contract.clarificationRequired).toBe(expected.clarificationRequired);
    for (const capability of expected.capabilities ?? []) expect(contract.requiredCapabilities).toContain(capability);
    if (contract.evidenceRequirement === "REQUIRED") expect(requirements).toMatchObject({ browser: true, toolUse: true, directResponse: false, planning: true });
    if (contract.freshness === "CURRENT" || contract.freshness === "REALTIME") expect(contract.evidenceRequirement).toBe("REQUIRED");
  });

  it.each(NON_ANSWER_REGRESSION_RESULTS)("rejects refusal/non-answer: %s", (result) => {
    expect(isObviousNonAnswer(result)).toBe(true);
  });

  it("never verifies the reproduced refusal as success", () => {
    const objective = "qual a linguagem de programacao mais usada hoje";
    const type = new TaskClassifier().classify(objective);
    const goalContract = analyzeGoalContract(objective, type);
    const requirements = new ComplexityEstimator().estimate(objective, type, goalContract).requirements;
    const execution = fixtureExecution(objective, type, requirements, goalContract, "Desculpe, não tenho informações disponíveis sobre qual é a linguagem de programação mais usada hoje.");
    const verdict = new ObjectiveVerifier().evaluate(execution);
    expect(verdict).toMatchObject({ taskCompleted: false, objectiveStatus: "NEEDS_CAPABILITY", recoveryRecommendation: "ENABLE_CAPABILITY" });
  });

  it("retains a produced result with explicit UNVERIFIED status when independent review is unavailable", () => {
    const objective = "Explique árvores binárias de busca.";
    const type = new TaskClassifier().classify(objective);
    const execution = fixtureExecution(objective, type, {}, analyzeGoalContract(objective, type), "Uma árvore binária de busca ordena filhos menores à esquerda e maiores à direita.");
    const outcome = outcomeWithCompletion({ execution, status: "COMPLETED", success: false, result: execution.result }, {
      status: "FAIL", objectiveStatus: "NEEDS_CAPABILITY", taskCompleted: false,
      method: "independent-semantic-objective-verifier", confidence: 1,
      reason: "No independent free verifier available.", dimensions: [],
      missingRequirements: ["independent-objective-verification"], recoveryRecommendation: "ENABLE_CAPABILITY"
    });
    expect(outcome).toMatchObject({ result: execution.result, verificationStatus: "UNVERIFIED", success: false, status: "BLOCKED" });
  });
});

function fixtureExecution(objective: string, type: ReturnType<TaskClassifier["classify"]>, requirements: ReturnType<ComplexityEstimator["estimate"]>["requirements"], goalContract: ReturnType<typeof analyzeGoalContract>, result: string): TaskExecution {
  return {
    id: "exec-product-regression",
    task: { id: "task-product-regression", input: objective, type, complexity: 0.5, risk: 0, estimatedTokens: 500, requirements, goalContract },
    plan: { id: "plan-product-regression", taskId: "task-product-regression", objective, createdAt: new Date(0).toISOString(), revision: 1, steps: [{ id: "respond", kind: "DIRECT_RESPONSE", description: "Respond", status: "COMPLETED" }] },
    state: "EXECUTION_FINISHED",
    budget: { maxSteps: 12, maxToolInvocations: 20, maxRetries: 2, maxReplans: 2, maxDurationMs: 120_000, maxMonetaryCostUsd: 0, maxShadowCostUsd: 0.02, maxConsecutiveFailures: 3, maxNoProgressSteps: 3 },
    usage: { steps: 1, toolInvocations: 0, retries: 0, replans: 0, durationMs: 10, monetaryCostUsd: 0, shadowCostUsd: 0, consecutiveFailures: 0, noProgressSteps: 0 },
    checkpoints: [], steps: [{ id: "step", stepId: "respond", attempt: 1, status: "COMPLETED", startedAt: new Date(0).toISOString(), completedAt: new Date(0).toISOString(), observationSummary: result }], startedAt: new Date(0).toISOString(), result
  };
}
