import { nanoid } from "nanoid";
import type { ToolCall, ToolExecutor } from "@beyonder/tools";
import type { IntelligenceTask, TaskOutcome } from "../intelligence/contracts.js";
import type { MemoryEngine, RetrievedMemory } from "../memory/memory-engine.js";
import type { ModelRouter } from "../models/model-router.js";
import type { EconomicState } from "../types.js";
import {
  DEFAULT_TASK_BUDGET,
  type AutonomousTaskOutcome,
  type ExecutionCheckpoint,
  type Plan,
  type PlanStep,
  type StepActionPlanner,
  type StepContext,
  type StepExecution,
  type TaskBudget,
  type TaskBudgetUsage,
  type TaskExecution,
  type TaskExecutionState,
  type TaskExecutorTelemetry
} from "./contracts.js";
import { DeterministicCompletionEvaluator, outcomeWithCompletion, type CompletionCriteria, type CompletionEvaluator } from "./completion.js";
import { DefaultRecoveryPolicy, type RecoveryPolicy } from "./recovery.js";
import type { Planner } from "./planner.js";
import { validatePlan } from "./planner.js";
import { assertTaskStateTransition, isTerminalTaskState } from "./state-machine.js";
import type { TaskCheckpointStore } from "./checkpoints.js";

export interface TaskExecutorOptions {
  memory?: MemoryEngine;
  modelRouter?: ModelRouter;
  toolExecutor: ToolExecutor;
  getAvailableTools?: (context?: Parameters<ToolExecutor["execute"]>[1]) => Promise<StepContext["availableTools"]>;
  telemetry?: TaskExecutorTelemetry;
  actionPlanner?: StepActionPlanner;
  planner?: Planner;
  recoveryPolicy?: RecoveryPolicy;
  completionEvaluator?: CompletionEvaluator;
  checkpointStore?: TaskCheckpointStore;
  now?: () => number;
  id?: () => string;
}

export interface ExecuteTaskRequest {
  task: IntelligenceTask;
  plan: Plan;
  economicState: EconomicState;
  budget?: Partial<TaskBudget>;
  completionCriteria?: CompletionCriteria;
  signal?: AbortSignal;
}

export interface ResumeTaskRequest {
  execution: TaskExecution;
  economicState: EconomicState;
  completionCriteria?: CompletionCriteria;
  signal?: AbortSignal;
}

const EMPTY_USAGE: TaskBudgetUsage = {
  steps: 0,
  toolInvocations: 0,
  retries: 0,
  replans: 0,
  durationMs: 0,
  monetaryCostUsd: 0,
  shadowCostUsd: 0,
  consecutiveFailures: 0,
  noProgressSteps: 0
};

export class AutonomousTaskExecutor {
  private readonly now: () => number;
  private readonly id: () => string;
  private readonly recoveryPolicy: RecoveryPolicy;
  private readonly completionEvaluator: CompletionEvaluator;

  constructor(private readonly options: TaskExecutorOptions) {
    this.now = options.now ?? Date.now;
    this.id = options.id ?? (() => nanoid());
    this.recoveryPolicy = options.recoveryPolicy ?? new DefaultRecoveryPolicy();
    this.completionEvaluator = options.completionEvaluator ?? new DeterministicCompletionEvaluator();
  }

  async execute(request: ExecuteTaskRequest): Promise<AutonomousTaskOutcome> {
    const budget = normalizeBudget(request.budget);
    const execution: TaskExecution = {
      id: `exec_${this.id()}`,
      task: request.task,
      plan: clonePlan(request.plan),
      state: "CREATED",
      budget,
      usage: { ...EMPTY_USAGE },
      checkpoints: [],
      steps: [],
      startedAt: new Date(this.now()).toISOString()
    };

    return this.runExecution(execution, request);
  }

