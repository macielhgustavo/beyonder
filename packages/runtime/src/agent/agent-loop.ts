import { nanoid } from "nanoid";
import type { ToolExecutor } from "@beyonder/tools";
import type { AuditLog } from "../audit/audit-log.js";
import type { AppConfig } from "../config/env.js";
import type { EconomicLedger } from "../economy/ledger.js";
import { classifyEconomicState } from "../economy/economic-state.js";
import type { IntelligenceLayer } from "../intelligence/intelligence-layer.js";
import type { AdaptiveExecutionController } from "../intelligence/adaptive-execution-controller.js";
import type { EvaluationLayer } from "../intelligence/evaluation-layer.js";
import type { Evaluation, ExecutionAttempt, IntelligenceTask, TaskOutcome } from "../intelligence/contracts.js";
import type { MemoryEngine } from "../memory/memory-engine.js";
import type { StateStore } from "../memory/state-store.js";
import type { ModelRouter } from "../models/model-router.js";
import type { AgentDecision, AgentStepStatus, ModelMessage, ToolCallResult } from "../types.js";

export class AgentLoop {
  constructor(
    private readonly config: AppConfig,
    private readonly ledger: EconomicLedger,
    private readonly state: StateStore,
    private readonly memory: MemoryEngine,
    private readonly intelligence: IntelligenceLayer,
    private readonly modelRouter: ModelRouter,
    private readonly adaptiveExecution: AdaptiveExecutionController,
    private readonly evaluator: EvaluationLayer,
    private readonly audit: AuditLog,
    private readonly toolExecutor: ToolExecutor
  ) {}

  async initialize() {
    await this.ledger.initialize(this.config.startingCapitalUsd);
    await this.state.set("agent.name", this.config.agentName);
    await this.audit.record("info", "agent.initialized", {
      agentName: this.config.agentName,
      startingCapitalUsd: this.config.startingCapitalUsd
    });
  }

  async step(objective = "Preserve capital and prepare for useful work."): Promise<{ status: AgentStepStatus; decision: AgentDecision; economicState: string; toolResult?: ToolCallResult }> {
    const summary = await this.ledger.summary(this.config.monthlyFixedCostUsd);
    const economicState = classifyEconomicState(summary);
    const stepNumber = (await this.state.get<number>("loop.step", 0)) + 1;
    const inspection = await this.intelligence.inspect(objective);
    const { task } = inspection;

    if (economicState === "halted") {
      const decision = {
        action: "halt",
        rationale: "Balance is depleted; runtime must stop before spending more.",
        expectedCostUsd: 0
      };
      await this.memory.recordOutcome({
        task,
        attempts: [],
        success: false,
        error: "economic-state-halted",
        evaluation: { score: 0, passed: false, confidence: 1, method: "economic-policy", notes: ["Execution stopped by the existing economic safety state."] },
        provider: "none",
        model: "none",
        tokens: 0,
        monetaryCostUsd: 0,
        shadowCostUsd: 0,
        latencyMs: 0,
        tools: [],
        completedAt: new Date().toISOString()
      });
      await this.audit.record("warn", "agent.halted", { summary, task });
      return { status: "halted", decision, economicState };
    }

    await this.memory.remember("working", `Current objective: ${objective}`, 3, {
      taskId: task.id,
      metadata: { taskType: task.type }
    });

    const adaptive = await this.adaptiveExecution.execute({
      task,
      economicState,
      messages: buildMessages(stepNumber, economicState, summary, task, inspection.context.summary)
    });
    const attempts = adaptive.attempts.length > 0 ? adaptive.attempts : [deterministicAttempt(task)];
    const monetaryCostUsd = attempts.reduce((sum, attempt) => sum + attempt.monetaryCostUsd, 0);
    const shadowCostUsd = attempts.reduce((sum, attempt) => sum + attempt.shadowCostUsd, 0);
    const decision: AgentDecision = adaptive.response
      ? {
          action: "model_guided_planning",
          rationale: `${adaptive.response.content.slice(0, 420)} Route: ${adaptive.route.reason}.`,
          expectedCostUsd: monetaryCostUsd
        }
      : {
          action: "observe_and_preserve_capital",
          rationale: `No acceptable routed model result; deterministic zero-spend behavior. ${adaptive.route.reason}.`,
          expectedCostUsd: 0
        };

    const toolCall = {
      id: `tool_${nanoid()}`,
      tool: "safe-objective",
      arguments: { objective }
    };
    const execution = await this.toolExecutor.execute<string>(toolCall, {
      taskId: task.id,
      economicState
    });
    const toolResult: ToolCallResult = execution.success
      ? { ok: true, output: execution.output ?? "" }
      : { ok: false, output: "", error: execution.error?.message ?? "Tool execution failed." };
    const toolLatencyMs = execution.durationMs;
    const toolEvaluation = toolResult.ok === false
      ? { score: 0, passed: false, confidence: 1, method: "tool-result", issues: [toolResult.error ?? "safe tool failed"] } satisfies Evaluation
      : this.evaluator.evaluate({ task, output: toolResult.output });
    const evaluation = combineEvaluations(adaptive.evaluation, toolEvaluation);
    const success = toolResult.ok && evaluation.passed;

    await this.state.set("loop.step", stepNumber);
    await this.state.set("economy.state", economicState);

    const lastAttempt = attempts.at(-1);
    const outcome: TaskOutcome = {
      task,
      attempts,
      success,
      result: toolResult.output || adaptive.response?.content || decision.rationale,
      error: toolResult.error,
      evaluation,
      provider: lastAttempt?.provider ?? "none",
      model: lastAttempt?.model ?? "none",
      tokens: attempts.reduce((sum, attempt) => sum + (attempt.tokens ?? 0), 0),
      monetaryCostUsd,
      shadowCostUsd,
      latencyMs: attempts.reduce((sum, attempt) => sum + (attempt.latencyMs ?? 0), 0) + toolLatencyMs,
      tools: [toolCall.tool],
      completedAt: new Date().toISOString()
    };
    await this.memory.recordOutcome(outcome);
    await this.modelRouter.recordOutcome(outcome);

    await this.audit.record("info", "agent.step.completed", {
      stepNumber,
      economicState,
      decision,
      objective,
      task: {
        id: task.id,
        type: task.type,
        complexity: task.complexity,
        risk: task.risk,
        estimatedTokens: task.estimatedTokens
      },
      routing: {
        candidates: adaptive.route.candidates.length,
        selected: adaptive.route.selected ? `${adaptive.route.selected.provider}/${adaptive.route.selected.model}` : null,
        explored: adaptive.route.explored,
        reason: adaptive.route.reason
      },
      relevantMemoryCount: inspection.relevantMemories.length,
      toolResult,
      evaluation,
      outcome: {
        success: outcome.success,
        provider: outcome.provider,
        model: outcome.model,
        monetaryCostUsd: outcome.monetaryCostUsd,
        shadowCostUsd: outcome.shadowCostUsd,
        latencyMs: outcome.latencyMs,
        attempts: outcome.attempts.length
      },
      summary
    });

    if (decision.expectedCostUsd > 0) {
      await this.ledger.record("expense", decision.expectedCostUsd, `Estimated model/tool cost: ${decision.action}`);
    }

    return { status: success ? "completed" : "failed", decision, economicState, toolResult };
  }

