import type { AuditLog } from "../audit/audit-log.js";
import type { AppConfig } from "../config/env.js";
import type { EconomicLedger } from "../economy/ledger.js";
import { classifyEconomicState } from "../economy/economic-state.js";
import type { MemoryEngine } from "../memory/memory-engine.js";
import type { StateStore } from "../memory/state-store.js";
import type { ModelRouter } from "../models/model-router.js";
import type { AgentDecision, AgentStepStatus } from "../types.js";
import type { Tool } from "../tools/tool-registry.js";

export class AgentLoop {
  constructor(
    private readonly config: AppConfig,
    private readonly ledger: EconomicLedger,
    private readonly state: StateStore,
    private readonly memory: MemoryEngine,
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

  async step(objective = "Preserve capital and prepare for useful work."): Promise<{ status: AgentStepStatus; decision: AgentDecision; economicState: string; toolResult?: unknown }> {
    const summary = await this.ledger.summary(this.config.monthlyFixedCostUsd);
    const economicState = classifyEconomicState(summary);
    const stepNumber = (await this.state.get<number>("loop.step", 0)) + 1;
    const memoryContext = await this.memory.contextSummary(objective);

    if (economicState === "halted") {
      const decision = {
        action: "halt",
        rationale: "Balance is depleted; runtime must stop before spending more.",
        expectedCostUsd: 0
      };
      await this.audit.record("warn", "agent.halted", { summary });
      return { status: "halted", decision, economicState };
    }

    await this.memory.remember("working", `Current objective: ${objective}`, 3);
    await this.memory.remember("economic", `Economic state ${economicState}; balance ${summary.balanceUsd}; expenses ${summary.expensesUsd}.`, 2);
    const decision = await this.decide(stepNumber, economicState, summary, objective, memoryContext);
    const toolResult = await this.tools.get("safe-objective")?.run(objective);
    await this.state.set("loop.step", stepNumber);
    await this.state.set("economy.state", economicState);
    await this.memory.remember("decision", JSON.stringify(decision), 2);
    if (toolResult?.ok) {
      await this.memory.remember("episodic", `Executed safe-objective for "${objective}": ${toolResult.output}`, 3);
      await this.memory.remember("procedural", "When tools are restricted, use safe-objective to record intent without filesystem, browser, or shell side effects.", 2);
    }
    await this.audit.record("info", "agent.step.completed", {
      stepNumber,
      economicState,
      decision,
      objective,
      toolResult,
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
    objective: string,
    memoryContext: string
  ): Promise<AgentDecision> {
    const response = await this.modelRouter.complete([
      {
        role: "system",
        content:
          "You are an economic runtime controller. Prefer zero-cost/local actions. Return one concise next action."
      },
      {
        role: "user",
        content: JSON.stringify({ stepNumber, economicState, summary, objective, memoryContext })
      }
    ]);

    if (response.provider === "none") {
      return {
        action: "observe_and_preserve_capital",
        rationale: "No model provider is configured; use deterministic policy and avoid spend.",
        expectedCostUsd: 0
      };
    }

    return {
      action: "model_guided_planning",
      rationale: response.content.slice(0, 500),
      expectedCostUsd: response.estimatedCostUsd
    };
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
