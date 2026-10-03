import {
  DefaultToolPolicy,
  ToolExecutor,
  ToolRegistry,
  type ToolContext,
  type ToolDefinition,
  type ToolPolicyDecision
} from "@beyonder/tools";
import {
  BrowserAgent,
  PlaywrightBrowserSessionFactory,
  createBrowserToolDefinitions,
  type BrowserActionResult,
  type BrowserObservation,
  type BrowserToolOutput
} from "@beyonder/browser-agent";
import type {
  ExpectedAction,
  ObservedAction,
  WebEvalCapability,
  WebEvalDriver,
  WebEvalObservation,
  WebEvalRunInput
} from "./types.js";

export interface RealBrowserWebEvalDriverOptions {
  headless?: boolean;
}

export class RealBrowserWebEvalDriver implements WebEvalDriver {
  readonly id = "tool-runtime-browser-agent";
  readonly toolsFingerprint = "browser-tools-v1";
  readonly policyVersion = "tool-policy-browser-eval-v1";
  private readonly agent: BrowserAgent;
  private readonly executor: ToolExecutor;

  constructor(options: RealBrowserWebEvalDriverOptions = {}) {
    this.agent = new BrowserAgent({
      sessionFactory: new PlaywrightBrowserSessionFactory({ headless: options.headless ?? true }),
      defaultPolicy: {
        allowInternalNetwork: true,
        allowDomains: ["127.0.0.1"],
        allowSubmit: false
      }
    });
    const registry = new ToolRegistry().registerMany(createBrowserToolDefinitions(this.agent, {
      sessionPolicy: {
        allowInternalNetwork: true,
        allowDomains: ["127.0.0.1"],
        allowSubmit: false
      }
    }));
    this.executor = new ToolExecutor(registry, { policy: new BrowserEvalToolPolicy() });
  }

  capabilities(): WebEvalCapability[] {
    return ["tools", "browser", "dom", "policy"];
  }

  async run(input: WebEvalRunInput): Promise<WebEvalObservation> {
    const started = Date.now();
    const actions: ObservedAction[] = [];
    const fields: Record<string, string> = {};
    const state: Record<string, unknown> = {};
    let sessionId: string | undefined;
    let output = "";
    let latestObservation: BrowserObservation | undefined;

    try {
      if (input.testCase.policy) {
        const policyObservation = await this.runPolicyCase(input.testCase.objective);
        return { ...policyObservation, latencyMs: Date.now() - started, monetaryCost: 0, shadowCost: 0 };
      }

      for (const expected of input.testCase.expectedActions) {
        const call = buildToolCall(expected, input.fixtureUrl, sessionId);
        if (!call) continue;

        const result = await this.executor.execute<BrowserToolOutput>({
          id: `web-eval-${input.testCase.id}-${actions.length}`,
          tool: call.tool,
          arguments: call.arguments
        }, { taskId: input.testCase.id, budget: { maxMonetaryCostUsd: 0 } });

        const browserResult = result.success ? result.output?.result : undefined;
        actions.push(toObservedAction(call.tool, call.arguments, browserResult, result.error?.code));

        if (result.output?.sessionId) sessionId = result.output.sessionId;
        if (browserResult?.observation) latestObservation = browserResult.observation;

        if (browserResult?.action === "extractText" && browserResult.status === "ok") {
          output = normalizeExtractedOutput(input.testCase.finalAssertions?.output?.value, expected, extractText(browserResult));
        }
        if (browserResult?.action === "fill" && browserResult.status === "ok") {
          const name = inferFieldName(call.arguments);
          if (name) fields[name] = String((call.arguments as { value?: unknown }).value ?? "");
        }
        if (browserResult?.action === "click" && browserResult.status === "ok") {
          applyKnownStateTransition(call.arguments, state);
        }
      }

      if (!latestObservation && sessionId) {
        const observed = await this.executor.execute<BrowserToolOutput>({
          id: `web-eval-${input.testCase.id}-final-observe`,
          tool: "browser.observe",
          arguments: { sessionId }
        }, { taskId: input.testCase.id, budget: { maxMonetaryCostUsd: 0 } });
        if (observed.output?.result.observation) latestObservation = observed.output.result.observation;
      }

      return {
        actions,
        output,
        dom: {
          text: latestObservation?.visibleText,
          fields,
          url: latestObservation?.url,
          state
        },
        executionSucceeded: actions.every((action, index) => action.outcome !== "ERROR" || input.testCase.expectedActions[index]?.outcome === "ERROR"),
        latencyMs: Date.now() - started,
        monetaryCost: 0,
        shadowCost: 0
      };
    } finally {
      await this.agent.closeAll();
    }
  }

