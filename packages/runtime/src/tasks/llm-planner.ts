import type { ToolDescriptor } from "@beyonder/tools";
import type { MemoryEngine, RetrievedMemory } from "../memory/memory-engine.js";
import type { EconomicState, ModelMessage } from "../types.js";
import type { ModelRouter } from "../models/model-router.js";
import type { IntelligenceTask } from "../intelligence/contracts.js";
import type { Plan } from "./contracts.js";
import type { PlanRequest, Planner, ReplanRequest } from "./planner.js";
import { DeterministicPlanner, validatePlan } from "./planner.js";

export interface LlmPlannerOptions {
  modelRouter: ModelRouter;
  deterministicFallback?: Planner;
  maxCandidates?: number;
  memory?: MemoryEngine;
}

export interface LlmPlannerResult {
  plan: Plan;
  provider: string;
  model: string;
  usedFallback: boolean;
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
    const planningTask: IntelligenceTask = {
      ...request.task,
      type: "planning",
      requirements: { ...request.task.requirements, structuredOutput: true }
    };
    const route = await this.options.modelRouter.route(planningTask, request.economicState);
    const candidates = route.candidates.slice(0, this.maxCandidates);
    const messages = planningPrompt(request);

    for (const candidate of candidates) {
      try {
        const planningCompletion = this.options.modelRouter.completeForPlanningCandidate?.bind(this.options.modelRouter) ?? this.options.modelRouter.completeForCandidate.bind(this.options.modelRouter);
        const response = await planningCompletion(messages, candidate);
        const parsed = parsePlanJson(response.content);
        const validation = validatePlan(parsed, { availableTools: request.availableTools, budget: request.budget });
        if (!validation.valid || validation.plan.taskId !== request.task.id) continue;
        return { plan: validation.plan, provider: response.provider, model: response.model, usedFallback: false };
      } catch {
        // Operational model failures move to the next bounded candidate.
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
        "JSON shape: {id:string, taskId:string, objective:string, createdAt:string, revision:number, steps:[{id:string,description:string,status:\"PENDING\",expectedOutcome?:string,allowedToolCapabilities?:string[],dependencies?:string[]}]}"
      ].join(" ")
    },
    {
      role: "user",
      content: JSON.stringify({
        objective: request.objective,
        taskId: request.task.id,
        taskType: request.task.type,
        complexity: request.task.complexity,
        economicState: request.economicState,
        budget: request.budget,
        availableTools: tools,
        relevantMemory: memories || "none"
      })
    }
  ];
}

function parsePlanJson(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}