  async resume(request: ResumeTaskRequest): Promise<AutonomousTaskOutcome> {
    const execution = cloneExecution(request.execution);
    if (isTerminalTaskState(execution.state)) throw new Error(`Task '${execution.task.id}' is already terminal: ${execution.state}.`);
    for (const step of execution.plan.steps) {
      if (step.status === "RUNNING") step.status = "PENDING";
    }
    execution.state = "READY";
    execution.completedAt = undefined;
    execution.error = undefined;
    return this.runExecution(execution, {
      task: execution.task,
      plan: execution.plan,
      economicState: request.economicState,
      completionCriteria: request.completionCriteria,
      signal: request.signal,
      budget: execution.budget
    });
  }

  private async runExecution(execution: TaskExecution, request: ExecuteTaskRequest): Promise<AutonomousTaskOutcome> {
    if (execution.state === "CREATED" || execution.state === "PLANNING") {
      await this.transition(execution, "READY", { planId: execution.plan.id });
    }
    await this.transition(execution, "RUNNING", { objective: execution.plan.objective });

    while (!isTerminalTaskState(execution.state)) {
      execution.usage.durationMs = this.now() - Date.parse(execution.startedAt);
      const terminal = budgetTerminalState(execution, request.signal);
      if (terminal) {
        await this.finish(execution, terminal.state, terminal.reason);
        break;
      }

      const step = nextReadyStep(execution.plan.steps);
      if (!step) {
        const pendingBlocked = execution.plan.steps.some((candidate) => candidate.status === "BLOCKED");
        await this.finish(execution, pendingBlocked ? "BLOCKED" : "COMPLETED", pendingBlocked ? "plan-blocked" : undefined);
        break;
      }

      await this.runStep(execution, step, request);
    }

    const outcome = outcomeWithCompletion(toOutcome(execution), this.completionEvaluator.evaluate(execution, request.completionCriteria));
    await this.recordMemory(outcome);
    await this.options.modelRouter?.recordOutcome(toTaskOutcome(outcome));
    return outcome;
  }

