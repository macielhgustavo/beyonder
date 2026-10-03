import { nanoid } from "nanoid";
import type { AuditLog } from "../audit/audit-log.js";
import type { AppConfig } from "../config/env.js";
import type { EconomicLedger } from "../economy/ledger.js";
import { classifyEconomicState } from "../economy/economic-state.js";
import type { IntelligenceLayer } from "../intelligence/intelligence-layer.js";
import type { ExecutionAttempt, IntelligenceTask, TaskOutcome } from "../intelligence/contracts.js";
import type { MemoryEngine } from "../memory/memory-engine.js";
import type { StateStore } from "../memory/state-store.js";
import type { ModelRouter } from "../models/model-router.js";
import type { AgentDecision, AgentStepStatus, ToolCallResult } from "../types.js";
import type { Tool } from "../tools/tool-registry.js";

export class AgentLoop {
  constructor(
    private readonly config: AppConfig,
    private readonly ledger: EconomicLedger,
    private readonly state: StateStore,
    private readonly memory: MemoryEngine,
    private readonly intelligence: IntelligenceLayer,
    private readonly modelRouter: ModelRouter,
    private readonly audit: AuditLog,
    private readonly tools: Map<string, Tool>
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
        evaluation: { score: 0, passed: false, notes: ["Execution stopped by the existing economic safety state."] },
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

    const { decision, attempt } = await this.decide(stepNumber, economicState, summary, task, inspection.context.summary);
    const tool = this.tools.get("safe-objective");
    const toolStartedAt = Date.now();
    const toolResult = await tool?.run(objective);
    const toolLatencyMs = Date.now() - toolStartedAt;
    const success = toolResult?.ok ?? true;

    await this.state.set("loop.step", stepNumber);
    await this.state.set("economy.state", economicState);

    const outcome: TaskOutcome = {
      task,
      attempts: [attempt],
      success,
      result: toolResult?.output ?? decision.rationale,
      error: toolResult?.error,
      evaluation: {
        score: success ? 1 : 0,
        passed: success,
        criteria: {
          safeExecution: success,
          monetaryCostUsd: decision.expectedCostUsd
        }
      },
      provider: attempt.provider ?? "none",
      model: attempt.model ?? "none",
      tokens: attempt.tokens ?? 0,
      monetaryCostUsd: attempt.monetaryCostUsd,
      shadowCostUsd: 0,
      latencyMs: (attempt.latencyMs ?? 0) + toolLatencyMs,
      tools: tool ? [tool.name] : [],
      completedAt: new Date().toISOString()
    };
    await this.memory.recordOutcome(outcome);

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
      relevantMemoryCount: inspection.relevantMemories.length,
      toolResult,
      outcome: {
        success: outcome.success,
        provider: outcome.provider,
        model: outcome.model,
        monetaryCostUsd: outcome.monetaryCostUsd,
        shadowCostUsd: outcome.shadowCostUsd,
        latencyMs: outcome.latencyMs
      },
      summary
    });

    if (decision.expectedCostUsd > 0) {
      await this.ledger.record("expense", decision.expectedCostUsd, `Estimated model/tool cost: ${decision.action}`);
    }

    return { status: "completed", decision, economicState, toolResult };
  }

  private async decide(
    stepNumber: number,
    economicState: string,
    summary: unknown,
    task: IntelligenceTask,
    memoryContext: string
  ): Promise<{ decision: AgentDecision; attempt: ExecutionAttempt }> {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    try {
      const response = await this.modelRouter.complete([
        {
          role: "system",
          content: "You are an economic runtime controller. Prefer zero-cost/local actions. Return one concise next action."
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
      ]);
      const completedAt = new Date().toISOString();
      const attempt: ExecutionAttempt = {
        id: `attempt_${nanoid()}`,
        taskId: task.id,
        attempt: 1,
        provider: response.provider,
        model: response.model,
        startedAt,
        completedAt,
        latencyMs: Date.now() - startedMs,
        tokens: response.provider === "none" ? 0 : task.estimatedTokens,
        monetaryCostUsd: response.estimatedCostUsd,
        shadowCostUsd: 0,
        tools: [],
        success: true
      };

      if (response.provider === "none") {
        return {
          decision: {
            action: "observe_and_preserve_capital",
            rationale: "No model provider is configured; use deterministic policy and avoid spend.",
            expectedCostUsd: 0
          },
          attempt
        };
      }

      return {
        decision: {
          action: "model_guided_planning",
          rationale: response.content.slice(0, 500),
          expectedCostUsd: response.estimatedCostUsd
        },
        attempt
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        decision: {
          action: "observe_and_preserve_capital",
          rationale: "Model routing failed; fall back to deterministic zero-spend behavior.",
          expectedCostUsd: 0
        },
        attempt: {
          id: `attempt_${nanoid()}`,
          taskId: task.id,
          attempt: 1,
          provider: "none",
          model: "none",
          startedAt,
          completedAt: new Date().toISOString(),
          latencyMs: Date.now() - startedMs,
          tokens: 0,
          monetaryCostUsd: 0,
          shadowCostUsd: 0,
          tools: [],
          success: false,
          error: message
        }
      };
    }
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
