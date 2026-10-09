import { fixtureZeroCost } from '../models/testing/zero-cost-fixture.js';
import { ToolExecutor, ToolRegistry, ToolRisk, ToolSideEffect, createToolInputSchema, type ToolDefinition } from "@beyonder/tools";
import { openDatabase } from "../db/client.js";
import { StateStore } from "../memory/state-store.js";
import type { ModelCandidate, RouteDecision } from "../models/adaptive-types.js";
import type { ModelResponse } from "../types.js";
import type { IntelligenceTask } from "../intelligence/contracts.js";
import { StateTaskCheckpointStore } from "./checkpoints.js";
import { LlmPlanner } from "./llm-planner.js";
import { AutonomousTaskExecutor } from "./task-executor.js";
import { DEFAULT_TASK_BUDGET } from "./contracts.js";

const task: IntelligenceTask = { id: "hardening-smoke-task", input: "Read the hardening fixture", type: "planning", complexity: 0.2, risk: 0, estimatedTokens: 120, requirements: {} };
const descriptor = { id: "hardening.fixture", name: "Hardening Fixture", description: "Deterministic smoke tool", risk: ToolRisk.LOW, sideEffects: [ToolSideEffect.READ], capabilities: ["hardening.fixture"] };

const candidate = { economics: fixtureZeroCost("fixture-llm", "fixture-planner-1"), provider: "fixture-llm", model: "fixture-planner-1", capabilities: ["text"], contextWindow: 4096, toolCalling: "no", predictedQuality: 1, historicalSuccess: 1, reliability: 1, monetaryCostUsd: 0, shadowCostUsd: 0, latencyPenalty: 0, failureRisk: 0, effectiveResourceCost: 0, utility: 1, quota: { provider: "fixture-llm", model: "fixture-planner-1", requestsPerMinute: "unknown", requestsPerDay: "unknown", tokensPerMinute: "unknown", tokensPerDay: "unknown", requestQuotaTotal: "unknown", requestQuotaRemaining: "unknown", tokenQuotaTotal: "unknown", tokenQuotaRemaining: "unknown", resetAt: "unknown", health: "healthy", lastUpdatedAt: "smoke" }, performance: { provider: "fixture-llm", model: "fixture-planner-1", taskType: "planning", samples: 1, successes: 1, failures: 0, successRate: 1, avgEvaluationScore: 1, avgLatencyMs: 0, avgMonetaryCostUsd: 0, avgShadowCostUsd: 0, avgAttempts: 1 }, benchmarkCapability: null, capabilityEvidence: { bibScore: null, bibSamples: 0, realScore: 1, realSamples: 1, predictedScore: 1, source: "outcomes" as const }, explanation: { positives: [], penalties: [], constraints: [] } } as unknown as ModelCandidate;

const router = {
  route: async (): Promise<RouteDecision> => ({ task, economicState: "normal", candidates: [candidate], selected: candidate, explored: false, reason: "hardening smoke" }),
  completeForCandidate: async (): Promise<ModelResponse> => ({ provider: "fixture-llm", model: "fixture-planner-1", estimatedCostUsd: 0, content: JSON.stringify({ id: "hardening-plan", taskId: task.id, objective: task.input, createdAt: new Date(0).toISOString(), revision: 1, steps: [{ id: "read", description: "Read fixture", status: "PENDING", allowedToolCapabilities: ["hardening.fixture"] }] }) })
};

const definition: ToolDefinition = { ...descriptor, inputSchema: createToolInputSchema((input) => ({ success: true as const, data: input })), execute: async () => ({ output: "BEYONDER_LLM_PLANNER_OK" }) };
const registry = new ToolRegistry().register(definition);
const planner = new LlmPlanner({ modelRouter: router as never });
const plan = await planner.createPlan({ objective: task.input, task, memoryContext: [], availableTools: [descriptor], budget: DEFAULT_TASK_BUDGET, economicState: "normal" });
const executor = new AutonomousTaskExecutor({ toolExecutor: new ToolExecutor(registry), actionPlanner: { decide: () => ({ call: { id: "fixture-call", tool: "hardening.fixture", arguments: {} } }) } });
const outcome = await executor.execute({ task, plan, economicState: "normal", completionCriteria: { expectedText: "BEYONDER_LLM_PLANNER_OK" } });

const { db, sqlite } = openDatabase(":memory:");
const checkpointStore = new StateTaskCheckpointStore(new StateStore(db));
const abortController = new AbortController();
let interruptedCalls = 0;
const interrupting = new ToolRegistry().register({ ...definition, execute: async () => { interruptedCalls += 1; abortController.abort(); return { output: "checkpointed" }; } });
const interrupted = await new AutonomousTaskExecutor({ toolExecutor: new ToolExecutor(interrupting), checkpointStore }).execute({ task: { ...task, id: "hardening-resume-task" }, plan: { ...plan, taskId: "hardening-resume-task", steps: [{ ...plan.steps[0], id: "first", action: { id: "first-call", tool: "hardening.fixture", arguments: {} } }, { ...plan.steps[0], id: "second", action: { id: "second-call", tool: "hardening.fixture", arguments: {} }, dependencies: ["first"] }] }, economicState: "normal", signal: abortController.signal });
const saved = await checkpointStore.get("hardening-resume-task");
const resumed = await new AutonomousTaskExecutor({ toolExecutor: new ToolExecutor(new ToolRegistry().register(definition)), checkpointStore }).resume({ execution: saved!, economicState: "normal", completionCriteria: { expectedText: "BEYONDER_LLM_PLANNER_OK" } });

console.log(JSON.stringify({
  llmPlanner: { provider: planner.lastResult?.provider, model: planner.lastResult?.model, usedFallback: planner.lastResult?.usedFallback, planRevision: plan.revision, status: outcome.status, result: outcome.result, monetaryCostUsd: outcome.execution.usage.monetaryCostUsd },
  checkpointResume: { interruptedStatus: interrupted.status, savedCompletedSteps: saved?.plan.steps.filter((step) => step.status === "COMPLETED").map((step) => step.id), resumedStatus: resumed.status, resumedToolInvocations: resumed.execution.usage.toolInvocations, firstProcessCalls: interruptedCalls, monetaryCostUsd: resumed.execution.usage.monetaryCostUsd }
}, null, 2));
sqlite.close();
if (outcome.status !== "COMPLETED" || resumed.status !== "COMPLETED") process.exitCode = 1;
