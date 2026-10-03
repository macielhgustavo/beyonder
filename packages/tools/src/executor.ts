import {
  type ToolAuditSink,
  type ToolCall,
  type ToolContext,
  type ToolDefinition,
  type ToolError,
  type ToolExecutionResult,
  type ToolInputValidation,
  type ToolPolicy
} from "./contracts.js";
import { DefaultToolPolicy, normalizeSideEffects } from "./policy.js";
import { redactSecrets, sanitizeErrorMessage } from "./redaction.js";
import { ToolRegistry } from "./registry.js";

export interface ToolExecutorOptions {
  policy?: ToolPolicy;
  audit?: ToolAuditSink;
  defaultTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class ToolExecutor {
  readonly policy: ToolPolicy;
  private readonly audit: ToolAuditSink;
  private readonly defaultTimeoutMs: number;

  constructor(readonly registry: ToolRegistry, options: ToolExecutorOptions = {}) {
    this.policy = options.policy ?? new DefaultToolPolicy();
    this.audit = options.audit ?? new NoopToolAuditSink();
    this.defaultTimeoutMs = positiveTimeout(options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  async execute<TOutput = unknown>(call: ToolCall, context: ToolContext = {}): Promise<ToolExecutionResult<TOutput>> {
    const requestedAt = Date.now();
    const definition = this.registry.get(call.tool);
    const baseAudit = auditBase(call, context, definition);

    await this.audit.record("tool.requested", {
      ...baseAudit,
      status: "requested",
      arguments: redactSecrets(call.arguments)
    });

    if (!definition) {
      return this.fail(call, context, requestedAt, [], {
        code: "TOOL_NOT_FOUND",
        message: `Tool '${call.tool}' is not registered.`
      });
    }

    if (!(await this.registry.isAvailable(definition.id, context))) {
      return this.fail(call, context, requestedAt, normalizeSideEffects(definition.sideEffects), {
        code: "UNAVAILABLE",
        message: `Tool '${definition.id}' is currently unavailable.`
      }, definition);
    }

    const validation = safeValidate(definition, call.arguments);
    if (!validation.success) {
      return this.fail(call, context, requestedAt, normalizeSideEffects(definition.sideEffects), {
        code: "INVALID_ARGUMENTS",
        message: `Arguments for tool '${definition.id}' are invalid.`,
        details: validationDetails(validation.error)
      }, definition);
    }

    await this.audit.record("tool.validated", { ...baseAudit, status: "validated" });

    const policyDecision = await this.policy.evaluate(definition, context);
    if (!policyDecision.allowed) {
      const result = failureResult<TOutput>(requestedAt, normalizeSideEffects(definition.sideEffects), {
        code: "POLICY_DENIED",
        message: policyDecision.reason ?? `Tool '${definition.id}' was denied by policy.`,
        ...(policyDecision.details ? { details: policyDecision.details } : {})
      });
      await this.audit.record("tool.denied", {
        ...baseAudit,
        status: "denied",
        durationMs: result.durationMs,
        error: result.error
      });
      return result;
    }

    await this.audit.record("tool.authorized", { ...baseAudit, status: "authorized" });
    await this.audit.record("tool.started", { ...baseAudit, status: "started" });

    const controller = new AbortController();
    const timeoutMs = resolveTimeout(definition, context, this.defaultTimeoutMs);
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const handlerPromise = Promise.resolve(definition.execute(validation.data, context, controller.signal));
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ToolTimeoutError(timeoutMs));
        }, timeoutMs);
      });
      const payload = await Promise.race([handlerPromise, timeoutPromise]);
      const durationMs = Date.now() - requestedAt;
      const result: ToolExecutionResult<TOutput> = {
        success: true,
        output: payload.output as TOutput,
        durationMs,
        sideEffects: normalizeSideEffects(definition.sideEffects),
        ...(payload.metadata ? { metadata: redactSecrets(payload.metadata) as Record<string, unknown> } : {})
      };
      await this.audit.record("tool.completed", {
        ...baseAudit,
        status: "completed",
        durationMs,
        metadata: result.metadata
      });
      return result;
    } catch (error) {
      const toolError: ToolError = error instanceof ToolTimeoutError
        ? { code: "TIMEOUT", message: error.message, details: { timeoutMs } }
        : { code: "EXECUTION_ERROR", message: sanitizeErrorMessage(error) };
      return this.fail(call, context, requestedAt, normalizeSideEffects(definition.sideEffects), toolError, definition);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async fail<TOutput>(
    call: ToolCall,
    context: ToolContext,
    startedAt: number,
    sideEffects: ReturnType<typeof normalizeSideEffects>,
    error: ToolError,
    definition?: ToolDefinition
  ): Promise<ToolExecutionResult<TOutput>> {
    const result = failureResult<TOutput>(startedAt, sideEffects, error);
    await this.audit.record("tool.failed", {
      ...auditBase(call, context, definition),
      status: "failed",
      durationMs: result.durationMs,
      error: redactSecrets(error)
    });
    return result;
  }
}

class NoopToolAuditSink implements ToolAuditSink {
  record(): void {}
}

class ToolTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Tool execution exceeded the ${timeoutMs}ms timeout.`);
    this.name = "ToolTimeoutError";
  }
}

function safeValidate(definition: ToolDefinition, input: unknown): ToolInputValidation<unknown> {
  try {
    return definition.inputSchema.safeParse(input);
  } catch (error) {
    return { success: false, error };
  }
}

function validationDetails(error: unknown): Record<string, unknown> {
  if (error && typeof error === "object" && Array.isArray((error as { issues?: unknown }).issues)) {
    const issues = (error as { issues: unknown[] }).issues.slice(0, 20).map((issue) => {
      if (!issue || typeof issue !== "object") return { message: "Invalid argument." };
      const candidate = issue as { path?: unknown; code?: unknown; message?: unknown };
      return {
        ...(Array.isArray(candidate.path) ? { path: candidate.path } : {}),
        ...(typeof candidate.code === "string" ? { code: candidate.code } : {}),
        message: typeof candidate.message === "string" ? candidate.message : "Invalid argument."
      };
    });
    return { issues };
  }
  return { issues: [{ message: "Arguments did not match the tool schema." }] };
}

function resolveTimeout(definition: ToolDefinition, context: ToolContext, fallbackMs: number): number {
  const configured = positiveTimeout(definition.timeoutMs ?? fallbackMs);
  const budget = context.budget?.maxDurationMs;
  if (budget === undefined) return configured;
  const remaining = budget - (context.budgetUsage?.durationMs ?? 0);
  return positiveTimeout(Math.min(configured, Math.max(1, remaining)));
}

function positiveTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(1, Math.floor(value));
}

function failureResult<TOutput>(
  startedAt: number,
  sideEffects: readonly import("./contracts.js").ToolSideEffect[],
  error: ToolError
): ToolExecutionResult<TOutput> {
  return {
    success: false,
    error,
    durationMs: Date.now() - startedAt,
    sideEffects
  };
}

function auditBase(call: ToolCall, context: ToolContext, definition?: ToolDefinition): Record<string, unknown> {
  return {
    callId: call.id,
    tool: call.tool,
    task: context.taskId ?? null,
    economicState: context.economicState ?? null,
    risk: definition?.risk ?? null,
    sideEffects: definition ? normalizeSideEffects(definition.sideEffects) : []
  };
}