  private async runStep(execution: TaskExecution, step: PlanStep, request: ExecuteTaskRequest): Promise<void> {
    step.status = "RUNNING";
    execution.usage.steps += 1;
    await this.telemetry("info", "step.started", { taskId: execution.task.id, planId: execution.plan.id, stepId: step.id });

    const startedAt = this.now();
    const route = await this.options.modelRouter?.route(workloadTask(execution.task, step), request.economicState);
    const memory = await this.retrieveMemory(execution.task, step);
    const availableTools = await this.availableTools(execution, request.economicState);
    const action = await this.actionForStep({
      objective: execution.plan.objective,
      planSummary: summarizePlan(execution.plan),
      currentStep: step,
      recentCheckpoints: execution.checkpoints.slice(-4),
      relevantMemory: memory,
      latestObservation: execution.checkpoints.at(-1)?.observationSummary,
      availableTools,
      remainingBudget: remainingBudget(execution),
      selectedModel: route?.selected
    });

    const stepExecution: StepExecution = {
      id: `step_${this.id()}`,
      stepId: step.id,
      attempt: attemptsForStep(execution, step.id) + 1,
      status: "RUNNING",
      startedAt: new Date(startedAt).toISOString(),
      toolCall: action,
      ...(route ? {
        route: {
          reason: route.reason,
          explored: route.explored,
          candidates: route.candidates.length,
          ...(route.selected ? {
            selected: {
              provider: route.selected.provider,
              model: route.selected.model,
              utility: route.selected.utility,
              shadowCostUsd: route.selected.shadowCostUsd
            }
          } : {})
        }
      } : {})
    };
    execution.steps.push(stepExecution);

    const result = await this.options.toolExecutor.execute(action, {
      taskId: execution.task.id,
      economicState: request.economicState,
      budget: {
        maxInvocations: execution.budget.maxToolInvocations,
        maxDurationMs: execution.budget.maxDurationMs,
        maxMonetaryCostUsd: execution.budget.maxMonetaryCostUsd,
        maxShadowCostUsd: execution.budget.maxShadowCostUsd
      },
      budgetUsage: {
        invocationCount: execution.usage.toolInvocations,
        durationMs: execution.usage.durationMs,
        monetaryCostUsd: execution.usage.monetaryCostUsd,
        shadowCostUsd: execution.usage.shadowCostUsd
      },
      metadata: { planId: execution.plan.id, stepId: step.id }
    });

    execution.usage.toolInvocations += 1;
    execution.usage.durationMs = this.now() - Date.parse(execution.startedAt);
    execution.usage.monetaryCostUsd += numeric(result.metadata?.monetaryCostUsd);
    execution.usage.shadowCostUsd += numeric(result.metadata?.shadowCostUsd);

    stepExecution.toolResult = result;
    stepExecution.completedAt = new Date(this.now()).toISOString();
    stepExecution.observationSummary = summarizeObservation(result);

    if (result.success && isPolicyBlockedOutput(result.output)) {
      step.status = "BLOCKED";
      stepExecution.status = "BLOCKED";
      execution.usage.consecutiveFailures = 0;
      await this.transition(execution, "BLOCKED", { stepId: step.id, reason: "POLICY_DENIED" });
      await this.telemetry("warn", "step.failed", {
        taskId: execution.task.id,
        planId: execution.plan.id,
        stepId: step.id,
        error: { code: "POLICY_DENIED", message: "The tool returned a policy-blocked result." }
      });
    } else if (result.success) {
      step.status = "COMPLETED";
      stepExecution.status = "COMPLETED";
      execution.usage.consecutiveFailures = 0;
      execution.usage.noProgressSteps = noProgressCount(execution, stepExecution.observationSummary);
      await this.telemetry("info", "step.completed", { taskId: execution.task.id, planId: execution.plan.id, stepId: step.id });
    } else {
      stepExecution.error = result.error?.message ?? "tool execution failed";
      execution.usage.consecutiveFailures += 1;
      const recovery = this.recoveryPolicy.decide({
        step,
        failure: {
          code: result.error?.code,
          message: result.error?.message ?? "Tool execution failed."
        },
        attemptCount: stepExecution.attempt,
        previousObservations: execution.steps.map((candidate) => candidate.observationSummary).filter((value): value is string => Boolean(value)),
        remainingBudget: remainingBudget(execution)
      });
      await this.telemetry("info", "recovery.decision", {
        taskId: execution.task.id,
        planId: execution.plan.id,
        stepId: step.id,
        decision: recovery.type,
        reason: recovery.reason
      });

      if (recovery.type === "BLOCK") {
        step.status = "BLOCKED";
        stepExecution.status = "BLOCKED";
        await this.transition(execution, "BLOCKED", { stepId: step.id, reason: result.error?.code });
      } else if (recovery.type === "RETRY" && execution.usage.retries < execution.budget.maxRetries) {
        execution.usage.retries += 1;
        step.status = "PENDING";
        stepExecution.status = "FAILED";
        await this.transition(execution, "RECOVERING", { stepId: step.id, reason: result.error?.code });
        await this.transition(execution, "RUNNING", { stepId: step.id, decision: "retry" });
      } else if (recovery.type === "REPLAN" && execution.usage.replans < execution.budget.maxReplans) {
        execution.usage.replans += 1;
        step.status = "FAILED";
        stepExecution.status = "FAILED";
        await this.transition(execution, "REPLANNING", { stepId: step.id, reason: recovery.reason });
        const revised = await this.replan(execution, request, step, recovery.reason);
        if (revised) {
          await this.transition(execution, "READY", { planId: revised.id, revision: revised.revision });
          await this.transition(execution, "RUNNING", { planId: revised.id, revision: revised.revision });
        } else {
          await this.transition(execution, "FAILED", { stepId: step.id, reason: "replan-required" });
        }
      } else {
        step.status = "FAILED";
        stepExecution.status = "FAILED";
        await this.transition(execution, "FAILED", { stepId: step.id, reason: recovery.reason });
      }
      await this.telemetry("warn", "step.failed", { taskId: execution.task.id, planId: execution.plan.id, stepId: step.id, error: result.error });
    }

    await this.checkpoint(execution, stepExecution.observationSummary);

    if (!isTerminalTaskState(execution.state) && execution.usage.noProgressSteps >= execution.budget.maxNoProgressSteps) {
      await this.transition(execution, "FAILED", { reason: "NO_PROGRESS", noProgressSteps: execution.usage.noProgressSteps });
      execution.error = "NO_PROGRESS";
    }
  }

