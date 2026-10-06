import { randomUUID } from "node:crypto";
import { parseBrowserAction } from "./action-parser.js";
import { BrowserElementNotFoundError, BrowserTimeoutError } from "./errors.js";
import { BrowserPolicyEngine, mergeBrowserPolicy } from "./policy.js";
import { redactTextSecrets, redactUrl } from "./redaction.js";
import { emitBrowserEvent, NoopBrowserTelemetrySink } from "./telemetry.js";
import type {
  BrowserAction,
  BrowserActionResult,
  BrowserAuthorizationVerifier,
  BrowserObservation,
  BrowserObservationLimits,
  BrowserPolicy,
  BrowserSession,
  BrowserSessionFactory,
  BrowserTelemetrySink
} from "./types.js";

interface ActiveSession {
  session: BrowserSession;
  policy: BrowserPolicy;
  policyEngine: BrowserPolicyEngine;
}

export interface BrowserAgentOptions {
  sessionFactory: BrowserSessionFactory;
  telemetry?: BrowserTelemetrySink;
  authorize?: BrowserAuthorizationVerifier;
  observationLimits?: Partial<BrowserObservationLimits>;
  defaultPolicy?: Partial<BrowserPolicy>;
  maxScreenshotBytes?: number;
  policyEngineFactory?: (policy: BrowserPolicy) => BrowserPolicyEngine;
}

const DEFAULT_OBSERVATION_LIMITS: BrowserObservationLimits = {
  maxTextChars: 12_000,
  maxInteractiveElements: 40,
  maxLinks: 160,
  maxForms: 10,
  maxErrors: 10
};

export class BrowserAgent {
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly telemetry: BrowserTelemetrySink;
  private readonly observationLimits: BrowserObservationLimits;
  private readonly maxScreenshotBytes: number;
  private readonly defaultPolicy: BrowserPolicy;

  constructor(private readonly options: BrowserAgentOptions) {
    this.telemetry = options.telemetry ?? new NoopBrowserTelemetrySink();
    this.observationLimits = { ...DEFAULT_OBSERVATION_LIMITS, ...options.observationLimits };
    this.maxScreenshotBytes = options.maxScreenshotBytes ?? 2_000_000;
    this.defaultPolicy = mergeBrowserPolicy(options.defaultPolicy);
  }

  async startSession(policyOverrides: Partial<BrowserPolicy> = {}): Promise<string> {
    const sessionId = randomUUID();
    const policy = mergeBrowserPolicy({ ...this.defaultPolicy, ...policyOverrides });
    const session = await this.options.sessionFactory.create(policy);
    const policyEngine = this.options.policyEngineFactory?.(policy) ?? new BrowserPolicyEngine(policy);
    this.sessions.set(sessionId, { session, policy, policyEngine });
    await emitBrowserEvent(this.telemetry, "browser.session.started", sessionId, { policy: summarizePolicy(policy) });
    return sessionId;
  }

