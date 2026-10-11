import { describe, expect, it } from "vitest";
import { analyzeGoalContract } from "../intelligence/goal-contract.js";
import type { AutonomousTaskOutcome, TaskExecution } from "../tasks/contracts.js";
import type { CompletionEvaluation } from "../tasks/completion.js";
import { productMissionMetrics } from "./metrics.js";

function fixture() {
  const objective = "Qual é a versão estável atual do Python?";
  const now = new Date().toISOString();
  const execution = {
    id: "exec", task: { id: "task", input: objective, type: "research", complexity: 0.4, risk: 0, estimatedTokens: 100, requirements: { browser: true, toolUse: true, tools: ["browser"] }, goalContract: analyzeGoalContract(objective, "research") },
    plan: { id: "plan", taskId: "task", objective, revision: 1, createdAt: now, steps: [] }, state: "COMPLETED", executionPhase: "OBJECTIVE_VERIFIED",
    budget: { maxSteps: 1, maxRetries: 1, maxReplans: 0, maxToolInvocations: 1, maxDurationMs: 1000, maxMonetaryCostUsd: 0, maxShadowCostUsd: 1, maxConsecutiveFailures: 1, maxNoProgressSteps: 1 },
    usage: { steps: 1, toolInvocations: 1, retries: 1, replans: 0, durationMs: 120, monetaryCostUsd: 0, shadowCostUsd: 0.02, consecutiveFailures: 0, noProgressSteps: 0 }, checkpoints: [],
    steps: [{ id: "s", stepId: "read", attempt: 1, status: "COMPLETED", startedAt: now, completedAt: now, toolCall: { id: "c", tool: "browser.open", arguments: { url: "https://python.org" } }, toolCapabilities: ["browser"], toolSideEffects: ["READ"], toolResult: { success: true, durationMs: 1, sideEffects: ["READ"], output: { result: { status: "ok", observation: { url: "https://python.org", visibleText: "Python current stable release" } } } } }], startedAt: now, completedAt: now
  } as TaskExecution;
  const evaluation = { status: "PASS", objectiveStatus: "SUCCEEDED", taskCompleted: true, method: "fixture", confidence: 1, reason: "verified", dimensions: [], missingRequirements: [], recoveryRecommendation: "NONE" } as CompletionEvaluation;
  const outcome = { execution, status: "COMPLETED", success: true, objectiveStatus: "SUCCEEDED" } as AutonomousTaskOutcome;
  return { execution, evaluation, outcome };
}

describe("product mission metrics", () => {
  it("records verified current evidence and bounded recovery without inventing false success", () => {
    expect(productMissionMetrics({ ...fixture(), recoveryAttempted: true })).toEqual({
      mission_success_rate: 1, objective_verified_rate: 1, false_success_rate: 0,
      recovery_attempted: true, recovery_success_rate: 1, freshness_routing_accuracy: 1,
      tool_selection_accuracy: 1, evidence_coverage: 1, provider_failure_recovery: null,
      time_to_result_ms: 120, shadow_cost_per_success: 0.02, user_intervention_rate: 0
    });
  });

  it("counts a completed UI state without verification as false success", () => {
    const value = fixture();
    value.evaluation.taskCompleted = false;
    value.evaluation.objectiveStatus = "FAILED";
    expect(productMissionMetrics({ ...value, recoveryAttempted: false })).toMatchObject({ mission_success_rate: 1, objective_verified_rate: 0, false_success_rate: 1 });
  });
});