  private async actionForStep(context: StepContext): Promise<ToolCall> {
    if (context.currentStep.action) return context.currentStep.action;
    const decision = await this.options.actionPlanner?.decide(context);
    if (!decision) throw new Error(`Step '${context.currentStep.id}' has no action and no action planner is configured.`);
    return decision.call;
  }

  private async replan(execution: TaskExecution, request: ExecuteTaskRequest, failedStep: PlanStep, reason: string): Promise<Plan | undefined> {
    const planner = this.options.planner;
    if (!planner?.revisePlan) return undefined;
    const availableTools = await this.availableTools(execution, request.economicState);
    const revised = await planner.revisePlan({
      objective: execution.plan.objective,
      task: execution.task,
      memoryContext: await this.retrieveMemory(execution.task, failedStep),
      availableTools,
      budget: execution.budget,
      economicState: request.economicState,
      previousPlan: execution.plan,
      completedSteps: execution.plan.steps.filter((candidate) => candidate.status === "COMPLETED"),
      failedStep,
      observations: execution.steps.map((candidate) => candidate.observationSummary).filter((value): value is string => Boolean(value)),
      reason
    });
    const validation = validatePlan(revised, { availableTools, budget: execution.budget });
    if (!validation.valid || revised.revision <= execution.plan.revision) {
      await this.telemetry("warn", "plan.revised", {
        taskId: execution.task.id,
        planId: execution.plan.id,
        valid: false,
        issues: validation.valid ? ["revision-not-incremented"] : validation.issues
      });
      return undefined;
    }
    execution.plan = clonePlan(revised);
    await this.telemetry("info", "plan.revised", {
      taskId: execution.task.id,
      planId: revised.id,
      revision: revised.revision,
      preservedSteps: revised.steps.filter((candidate) => candidate.status === "COMPLETED").map((candidate) => candidate.id)
    });
    return revised;
  }

  private async retrieveMemory(task: IntelligenceTask, step: PlanStep): Promise<RetrievedMemory[]> {
    return this.options.memory?.retrieve({ query: `${task.input}\n${step.description}`, taskType: task.type, limit: 4 }) ?? [];
  }

  private async availableTools(execution: TaskExecution, economicState: EconomicState) {
    return this.options.getAvailableTools?.({ taskId: execution.task.id, economicState }) ?? [];
  }

  private async checkpoint(execution: TaskExecution, observationSummary?: string) {
    const checkpoint: ExecutionCheckpoint = {
      taskId: execution.task.id,
      planId: execution.plan.id,
      stepIndex: execution.usage.steps,
      state: execution.state,
      observationSummary,
      completedSteps: execution.plan.steps.filter((step) => step.status === "COMPLETED").map((step) => step.id),
      pendingSteps: execution.plan.steps.filter((step) => step.status === "PENDING").map((step) => step.id),
      toolInvocations: execution.usage.toolInvocations,
      monetaryCostUsd: execution.usage.monetaryCostUsd,
      shadowCostUsd: execution.usage.shadowCostUsd,
      timestamp: new Date(this.now()).toISOString()
    };
    execution.checkpoints.push(checkpoint);
    await this.options.checkpointStore?.save(execution);
    await this.telemetry("info", "task.checkpoint", { ...checkpoint });
  }

  private async finish(execution: TaskExecution, state: TaskExecutionState, reason?: string) {
    await this.transition(execution, state, { reason });
    execution.completedAt = new Date(this.now()).toISOString();
    execution.error = reason;
    execution.result = finalResult(execution);
  }

  private async transition(execution: TaskExecution, state: TaskExecutionState, details: Record<string, unknown> = {}) {
    if (execution.state === state) return;
    assertTaskStateTransition(execution.state, state);
    const previous = execution.state;
    execution.state = state;
    await this.telemetry(levelForState(state), eventForState(state), {
      taskId: execution.task.id,
      planId: execution.plan.id,
      previousState: previous,
      state,
      ...details
    });
  }

