import {
  ToolRisk,
  ToolSideEffect,
  type ToolContext,
  type ToolDefinition,
  type ToolPolicy,
  type ToolPolicyDecision
} from "./contracts.js";

export interface DefaultToolPolicyOptions {
  allowedRisks?: readonly ToolRisk[];
  allowedSideEffects?: readonly ToolSideEffect[];
}

const DEFAULT_ALLOWED_RISKS = new Set<ToolRisk>([ToolRisk.NONE, ToolRisk.LOW]);
const DEFAULT_ALLOWED_SIDE_EFFECTS = new Set<ToolSideEffect>([ToolSideEffect.NONE, ToolSideEffect.READ]);
const SURVIVAL_ALLOWED_RISKS = DEFAULT_ALLOWED_RISKS;
const SURVIVAL_ALLOWED_SIDE_EFFECTS = DEFAULT_ALLOWED_SIDE_EFFECTS;

export class DefaultToolPolicy implements ToolPolicy {
  private readonly allowedRisks: ReadonlySet<ToolRisk>;
  private readonly allowedSideEffects: ReadonlySet<ToolSideEffect>;

  constructor(options: DefaultToolPolicyOptions = {}) {
    this.allowedRisks = new Set(options.allowedRisks ?? DEFAULT_ALLOWED_RISKS);
    this.allowedSideEffects = new Set(options.allowedSideEffects ?? DEFAULT_ALLOWED_SIDE_EFFECTS);
  }

  evaluate(definition: ToolDefinition, context: ToolContext): ToolPolicyDecision {
    if (context.economicState === "halted" && definition.metadata?.allowWhenHalted !== true) {
      return deny("Economic state is halted; normal tool execution is disabled.", { economicState: "halted" });
    }

    const sideEffects = normalizeSideEffects(definition.sideEffects);

    if (context.economicState === "survival") {
      if (!SURVIVAL_ALLOWED_RISKS.has(definition.risk) || sideEffects.some((effect) => !SURVIVAL_ALLOWED_SIDE_EFFECTS.has(effect))) {
        return deny("Survival state only permits safe, non-mutating tools.", { economicState: "survival" });
      }
    }

    if (!this.allowedRisks.has(definition.risk)) {
      return deny(`Tool risk ${definition.risk} is not authorized by the default policy.`, { risk: definition.risk });
    }

    const deniedEffect = sideEffects.find((effect) => !this.allowedSideEffects.has(effect));
    if (deniedEffect) {
      return deny(`Tool side effect ${deniedEffect} is not authorized by the default policy.`, { sideEffect: deniedEffect });
    }

    const budgetDecision = evaluateBudget(definition, context);
    if (!budgetDecision.allowed) return budgetDecision;

    return { allowed: true };
  }
}

export function normalizeSideEffects(sideEffects: ToolDefinition["sideEffects"]): readonly ToolSideEffect[] {
  return Array.isArray(sideEffects) ? [...sideEffects] : [sideEffects as ToolSideEffect];
}

function evaluateBudget(definition: ToolDefinition, context: ToolContext): ToolPolicyDecision {
  const budget = context.budget;
  if (!budget) return { allowed: true };

  const usage = context.budgetUsage ?? {};
  if (budget.maxInvocations !== undefined && (usage.invocationCount ?? 0) >= budget.maxInvocations) {
    return deny("Tool invocation budget is exhausted.", { budget: "invocations" });
  }
  if (budget.maxDurationMs !== undefined && (usage.durationMs ?? 0) >= budget.maxDurationMs) {
    return deny("Tool time budget is exhausted.", { budget: "duration" });
  }

  const nextMonetary = (usage.monetaryCostUsd ?? 0) + (definition.cost?.monetaryCostUsd ?? 0);
  if (budget.maxMonetaryCostUsd !== undefined && nextMonetary > budget.maxMonetaryCostUsd) {
    return deny("Tool monetary budget would be exceeded.", { budget: "monetary" });
  }

  const nextShadow = (usage.shadowCostUsd ?? 0) + (definition.cost?.shadowCostUsd ?? 0);
  if (budget.maxShadowCostUsd !== undefined && nextShadow > budget.maxShadowCostUsd) {
    return deny("Tool shadow-cost budget would be exceeded.", { budget: "shadow" });
  }

  return { allowed: true };
}

function deny(reason: string, details?: Record<string, unknown>): ToolPolicyDecision {
  return { allowed: false, reason, ...(details ? { details } : {}) };
}