  async execute(sessionId: string, rawAction: unknown): Promise<BrowserActionResult> {
    const active = this.sessions.get(sessionId);
    if (!active) {
      return {
        status: "error",
        action: inferActionType(rawAction),
        error: { code: "SESSION_NOT_FOUND", message: "Browser session was not found or is already closed." }
      };
    }

    let action: BrowserAction;
    try {
      action = parseBrowserAction(rawAction);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await emitBrowserEvent(this.telemetry, "browser.error", sessionId, { code: "INVALID_ACTION", message });
      return { status: "error", action: inferActionType(rawAction), error: { code: "INVALID_ACTION", message } };
    }

    const actionId = randomUUID();
    await emitBrowserEvent(this.telemetry, "browser.action.requested", sessionId, summarizeAction(action), actionId);

    try {
      const before = await safeCurrent(active.session);
      const result = await this.executeAction(sessionId, active, action, actionId);
      if (result.status !== "ok") return result;

      if (action.type !== "close") {
        const after = await safeCurrent(active.session);
        if (after.url !== before.url) {
          await emitBrowserEvent(
            this.telemetry,
            "browser.navigation",
            sessionId,
            { fromUrl: redactUrl(before.url), toUrl: redactUrl(after.url), title: after.title },
            actionId
          );
        }
      }

      await emitBrowserEvent(
        this.telemetry,
        "browser.action.completed",
        sessionId,
        { action: action.type, status: "ok", ...summarizeResultData(result.data) },
        actionId
      );
      return result;
    } catch (error) {
      const normalized = normalizeAgentError(error);
      await emitBrowserEvent(this.telemetry, "browser.error", sessionId, { action: action.type, ...normalized }, actionId);
      return { status: "error", action: action.type, error: normalized };
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const active = this.sessions.get(sessionId);
    if (!active) return;
    this.sessions.delete(sessionId);
    await active.session.close();
    await emitBrowserEvent(this.telemetry, "browser.session.closed", sessionId, {});
  }

  async closeAll(): Promise<void> {
    const sessionIds = [...this.sessions.keys()];
    await Promise.all(sessionIds.map((sessionId) => this.closeSession(sessionId)));
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  private async executeAction(
    sessionId: string,
    active: ActiveSession,
    action: BrowserAction,
    actionId: string
  ): Promise<BrowserActionResult> {
    switch (action.type) {
      case "open":
      case "navigate": {
        const decision = await active.policyEngine.evaluateNavigation(action.url);
        if (!decision.allowed) return this.blocked(sessionId, action, decision, actionId);
        await active.session.navigate(action.url);
        return this.withObservation(active.session, action.type, sessionId, actionId);
      }
      case "observe":
        return { status: "ok", action: action.type, observation: await this.observe(sessionId, active.session, actionId) };
      case "extractText": {
        const maxChars = clamp(action.maxChars ?? this.observationLimits.maxTextChars, 1, this.observationLimits.maxTextChars);
        const text = await active.session.extractText(action.target, maxChars);
        return { status: "ok", action: action.type, data: { text, truncatedAt: maxChars } };
      }
      case "find": {
        const element = await active.session.inspect(action.target);
        return { status: "ok", action: action.type, data: { element } };
      }
      case "click": {
        const element = await active.session.inspect(action.target);
        const decision = await active.policyEngine.evaluateClick(sessionId, action, element, this.options.authorize);
        if (!decision.allowed) return this.blocked(sessionId, action, decision, actionId);
        const method = (element.formMethod ?? "GET").toUpperCase();
        let submission: { url: string; method: string } | undefined;
        if (element.isSubmit && !["GET", "HEAD"].includes(method) && action.authorizationId) {
          const destination = new URL(element.formAction || (await active.session.current()).url);
          destination.hash = "";
          submission = { url: destination.href, method };
        }
        await active.session.click(action.target, submission);
        return this.withObservation(active.session, action.type, sessionId, actionId);
      }
      case "fill": {
        const element = await active.session.inspect(action.target);
        const decision = active.policyEngine.evaluateFill(element);
        if (!decision.allowed) return this.blocked(sessionId, action, decision, actionId);
        await active.session.fill(action.target, action.value);
        return this.withObservation(active.session, action.type, sessionId, actionId);
      }
      case "scroll":
        await active.session.scroll(action.direction, clamp(action.amount ?? 700, 1, 5_000));
        return this.withObservation(active.session, action.type, sessionId, actionId);
      case "back":
        await active.session.back();
        return this.withObservation(active.session, action.type, sessionId, actionId);
      case "screenshot": {
        const screenshot = await active.session.screenshot(action.fullPage ?? false);
        if (screenshot.byteLength > this.maxScreenshotBytes) {
          throw new Error(`Screenshot exceeds ${this.maxScreenshotBytes} byte observability limit.`);
        }
        return {
          status: "ok",
          action: action.type,
          data: { mimeType: "image/png", bytes: screenshot.byteLength, base64: screenshot.toString("base64") }
        };
      }
      case "current":
        return { status: "ok", action: action.type, data: await active.session.current() };
      case "waitFor":
        await active.session.waitFor(
          action.target,
          action.state ?? "visible",
          clamp(action.timeoutMs ?? 10_000, 1, 30_000)
        );
        return this.withObservation(active.session, action.type, sessionId, actionId);
      case "close":
        await this.closeSession(sessionId);
        return { status: "ok", action: action.type };
    }
  }

  private async withObservation(
    session: BrowserSession,
    action: BrowserAction["type"],
    sessionId?: string,
    actionId?: string
  ): Promise<BrowserActionResult> {
    const observation = await session.observe(this.observationLimits);
    if (sessionId && actionId) await this.emitObservation(sessionId, observation, actionId);
    return { status: "ok", action, observation };
  }

  private async observe(sessionId: string, session: BrowserSession, actionId: string): Promise<BrowserObservation> {
    const observation = await session.observe(this.observationLimits);
    await this.emitObservation(sessionId, observation, actionId);
    return observation;
  }

  private async emitObservation(sessionId: string, observation: BrowserObservation, actionId: string): Promise<void> {
    await emitBrowserEvent(
      this.telemetry,
      "browser.observation",
      sessionId,
      {
        url: redactUrl(observation.url),
        title: observation.title,
        visibleTextChars: observation.visibleText.length,
        interactiveElementCount: observation.interactiveElements.length,
        formCount: observation.forms.length,
        linkCount: observation.links.length,
        errorCount: observation.errors.length,
        truncated: observation.truncated
      },
      actionId
    );
  }

  private async blocked(
    sessionId: string,
    action: BrowserAction,
    decision: NonNullable<BrowserActionResult["policy"]>,
    actionId: string
  ): Promise<BrowserActionResult> {
    await emitBrowserEvent(
      this.telemetry,
      "browser.action.blocked",
      sessionId,
      { action: action.type, reason: decision.reason, detail: decision.detail },
      actionId
    );
    return { status: "blocked", action: action.type, policy: decision };
  }
}

function summarizeAction(action: BrowserAction): Record<string, unknown> {
  switch (action.type) {
    case "open":
    case "navigate":
      return { action: action.type, url: redactUrl(action.url) };
    case "fill":
      return { action: action.type, target: action.target, valueLength: action.value.length, value: "<redacted>" };
    case "click":
      return { action: action.type, target: action.target, authorizationId: action.authorizationId ? "<redacted>" : undefined };
    case "find":
    case "waitFor":
      return { action: action.type, target: action.target };
    case "extractText":
      return { action: action.type, target: action.target, maxChars: action.maxChars };
    case "scroll":
      return { action: action.type, direction: action.direction, amount: action.amount };
    case "screenshot":
      return { action: action.type, fullPage: action.fullPage ?? false };
    default:
      return { action: action.type };
  }
}

function summarizePolicy(policy: BrowserPolicy): Record<string, unknown> {
  return {
    javaScriptEnabled: policy.javaScriptEnabled ?? true,
    allowDomains: policy.allowDomains,
    denyDomains: policy.denyDomains,
    allowNavigation: policy.allowNavigation,
    allowFormFill: policy.allowFormFill,
    allowDownload: policy.allowDownload,
    allowUpload: policy.allowUpload,
    allowSubmit: policy.allowSubmit,
    allowInternalNetwork: policy.allowInternalNetwork
  };
}

function summarizeResultData(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") return {};
  const record = data as Record<string, unknown>;
  if (typeof record.base64 === "string") return { screenshotBytes: record.bytes };
  if (typeof record.text === "string") return { textChars: record.text.length };
  return {};
}

function normalizeAgentError(error: unknown): NonNullable<BrowserActionResult["error"]> {
  const message = redactTextSecrets(error instanceof Error ? error.message : String(error));
  if (error instanceof BrowserElementNotFoundError) return { code: "ELEMENT_NOT_FOUND", message };
  if (error instanceof BrowserTimeoutError || /timeout/i.test(message)) return { code: "TIMEOUT", message };
  return { code: "BROWSER_ERROR", message };
}

async function safeCurrent(session: BrowserSession): Promise<{ url: string; title: string }> {
  try {
    return await session.current();
  } catch {
    return { url: "about:blank", title: "" };
  }
}

function inferActionType(rawAction: unknown): BrowserAction["type"] {
  if (rawAction && typeof rawAction === "object" && "type" in rawAction && typeof (rawAction as { type?: unknown }).type === "string") {
    return (rawAction as { type: BrowserAction["type"] }).type;
  }
  return "observe";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
