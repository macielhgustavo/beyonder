import type { ToolDescriptor } from "@beyonder/tools";
import type { MemoryEngine, RetrievedMemory } from "../memory/memory-engine.js";
import type { EconomicState, ModelMessage } from "../types.js";
import type { ModelRouter } from "../models/model-router.js";
import type { IntelligenceTask } from "../intelligence/contracts.js";
import type { Plan } from "./contracts.js";
import type { PlanRequest, Planner, ReplanRequest } from "./planner.js";
import { DeterministicPlanner, validatePlan } from "./planner.js";
import { classifyFailure, InferenceError, parseStructuredObject, runCandidates } from "../models/inference.js";
import { getEconomicRoutingPolicy } from "../models/router-config.js";

export interface LlmPlannerOptions {
  modelRouter: ModelRouter;
  allowDeterministicFallback?: boolean;
  deterministicFallback?: Planner;
  maxCandidates?: number;
  memory?: MemoryEngine;
}

export interface LlmPlannerResult {
  plan: Plan;
  provider: string;
  model: string;
  usedFallback: boolean;
  monetaryCostUsd?: number;
  shadowCostUsd?: number;
}

export class LlmPlanner implements Planner {
  private readonly fallback: Planner;
  private readonly maxCandidates: number;
  lastResult?: LlmPlannerResult;

  constructor(private readonly options: LlmPlannerOptions) {
    this.fallback = options.deterministicFallback ?? new DeterministicPlanner();
    this.maxCandidates = Math.max(1, Math.min(5, Math.floor(options.maxCandidates ?? 3)));
  }

  async createPlan(request: PlanRequest): Promise<Plan> {
    const result = await this.planWithCandidates(request);
    this.lastResult = result;
    return result.plan;
  }

  async revisePlan(request: ReplanRequest): Promise<Plan> {
    const result = await this.planWithCandidates({
      ...request,
      objective: request.objective,
      memoryContext: [...request.memoryContext, ...request.observations.map((content) => ({
        id: `observation-${request.previousPlan.revision}`,
        kind: "episodic" as const,
        content,
        score: 1,
        importance: 1,
        confidence: 1,
        utility: 1,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        accessCount: 0,
        keywords: [],
        metadata: {}
      }))]
    });
    this.lastResult = result;
    return {
      ...result.plan,
      id: result.plan.id,
      revision: Math.max(request.previousPlan.revision + 1, result.plan.revision)
    };
  }

