import {
  ToolRisk,
  ToolSideEffect,
  createToolInputSchema,
  validationFailure,
  type ToolDefinition,
  type ToolInputValidation
} from "@beyonder/tools";
import type { BrowserAgent } from "./browser-agent.js";
import { parseBrowserAction } from "./action-parser.js";
import type { BrowserAction, BrowserActionResult, BrowserPolicy, BrowserTarget } from "./types.js";

export interface BrowserToolInput {
  sessionId?: string;
}

export interface BrowserToolOutput {
  sessionId: string;
  result: BrowserActionResult;
}

export interface BrowserToolDefinitionOptions {
  sessionPolicy?: Partial<BrowserPolicy>;
  timeoutMs?: number;
}

type BrowserToolInputFor<TAction extends BrowserAction> = BrowserToolInput & Omit<TAction, "type">;

const DEFAULT_BROWSER_TOOL_TIMEOUT_MS = 15_000;

export function createBrowserToolDefinitions(
  agent: BrowserAgent,
  options: BrowserToolDefinitionOptions = {}
): readonly ToolDefinition[] {
  const timeoutMs = options.timeoutMs ?? DEFAULT_BROWSER_TOOL_TIMEOUT_MS;

  return [
    browserTool("browser.open", "Browser Open", "Open an HTTP/HTTPS URL in a controlled browser session.", "open", ToolRisk.LOW, ToolSideEffect.READ, timeoutMs, agent, options),
    browserTool("browser.navigate", "Browser Navigate", "Navigate the controlled browser session to an HTTP/HTTPS URL.", "navigate", ToolRisk.LOW, ToolSideEffect.READ, timeoutMs, agent, options),
    browserTool("browser.observe", "Browser Observe", "Return a compact structured observation for the current page.", "observe", ToolRisk.LOW, ToolSideEffect.READ, timeoutMs, agent, options),
    browserTool("browser.extractText", "Browser Extract Text", "Extract bounded visible text from the current page or target.", "extractText", ToolRisk.LOW, ToolSideEffect.READ, timeoutMs, agent, options),
    browserTool("browser.find", "Browser Find", "Inspect one semantic element on the current page.", "find", ToolRisk.LOW, ToolSideEffect.READ, timeoutMs, agent, options),
    browserTool("browser.click", "Browser Click", "Click a semantic target after browser policy inspection.", "click", ToolRisk.MEDIUM, ToolSideEffect.EXTERNAL_ACTION, timeoutMs, agent, options),
    browserTool("browser.fill", "Browser Fill", "Fill a semantic form field without submitting the form.", "fill", ToolRisk.MEDIUM, ToolSideEffect.WRITE, timeoutMs, agent, options),
    browserTool("browser.scroll", "Browser Scroll", "Scroll the current page.", "scroll", ToolRisk.LOW, ToolSideEffect.READ, timeoutMs, agent, options),
    browserTool("browser.back", "Browser Back", "Navigate back in the controlled browser session.", "back", ToolRisk.LOW, ToolSideEffect.READ, timeoutMs, agent, options),
    browserTool("browser.current", "Browser Current", "Return current browser URL and title.", "current", ToolRisk.LOW, ToolSideEffect.READ, timeoutMs, agent, options),
    browserTool("browser.waitFor", "Browser Wait For", "Wait for a semantic element state.", "waitFor", ToolRisk.LOW, ToolSideEffect.READ, timeoutMs, agent, options),
    browserTool("browser.screenshot", "Browser Screenshot", "Capture a bounded observability screenshot.", "screenshot", ToolRisk.LOW, ToolSideEffect.READ, timeoutMs, agent, options),
    browserTool("browser.close", "Browser Close", "Close a controlled browser session.", "close", ToolRisk.LOW, ToolSideEffect.READ, timeoutMs, agent, options)
  ];
}

function browserTool<TAction extends BrowserAction>(
  id: string,
  name: string,
  description: string,
  actionType: TAction["type"],
  risk: ToolRisk,
  sideEffects: ToolSideEffect,
  timeoutMs: number,
  agent: BrowserAgent,
  options: BrowserToolDefinitionOptions
): ToolDefinition<BrowserToolInputFor<TAction>, BrowserToolOutput> {
  return {
    id,
    name,
    description,
    inputSchema: createToolInputSchema((input) => validateBrowserToolInput<TAction>(actionType, input), browserToolJsonSchema(actionType)),
    risk,
    sideEffects,
    capabilities: ["browser", `browser:${actionType}`],
    timeoutMs,
    cost: { monetaryCostUsd: 0 },
    metadata: { actionType },
    async execute(input) {
      const sessionId = input.sessionId ?? await agent.startSession(options.sessionPolicy);
      const action = parseBrowserAction({ ...input, type: actionType });
      const result = await agent.execute(sessionId, action);
      return { output: { sessionId, result } };
    }
  };
}

function validateBrowserToolInput<TAction extends BrowserAction>(
  actionType: TAction["type"],
  input: unknown
): ToolInputValidation<BrowserToolInputFor<TAction>> {
  if (!isRecord(input)) return validationFailure("Expected an object.");
  const schema = browserToolJsonSchema(actionType) as { properties: Record<string, unknown> };
  if (Object.keys(input).some((key) => !(key in schema.properties))) return validationFailure("Unexpected browser argument.");
  if (typeof input.sessionId !== "undefined" && !isNonEmptyString(input.sessionId)) {
    return validationFailure("sessionId must be a non-empty string.", ["sessionId"]);
  }

  const actionCandidate = { ...input, type: actionType };
  try {
    parseBrowserAction(actionCandidate);
  } catch (error) {
    return validationFailure(error instanceof Error ? error.message : "Invalid browser action.");
  }

  if (actionType === "close" && !isNonEmptyString(input.sessionId)) {
    return validationFailure("browser.close requires sessionId.", ["sessionId"]);
  }

  return { success: true, data: stripUndefined(input) as BrowserToolInputFor<TAction> };
}

function browserToolJsonSchema(actionType: BrowserAction["type"]): unknown {
  const target = {
    type: "object", additionalProperties: false,
    properties: { role: { type: "string" }, name: { type: "string" }, label: { type: "string" }, text: { type: "string" }, placeholder: { type: "string" }, testId: { type: "string" }, exact: { type: "boolean" } },
    oneOf: ["role", "label", "text", "placeholder", "testId"].map((key) => ({ required: [key] }))
  };
  const properties: Record<string, unknown> = { sessionId: { type: "string", description: "Reuse the sessionId returned by the preceding browser observation." }, type: { const: actionType } };
  const required: string[] = [];
  if (actionType === "open" || actionType === "navigate") { properties.url = { type: "string", format: "uri" }; required.push("url"); }
  if (["find", "click", "fill", "waitFor", "extractText"].includes(actionType)) properties.target = target;
  if (["find", "click", "fill", "waitFor"].includes(actionType)) required.push("target");
  if (actionType === "extractText") properties.maxChars = { type: "integer", minimum: 1 };
  if (actionType === "fill") { properties.value = { type: "string" }; required.push("value"); }
  if (actionType === "click") properties.authorizationId = { type: "string" };
  if (actionType === "scroll") { properties.direction = { enum: ["up", "down"] }; properties.amount = { type: "integer", minimum: 1 }; required.push("direction"); }
  if (actionType === "screenshot") properties.fullPage = { type: "boolean" };
  if (actionType === "waitFor") { properties.state = { enum: ["attached", "visible", "hidden"] }; properties.timeoutMs = { type: "integer", minimum: 1 }; }
  if (actionType === "close") required.push("sessionId");
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required
  };
}

function stripUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export type { BrowserTarget };
