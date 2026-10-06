import { nanoid } from "nanoid";
import type { ToolCall, ToolDescriptor } from "@beyonder/tools";
import type { IntelligenceTask } from "../intelligence/contracts.js";
import type { EconomicState } from "../types.js";
import type { RetrievedMemory } from "../memory/memory-engine.js";
import type { Plan, PlanStep, TaskBudget } from "./contracts.js";

export interface PlanRequest {
  objective: string;
  task: IntelligenceTask;
  memoryContext: RetrievedMemory[];
  availableTools: readonly ToolDescriptor[];
  budget: TaskBudget;
  economicState: EconomicState;
}

export interface ReplanRequest extends PlanRequest {
  previousPlan: Plan;
  completedSteps: PlanStep[];
  failedStep?: PlanStep;
  observations: string[];
  reason: string;
}

export interface Planner {
  createPlan(request: PlanRequest): Promise<Plan> | Plan;
  revisePlan?(request: ReplanRequest): Promise<Plan> | Plan;
}

export type PlanValidationCode =
  | "INVALID_PLAN"
  | "EMPTY_PLAN"
  | "EXCESSIVE_PLAN_SIZE"
  | "DUPLICATE_STEP_ID"
  | "UNSUPPORTED_CAPABILITY"
  | "PROHIBITED_CAPABILITY"
  | "INVALID_DEPENDENCY"
  | "INVALID_ACTION_TOOL";

export interface PlanValidationIssue {
  code: PlanValidationCode;
  message: string;
  stepId?: string;
}

export type PlanValidationResult =
  | { valid: true; plan: Plan }
  | { valid: false; issues: PlanValidationIssue[] };

const PROHIBITED_CAPABILITIES = new Set([
  "shell",
  "shell.execute",
  "filesystem.write",
  "payment",
  "purchase",
  "account.create",
  "captcha.bypass",
  "2fa.bypass",
  "kyc.bypass"
]);

export class DeterministicPlanner implements Planner {
  createPlan(request: PlanRequest): Plan {
    const safeObjectiveTool = request.availableTools.find((tool) => tool.id === "safe-objective");
    const calculator = request.availableTools.find((tool) => tool.id === "calculator");
    const objective = request.objective.trim();
    const planId = `plan_${nanoid()}`;
    const createdAt = new Date().toISOString();

    if (calculator && /\b(add|sum|multiply|calculate|divide|subtract)\b/i.test(objective)) {
      return {
        id: planId,
        taskId: request.task.id,
        objective,
        createdAt,
        revision: 1,
        assumptions: ["Deterministic planner selected a safe calculation capability."],
        steps: [{
          id: "calculate",
          description: "Use deterministic calculation if arguments are supplied by the caller or later tool-selection layer.",
          status: "PENDING",
          expectedOutcome: "Calculation performed with zero monetary cost.",
          allowedToolCapabilities: ["calculation", "deterministic"]
        }]
      };
    }

    return {
      id: planId,
      taskId: request.task.id,
      objective,
      createdAt,
      revision: 1,
      assumptions: ["No specialized planner path matched; use safe deterministic objective recording."],
      steps: [{
        id: "record-objective",
        description: "Normalize and record the objective through the safe deterministic tool runtime.",
        status: "PENDING",
        expectedOutcome: "Objective accepted with zero side effects.",
        allowedToolCapabilities: ["objective-normalization", "deterministic"],
        ...(safeObjectiveTool ? { action: safeObjectiveCall(objective) } : {})
      }]
    };
  }

  revisePlan(request: ReplanRequest): Plan {
    const preserved = request.completedSteps.map((step) => ({ ...step, status: "COMPLETED" as const }));
    const fallback = this.createPlan(request);
    const replacementSteps = fallback.steps
      .filter((step) => !preserved.some((completed) => completed.id === step.id))
      .map((step) => ({ ...step, id: `replan-${step.id}` }));
    return {
      ...fallback,
      id: `plan_${nanoid()}`,
      revision: request.previousPlan.revision + 1,
      assumptions: [
        ...(request.previousPlan.assumptions ?? []),
        `Replanned because: ${request.reason}`
      ],
      steps: [...preserved, ...replacementSteps]
    };
  }
}