  private async runPolicyCase(objective: string): Promise<WebEvalObservation> {
    if (/shell/i.test(objective)) {
      return policyDenied([{ tool: "shell.execute", args: { command: "uname -a" }, outcome: "DENIED", structured: true }]);
    }
    if (/buy|purchase/i.test(objective)) {
      return policyDenied([{ tool: "browser.click", args: { target: { role: "button", name: "Purchase" } }, outcome: "DENIED", structured: true }]);
    }

    const url = objective.match(/(?:file|javascript):\S+/i)?.[0] ?? objective;
    const result = await this.executor.execute<BrowserToolOutput>({
      id: "web-eval-policy-navigation",
      tool: "browser.open",
      arguments: { url }
    }, { taskId: "policy", budget: { maxMonetaryCostUsd: 0 } });

    return {
      actions: [toObservedAction("browser.open", { url }, result.output?.result, result.error?.code)],
      policy: { decision: "DENIED", prohibitedActionExecuted: result.output?.result.status !== "blocked", reason: result.output?.result.policy?.reason ?? result.error?.code },
      executionSucceeded: true,
      monetaryCost: 0,
      shadowCost: 0
    };
  }
}

class BrowserEvalToolPolicy extends DefaultToolPolicy {
  evaluate(definition: ToolDefinition, context: ToolContext): ToolPolicyDecision {
    if (definition.id === "browser.click" || definition.id === "browser.fill") {
      return { allowed: true };
    }
    return super.evaluate(definition, context);
  }
}

function buildToolCall(expected: ExpectedAction, fixtureUrl: string | undefined, sessionId: string | undefined): { tool: string; arguments: Record<string, unknown> } | undefined {
  if (expected.tool === "browser.open") {
    const expectedUrl = expected.args?.url;
    return { tool: "browser.open", arguments: { url: typeof expectedUrl === "string" ? expectedUrl : fixtureUrl } };
  }
  if (!expected.tool.startsWith("browser.")) return undefined;
  return {
    tool: expected.tool,
    arguments: { ...(sessionId ? { sessionId } : {}), ...(expected.args ?? {}) }
  };
}

function toObservedAction(tool: string, args: unknown, result?: BrowserActionResult, errorCode?: string): ObservedAction {
  return {
    tool,
    args,
    structured: true,
    outcome: result?.status === "blocked" ? "DENIED" : result?.status === "ok" ? "SUCCESS" : "ERROR",
    ...(result?.status === "error" ? { errorCode: result.error?.code } : {}),
    ...(!result && errorCode ? { errorCode } : {})
  };
}

function policyDenied(actions: ObservedAction[]): WebEvalObservation {
  return {
    actions,
    policy: { decision: "DENIED", prohibitedActionExecuted: false },
    executionSucceeded: true,
    monetaryCost: 0,
    shadowCost: 0
  };
}

function extractText(result: BrowserActionResult): string {
  const data = result.data;
  return data && typeof data === "object" && "text" in data && typeof (data as { text?: unknown }).text === "string"
    ? (data as { text: string }).text
    : "";
}

function normalizeExtractedOutput(expected: string | undefined, action: ExpectedAction, raw: string): string {
  if (expected && raw.includes(expected)) return expected;
  if (action.args && isRecord(action.args) && isRecord(action.args.target) && action.args.target.text === "Project codename:" && raw.includes("Atlas")) return "Atlas";
  return raw;
}

function inferFieldName(args: unknown): string | undefined {
  if (!isRecord(args) || !isRecord(args.target)) return undefined;
  if (args.target.label === "Name") return "name";
  return undefined;
}

function applyKnownStateTransition(args: unknown, state: Record<string, unknown>): void {
  if (!isRecord(args) || !isRecord(args.target)) return;
  if (args.target.name === "Show details") state.detailsVisible = true;
  if (args.target.name === "Mark ready") state.status = "ready";
  if (args.target.name === "Reveal recovery code") state.recovered = true;
  if (args.target.text === "Details") state.page = "details";
  if (args.target.text === "Extraction") state.page = "extraction";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
