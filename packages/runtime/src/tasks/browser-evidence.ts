import type { ToolDescriptor } from "@beyonder/tools";
import type { StepExecution } from "./contracts.js";

export function isReadOnlyBrowserTool(tool: ToolDescriptor): boolean {
  return tool.capabilities.includes("browser") && tool.sideEffects.every((effect) => effect === "READ" || effect === "NONE");
}

export function hasBrowserEvidence(steps: StepExecution[]): boolean {
  return steps.some((step) => {
    if (step.status !== "COMPLETED" || !step.toolResult?.success || !step.toolCapabilities?.includes("browser")) return false;
    if (!step.toolResult.sideEffects.every((effect) => effect === "READ" || effect === "NONE")) return false;
    const output = step.toolResult.output as { result?: { status?: string; observation?: { url?: string; visibleText?: string }; data?: { text?: string } } } | undefined;
    const result = output?.result;
    return result?.status === "ok" && Boolean(result.observation?.visibleText?.trim() || result.data?.text?.trim());
  });
}