  private async planWithCandidates(request: PlanRequest): Promise<LlmPlannerResult> {
    this.lastResult = undefined;
    if (request.task.requirements.directResponse && !request.task.requirements.toolUse) {
      return { plan: { id: `plan_${request.task.id}`, taskId: request.task.id, objective: request.objective, revision: 1, createdAt: new Date().toISOString(), steps: [{ id: "respond", kind: "DIRECT_RESPONSE", description: "Respond to the objective without external actions.", status: "PENDING" }] }, provider: "deterministic", model: "direct-response-plan", usedFallback: false };
    }
    const planningTask: IntelligenceTask = {
      ...request.task,
      type: "planning",
      requirements: { ...request.task.requirements, structuredOutput: true }
    };
    const route = await this.options.modelRouter.route(planningTask, request.economicState);
    const candidates = route.candidates.filter((candidate) => candidate.monetaryCostUsd <= request.budget.maxMonetaryCostUsd);
    const messages = planningPrompt(request);

    try {
      const result = await runCandidates({ taskId: request.task.id, phase: "previousPlan" in request ? "REPLANNING" : "PLANNING", candidates, messages, maxCandidates: Math.min(this.maxCandidates, getEconomicRoutingPolicy(request.economicState).maxAttempts),
        maxMonetaryCostUsd: request.budget.maxMonetaryCostUsd, maxShadowCostUsd: request.budget.maxShadowCostUsd, maxDurationMs: request.budget.maxDurationMs,
        complete: this.options.modelRouter.completeForPlanningCandidate?.bind(this.options.modelRouter) ?? this.options.modelRouter.completeForCandidate.bind(this.options.modelRouter),
        record: this.options.modelRouter.recordAttempt?.bind(this.options.modelRouter),
        validate: (response) => {
        const parsed = parseStructuredObject(response.content);
        const validation = validatePlan(parsed, { availableTools: request.availableTools, budget: request.budget });
        if (!validation.valid || validation.plan.taskId !== request.task.id) throw new InferenceError("Model returned an invalid plan.", "INVALID_OUTPUT");
        if (request.task.requirements.calculator) {
          if (!validation.plan.steps.some((step) => step.kind !== "DIRECT_RESPONSE" && (step.action?.tool === "calculator" || step.allowedToolCapabilities?.includes("calculation")))) throw new InferenceError("Calculator requirement cannot be replaced with a model answer.", "INVALID_ACTION");
        }
        return validation.plan;
      }});
      return { plan: result.value, provider: result.response.provider, model: result.response.model, usedFallback: false, monetaryCostUsd: result.monetaryCostUsd, shadowCostUsd: result.shadowCostUsd };
    } catch (error) {
      if (this.options.allowDeterministicFallback === false) {
        const attempts = await this.options.modelRouter.attemptsFor?.(request.task.id) ?? [];
        const last = attempts.at(-1);
        const failure = classifyFailure(error);
        await this.options.memory?.recordOutcome({ task: request.task, attempts: attempts.map((attempt) => ({ ...attempt, tools: [], success: attempt.status === "SUCCEEDED" })), success: false, error: failure.message, failureClass: failure.failureClass, phase: last?.phase ?? "PLANNING", provider: last?.provider, model: last?.model, tokens: 0, monetaryCostUsd: attempts.reduce((sum, a) => sum + a.monetaryCostUsd, 0), shadowCostUsd: attempts.reduce((sum, a) => sum + a.shadowCostUsd, 0), latencyMs: attempts.reduce((sum, a) => sum + (a.latencyMs ?? 0), 0), tools: [], completedAt: new Date().toISOString() });
        throw error;
      }
    }

    return {
      plan: await this.fallback.createPlan(request),
      provider: "deterministic",
      model: "fallback",
      usedFallback: true
    };
  }
}

function planningPrompt(request: PlanRequest): ModelMessage[] {
  const tools = request.availableTools.map((tool) => ({ id: tool.id, capabilities: tool.capabilities, description: tool.description })).slice(0, 40);
  const memories = request.memoryContext.map((memory) => `${memory.kind}: ${memory.content}`).join("\n").slice(0, 1800);
  return [
    {
      role: "system",
      content: [
        "You are Beyonder's planning component.",
        "Return ONLY one JSON object. No markdown, prose, comments, or code fences.",
        "Use only the listed tool ids and capabilities.",
        "Never request shell, unrestricted filesystem, payment, purchase, account creation, CAPTCHA/2FA/KYC bypass.",
        "Keep the plan within the supplied maxSteps and use dependencies only for listed step ids.",
        "For a single arithmetic operation, use one calculator step. Do not add a tool step to format, repeat or present the result: the executor presents tool output directly.",
        "Response-only steps use kind DIRECT_RESPONSE, never a fake tool. A response after tool use must depend on preceding tool steps.",
        "JSON shape: {id:string, taskId:string, objective:string, createdAt:string, revision:number, steps:[{id:string,kind?:\"TOOL\"|\"DIRECT_RESPONSE\",description:string,status:\"PENDING\",expectedOutcome?:string,allowedToolCapabilities?:string[],dependencies?:string[]}]}"
      ].join(" ")
    },
    {
      role: "user",
      content: JSON.stringify({
        objective: request.objective,
        taskId: request.task.id,
        taskType: request.task.type,
        requirements: request.task.requirements,
        complexity: request.task.complexity,
        economicState: request.economicState,
        budget: request.budget,
        availableTools: tools,
        relevantMemory: memories || "none"
      })
    }
  ];
}