  async run(maxSteps = this.config.maxSteps, objective = "Preserve capital and prepare for useful work.") {
    await this.initialize();
    const results = [];
    for (let i = 0; i < maxSteps; i += 1) {
      const result = await this.step(objective);
      results.push(result);
      if (result.status === "halted") break;
    }
    return results;
  }
}

function buildMessages(stepNumber: number, economicState: string, summary: unknown, task: IntelligenceTask, memoryContext: string): ModelMessage[] {
  return [
    {
      role: "system",
      content: "You are an economic runtime controller. Prefer sufficient zero-cost/local actions and obey the current economic policy. Return one concise next action."
    },
    {
      role: "user",
      content: JSON.stringify({
        stepNumber,
        economicState,
        summary,
        task: {
          id: task.id,
          type: task.type,
          complexity: task.complexity,
          risk: task.risk,
          estimatedTokens: task.estimatedTokens,
          requirements: task.requirements,
          input: task.input
        },
        memoryContext
      })
    }
  ];
}

function deterministicAttempt(task: IntelligenceTask): ExecutionAttempt {
  const now = new Date().toISOString();
  return {
    id: `attempt_${nanoid()}`,
    taskId: task.id,
    attempt: 1,
    provider: "none",
    model: "none",
    startedAt: now,
    completedAt: now,
    latencyMs: 0,
    tokens: 0,
    monetaryCostUsd: 0,
    shadowCostUsd: 0,
    tools: [],
    success: true
  };
}

function combineEvaluations(model: Evaluation | undefined, tool: Evaluation): Evaluation {
  if (!model) return tool;
  const score = Number(((model.score + tool.score) / 2).toFixed(6));
  return {
    score,
    passed: model.passed && tool.passed,
    confidence: Math.min(model.confidence ?? 0.7, tool.confidence ?? 0.7),
    method: "model-and-tool",
    criteria: {
      modelScore: model.score,
      toolScore: tool.score
    },
    issues: [...(model.issues ?? []), ...(tool.issues ?? [])]
  };
}