  private async recordMemory(outcome: AutonomousTaskOutcome) {
    await this.options.memory?.recordOutcome(toTaskOutcome(outcome));
  }

  private async telemetry(level: "debug" | "info" | "warn" | "error", event: string, details: Record<string, unknown>) {
    await this.options.telemetry?.record(level, event, details);
  }
}

function normalizeBudget(overrides: Partial<TaskBudget> | undefined): TaskBudget {
  return { ...DEFAULT_TASK_BUDGET, ...overrides };
}

function nextReadyStep(steps: PlanStep[]): PlanStep | undefined {
  return steps.find((step) => step.status === "PENDING" && (step.dependencies ?? []).every((id) => steps.find((candidate) => candidate.id === id)?.status === "COMPLETED"));
}

function clonePlan(plan: Plan): Plan {
  return {
    ...plan,
    steps: plan.steps.map((step) => ({ ...step, dependencies: step.dependencies ? [...step.dependencies] : undefined }))
  };
}

function cloneExecution(execution: TaskExecution): TaskExecution {
  return JSON.parse(JSON.stringify(execution)) as TaskExecution;
}

function budgetTerminalState(execution: TaskExecution, signal?: AbortSignal): { state: TaskExecutionState; reason: string } | null {
  if (signal?.aborted) return { state: "CANCELLED", reason: "cancelled" };
  if (execution.usage.steps >= execution.budget.maxSteps) return { state: "BUDGET_EXHAUSTED", reason: "maxSteps" };
  if (execution.usage.toolInvocations >= execution.budget.maxToolInvocations) return { state: "BUDGET_EXHAUSTED", reason: "maxToolInvocations" };
  if (execution.usage.retries > execution.budget.maxRetries) return { state: "BUDGET_EXHAUSTED", reason: "maxRetries" };
  if (execution.usage.replans > execution.budget.maxReplans) return { state: "BUDGET_EXHAUSTED", reason: "maxReplans" };
  if (execution.usage.durationMs >= execution.budget.maxDurationMs) return { state: "BUDGET_EXHAUSTED", reason: "maxDurationMs" };
  if (execution.usage.monetaryCostUsd > execution.budget.maxMonetaryCostUsd) return { state: "BUDGET_EXHAUSTED", reason: "maxMonetaryCostUsd" };
  if (execution.usage.shadowCostUsd > execution.budget.maxShadowCostUsd) return { state: "BUDGET_EXHAUSTED", reason: "maxShadowCostUsd" };
  if (execution.usage.consecutiveFailures >= execution.budget.maxConsecutiveFailures) return { state: "FAILED", reason: "maxConsecutiveFailures" };
  return null;
}

function attemptsForStep(execution: TaskExecution, stepId: string): number {
  return execution.steps.filter((step) => step.stepId === stepId).length;
}

function remainingBudget(execution: TaskExecution): TaskBudgetUsage {
  return {
    steps: Math.max(0, execution.budget.maxSteps - execution.usage.steps),
    toolInvocations: Math.max(0, execution.budget.maxToolInvocations - execution.usage.toolInvocations),
    retries: Math.max(0, execution.budget.maxRetries - execution.usage.retries),
    replans: Math.max(0, execution.budget.maxReplans - execution.usage.replans),
    durationMs: Math.max(0, execution.budget.maxDurationMs - execution.usage.durationMs),
    monetaryCostUsd: Math.max(0, execution.budget.maxMonetaryCostUsd - execution.usage.monetaryCostUsd),
    shadowCostUsd: Math.max(0, execution.budget.maxShadowCostUsd - execution.usage.shadowCostUsd),
    consecutiveFailures: Math.max(0, execution.budget.maxConsecutiveFailures - execution.usage.consecutiveFailures),
    noProgressSteps: Math.max(0, execution.budget.maxNoProgressSteps - execution.usage.noProgressSteps)
  };
}

function summarizePlan(plan: Plan): string {
  return plan.steps.map((step, index) => `${index + 1}. [${step.status}] ${step.description}`).join("\n").slice(0, 1200);
}

