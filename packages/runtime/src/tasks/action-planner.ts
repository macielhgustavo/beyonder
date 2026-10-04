import type { ToolCall, ToolRegistry } from "@beyonder/tools";
import type { ModelRouter } from "../models/model-router.js";
import { InferenceError, parseStructuredObject, runCandidates } from "../models/inference.js";
import type { StepActionPlanner } from "./contracts.js";
import { getEconomicRoutingPolicy, inferenceAttemptPolicy } from "../models/router-config.js";

export function createActionPlanner(router: ModelRouter, registry: ToolRegistry): StepActionPlanner {
  return { async decide(context) {
    const result = await runCandidates({
      taskId: context.task?.id ?? "unknown", stepId: context.currentStep.id, phase: "ACTION_PLANNING",
      candidates: context.candidates ?? (context.selectedModel ? [context.selectedModel] : []),
      maxCandidates: getEconomicRoutingPolicy(context.economicState ?? "normal").maxAttempts,
      ...inferenceAttemptPolicy(context.economicState ?? "normal"),
      maxMonetaryCostUsd: context.remainingBudget.monetaryCostUsd, maxShadowCostUsd: context.remainingBudget.shadowCostUsd, maxDurationMs: context.remainingBudget.durationMs,
      complete: router.completeForPlanningCandidate.bind(router), record: router.recordAttempt?.bind(router),
      canAttempt: router.canAttempt?.bind(router),
      messages: [{ role: "system", content: 'Choose one operational tool call. Return exactly one JSON object {"id":"call-id","tool":"tool-id","arguments":{}}. Follow the provided input schema exactly. Never fabricate tool output. Do not include unexpected fields.' }, { role: "user", content: JSON.stringify({ objective: context.objective, step: context.currentStep, observation: context.latestObservation, tools: context.availableTools.map((tool) => ({ id: tool.id, inputSchema: tool.inputSchema })) }) }],
      validate(response): ToolCall {
        const call = parseStructuredObject(response.content);
        const tool = typeof call.tool === "string" ? registry.get(call.tool) : undefined;
        if (Object.keys(call).some((key) => !["id", "tool", "arguments"].includes(key)) || typeof call.id !== "string" || !call.id || !tool || !context.availableTools.some((entry) => entry.id === call.tool) || !tool.inputSchema.safeParse(call.arguments).success) throw new InferenceError("O modelo não produziu uma ação válida para a ferramenta disponível.", "INVALID_ACTION");
        return { id: call.id, tool: tool.id, arguments: call.arguments };
      }
    });
    return { call: result.value, monetaryCostUsd: result.monetaryCostUsd, shadowCostUsd: result.shadowCostUsd };
  }};
}
