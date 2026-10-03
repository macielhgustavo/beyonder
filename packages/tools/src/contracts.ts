export enum ToolRisk {
  NONE = "NONE",
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
  CRITICAL = "CRITICAL"
}

export enum ToolSideEffect {
  NONE = "NONE",
  READ = "READ",
  WRITE = "WRITE",
  EXTERNAL_ACTION = "EXTERNAL_ACTION",
  FINANCIAL = "FINANCIAL",
  SYSTEM = "SYSTEM"
}

export type ToolEconomicState = "growth" | "normal" | "defensive" | "survival" | "halted";

export type ToolErrorCode =
  | "TOOL_NOT_FOUND"
  | "INVALID_ARGUMENTS"
  | "POLICY_DENIED"
  | "TIMEOUT"
  | "EXECUTION_ERROR"
  | "UNAVAILABLE";

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  tool: string;
  arguments: unknown;
}

export interface ToolBudget {
  maxInvocations?: number;
  maxDurationMs?: number;
  maxMonetaryCostUsd?: number;
  maxShadowCostUsd?: number;
}

export interface ToolBudgetUsage {
  invocationCount?: number;
  durationMs?: number;
  monetaryCostUsd?: number;
  shadowCostUsd?: number;
}

export interface ToolContext {
  taskId?: string;
  economicState?: ToolEconomicState;
  environment?: Readonly<Record<string, string | number | boolean | undefined>>;
  budget?: ToolBudget;
  budgetUsage?: ToolBudgetUsage;
  metadata?: Readonly<Record<string, unknown>>;
}

export type ToolInputValidation<T> =
  | { success: true; data: T }
  | { success: false; error: unknown };

/**
 * Deliberately matches the shape exposed by Zod's safeParse without coupling
 * the generic tool package to a concrete validation dependency.
 */
export interface ToolInputSchema<TInput> {
  safeParse(input: unknown): ToolInputValidation<TInput>;
  jsonSchema?: unknown;
}

export interface ToolCostEstimate {
  monetaryCostUsd?: number;
  shadowCostUsd?: number;
}

export interface ToolHandlerResult<TOutput> {
  output: TOutput;
  metadata?: Record<string, unknown>;
}

export type ToolAvailability =
  | boolean
  | ((context: ToolContext) => boolean | Promise<boolean>);

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  id: string;
  name: string;
  description: string;
  inputSchema: ToolInputSchema<TInput>;
  risk: ToolRisk;
  sideEffects: ToolSideEffect | readonly ToolSideEffect[];
  capabilities?: readonly string[];
  availability?: ToolAvailability;
  timeoutMs?: number;
  cost?: ToolCostEstimate;
  metadata?: Readonly<Record<string, unknown>>;
  execute(
    input: TInput,
    context: ToolContext,
    signal: AbortSignal
  ): ToolHandlerResult<TOutput> | Promise<ToolHandlerResult<TOutput>>;
}

export interface ToolDescriptor {
  id: string;
  name: string;
  description: string;
  inputSchema?: unknown;
  risk: ToolRisk;
  sideEffects: readonly ToolSideEffect[];
  capabilities: readonly string[];
  timeoutMs?: number;
  cost?: ToolCostEstimate;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface ToolExecutionResult<TOutput = unknown> {
  success: boolean;
  output?: TOutput;
  error?: ToolError;
  durationMs: number;
  sideEffects: readonly ToolSideEffect[];
  metadata?: Record<string, unknown>;
}

export interface ToolPolicyDecision {
  allowed: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface ToolPolicy {
  evaluate(definition: ToolDefinition, context: ToolContext): ToolPolicyDecision | Promise<ToolPolicyDecision>;
}

export type ToolAuditEventName =
  | "tool.requested"
  | "tool.validated"
  | "tool.authorized"
  | "tool.denied"
  | "tool.started"
  | "tool.completed"
  | "tool.failed";

export interface ToolAuditSink {
  record(event: ToolAuditEventName, details: Record<string, unknown>): void | Promise<void>;
}