export function validatePlan(plan: unknown, request: Pick<PlanRequest, "availableTools" | "budget">): PlanValidationResult {
  if (!isPlanShape(plan)) return invalid("INVALID_PLAN", "Plan must match the structured Plan schema.");
  if (plan.steps.length === 0) return invalid("EMPTY_PLAN", "Plan must include at least one step.");
  if (plan.steps.length > request.budget.maxSteps) return invalid("EXCESSIVE_PLAN_SIZE", "Plan exceeds the configured maxSteps budget.");

  const issues: PlanValidationIssue[] = [];
  const seen = new Set<string>();
  const capabilities = new Set(request.availableTools.flatMap((tool) => tool.capabilities));
  const toolIds = new Set(request.availableTools.map((tool) => tool.id));

  for (const step of plan.steps) {
    if (seen.has(step.id)) issues.push({ code: "DUPLICATE_STEP_ID", message: `Duplicate step id '${step.id}'.`, stepId: step.id });
    seen.add(step.id);

    for (const capability of step.allowedToolCapabilities ?? []) {
      if (PROHIBITED_CAPABILITIES.has(capability)) {
        issues.push({ code: "PROHIBITED_CAPABILITY", message: `Capability '${capability}' is prohibited.`, stepId: step.id });
      } else if (!capabilities.has(capability)) {
        issues.push({ code: "UNSUPPORTED_CAPABILITY", message: `Capability '${capability}' is not available.`, stepId: step.id });
      }
    }

    if (step.action && !toolIds.has(step.action.tool)) {
      issues.push({ code: "INVALID_ACTION_TOOL", message: `Tool '${step.action.tool}' is not available.`, stepId: step.id });
    }

    for (const dependency of step.dependencies ?? []) {
      if (!plan.steps.some((candidate) => candidate.id === dependency)) {
        issues.push({ code: "INVALID_DEPENDENCY", message: `Dependency '${dependency}' is missing.`, stepId: step.id });
      }
    }
  }

  return issues.length ? { valid: false, issues } : { valid: true, plan };
}

export function safeObjectiveCall(objective: string): ToolCall {
  return {
    id: `tool_${nanoid()}`,
    tool: "safe-objective",
    arguments: { objective }
  };
}

function invalid(code: PlanValidationCode, message: string): PlanValidationResult {
  return { valid: false, issues: [{ code, message }] };
}

function isPlanShape(value: unknown): value is Plan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  return typeof plan.id === "string" &&
    typeof plan.taskId === "string" &&
    typeof plan.objective === "string" &&
    typeof plan.createdAt === "string" &&
    typeof plan.revision === "number" &&
    Array.isArray(plan.steps) &&
    plan.steps.every(isPlanStepShape);
}

function isPlanStepShape(value: unknown): value is PlanStep {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const step = value as Record<string, unknown>;
  return Object.keys(step).every((key) => ["id", "description", "status", "kind", "expectedOutcome", "allowedToolCapabilities", "dependencies", "action", "actionStrategy", "alternativeUrls", "sourceDomain", "sourceTopic", "evidenceRole"].includes(key)) &&
    (step.kind === undefined || step.kind === "TOOL" || step.kind === "DIRECT_RESPONSE") &&
    (step.actionStrategy === undefined || step.actionStrategy === "DISCOVERED_BROWSER_LINK") &&
    (step.evidenceRole === undefined || step.evidenceRole === "DISCOVERY" || step.evidenceRole === "SOURCE") &&
    (step.alternativeUrls === undefined || stringArray(step.alternativeUrls) && step.alternativeUrls.length <= 4) &&
    (step.sourceDomain === undefined || typeof step.sourceDomain === "string" && step.sourceDomain.length <= 253) &&
    (step.sourceTopic === undefined || typeof step.sourceTopic === "string" && step.sourceTopic.length <= 120) &&
    (step.action === undefined || validActionShape(step.action)) &&
    !(step.kind === "DIRECT_RESPONSE" && step.action) &&
    typeof step.id === "string" &&
    typeof step.description === "string" &&
    isStepStatus(step.status) &&
    (step.allowedToolCapabilities === undefined || stringArray(step.allowedToolCapabilities)) &&
    (step.dependencies === undefined || stringArray(step.dependencies));
}

function validActionShape(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const call = value as Record<string, unknown>;
  return Object.keys(call).every((key) => ["id", "tool", "arguments"].includes(key)) && typeof call.id === "string" && typeof call.tool === "string" && !!call.arguments && typeof call.arguments === "object" && !Array.isArray(call.arguments);
}

function isStepStatus(value: unknown): value is PlanStep["status"] {
  return value === "PENDING" || value === "RUNNING" || value === "COMPLETED" || value === "FAILED" || value === "BLOCKED" || value === "SKIPPED";
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