function summarizeObservation(result: { success: boolean; output?: unknown; error?: { code: string; message: string } }): string {
  if (!result.success) return `${result.error?.code ?? "ERROR"}: ${result.error?.message ?? "Tool failed."}`.slice(0, 600);
  if (typeof result.output === "string") return result.output.slice(0, 600);
  return JSON.stringify(result.output ?? null).slice(0, 600);
}

function isPolicyBlockedOutput(output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  const candidate = output as { result?: { status?: unknown; policy?: { reason?: unknown } }; status?: unknown };
  return candidate.status === "blocked" || candidate.result?.status === "blocked" || candidate.result?.policy?.reason === "payment-prohibited";
}

function noProgressCount(execution: TaskExecution, observation: string | undefined): number {
  if (!observation) return 0;
  const previous = execution.steps.at(-2)?.observationSummary;
  const currentAction = JSON.stringify(execution.steps.at(-1)?.toolCall ?? {});
  const previousAction = JSON.stringify(execution.steps.at(-2)?.toolCall ?? {});
  return previous === observation && currentAction === previousAction ? execution.usage.noProgressSteps + 1 : 0;
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function workloadTask(task: IntelligenceTask, step: PlanStep): IntelligenceTask {
  return {
    ...task,
    input: `${task.input}\nCurrent step: ${step.description}`,
    type: step.allowedToolCapabilities?.some((capability) => capability.startsWith("browser")) ? "browser" : "tool-use",
    requirements: {
      ...task.requirements,
      tools: step.allowedToolCapabilities,
      structuredOutput: true
    }
  };
}

function finalResult(execution: TaskExecution): string | undefined {
  const lastSuccessful = [...execution.steps].reverse().find((step) => step.status === "COMPLETED");
  return lastSuccessful?.observationSummary;
}

function toOutcome(execution: TaskExecution): AutonomousTaskOutcome {
  const terminal = isTerminalTaskState(execution.state) ? execution.state : "FAILED";
  return {
    execution,
    status: terminal as AutonomousTaskOutcome["status"],
    success: terminal === "COMPLETED",
    result: execution.result,
    failureReason: execution.error
  };
}

function toTaskOutcome(outcome: AutonomousTaskOutcome): TaskOutcome {
  const execution = outcome.execution;
  const lastRoute = [...execution.steps].reverse().find((step) => step.route?.selected)?.route?.selected;
  return {
    task: execution.task,
    plan: {
      id: execution.plan.id,
      taskId: execution.task.id,
      createdAt: execution.plan.createdAt,
      steps: execution.plan.steps.map((step) => ({
        id: step.id,
        kind: step.action ? "tool" : "deterministic",
        description: step.description
      }))
    },
    attempts: [],
    success: outcome.success,
    result: outcome.result,
    error: outcome.failureReason,
    evaluation: {
      score: outcome.success ? 1 : 0,
      passed: outcome.success,
      confidence: 1,
      method: "task-executor-state",
      criteria: { terminalState: outcome.status }
    },
    provider: lastRoute?.provider ?? "none",
    model: lastRoute?.model ?? "none",
    tokens: 0,
    monetaryCostUsd: execution.usage.monetaryCostUsd,
    shadowCostUsd: execution.usage.shadowCostUsd,
    latencyMs: execution.usage.durationMs,
    tools: [...new Set(execution.steps.map((step) => step.toolCall?.tool).filter((tool): tool is string => Boolean(tool)))],
    completedAt: execution.completedAt ?? new Date().toISOString()
  };
}

function eventForState(state: TaskExecutionState): string {
  if (state === "RUNNING") return "task.started";
  if (state === "COMPLETED") return "task.completed";
  if (state === "FAILED") return "task.failed";
  if (state === "BLOCKED") return "task.blocked";
  if (state === "BUDGET_EXHAUSTED") return "task.budget_exhausted";
  if (state === "RECOVERING") return "recovery.started";
  if (state === "REPLANNING") return "plan.revised";
  return "task.state_changed";
}

function levelForState(state: TaskExecutionState): "debug" | "info" | "warn" | "error" {
  if (state === "FAILED") return "error";
  if (state === "BLOCKED" || state === "BUDGET_EXHAUSTED") return "warn";
  return "info";
}
