import {
  DefaultToolPolicy,
  SAFE_BUILTIN_TOOLS,
  ToolExecutor,
  ToolRegistry,
  ToolRisk,
  ToolSideEffect,
  createToolInputSchema,
  type ToolAuditEventName,
  type ToolAuditSink,
  type ToolDefinition,
  type ToolInputValidation
} from "@beyonder/tools";
import type { AuditLevel, AuditLog } from "../audit/audit-log.js";
import type { AppConfig } from "../config/env.js";

interface SafeObjectiveInput {
  objective: string;
}

export const safeObjectiveTool: ToolDefinition<SafeObjectiveInput, string> = {
  id: "safe-objective",
  name: "Safe Objective",
  description: "Normalize and record an objective as a deterministic, side-effect-free runtime step.",
  inputSchema: createToolInputSchema(validateSafeObjectiveInput, {
    type: "object",
    additionalProperties: false,
    required: ["objective"],
    properties: { objective: { type: "string" } }
  }),
  risk: ToolRisk.NONE,
  sideEffects: ToolSideEffect.NONE,
  capabilities: ["objective-normalization", "deterministic"],
  execute(input) {
    const normalized = input.objective.trim().replace(/\s+/g, " ");
    return {
      output: JSON.stringify({
        acceptedObjective: normalized,
        action: "recorded_objective_and_created_next_step",
        sideEffects: "none"
      })
    };
  }
};

export function createRuntimeToolRegistry(_config: AppConfig["tools"]): ToolRegistry {
  return new ToolRegistry()
    .registerMany(SAFE_BUILTIN_TOOLS)
    .register(safeObjectiveTool);
}

export function createRuntimeToolExecutor(registry: ToolRegistry, audit: AuditLog): ToolExecutor {
  return new ToolExecutor(registry, {
    policy: new DefaultToolPolicy(),
    audit: new RuntimeToolAuditSink(audit)
  });
}

export class RuntimeToolAuditSink implements ToolAuditSink {
  constructor(private readonly audit: AuditLog) {}

  record(event: ToolAuditEventName, details: Record<string, unknown>) {
    return this.audit.record(auditLevel(event), event, details);
  }
}

function validateSafeObjectiveInput(input: unknown): ToolInputValidation<SafeObjectiveInput> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { success: false, error: { issues: [{ message: "Expected an object." }] } };
  }
  const candidate = input as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => key !== "objective") || typeof candidate.objective !== "string") {
    return { success: false, error: { issues: [{ path: ["objective"], message: "objective must be a string." }] } };
  }
  return { success: true, data: { objective: candidate.objective } };
}

function auditLevel(event: ToolAuditEventName): AuditLevel {
  if (event === "tool.failed") return "error";
  if (event === "tool.denied") return "warn";
  return "info";
}
