export type BrowserEventName =
  | "browser.session.started"
  | "browser.navigation"
  | "browser.observation"
  | "browser.action.requested"
  | "browser.action.completed"
  | "browser.action.blocked"
  | "browser.error"
  | "browser.session.closed";

export type BrowserTarget =
  | { role: string; name?: string; exact?: boolean }
  | { label: string; exact?: boolean }
  | { text: string; exact?: boolean }
  | { placeholder: string; exact?: boolean }
  | { testId: string };

export type BrowserAction =
  | { type: "open"; url: string }
  | { type: "navigate"; url: string }
  | { type: "observe" }
  | { type: "extractText"; target?: BrowserTarget; maxChars?: number }
  | { type: "find"; target: BrowserTarget }
  | { type: "click"; target: BrowserTarget; authorizationId?: string }
  | { type: "fill"; target: BrowserTarget; value: string }
  | { type: "scroll"; direction: "up" | "down"; amount?: number }
  | { type: "back" }
  | { type: "screenshot"; fullPage?: boolean }
  | { type: "current" }
  | { type: "waitFor"; target: BrowserTarget; state?: "attached" | "visible" | "hidden"; timeoutMs?: number }
  | { type: "close" };

export interface BrowserPolicy {
  allowDomains: string[];
  denyDomains: string[];
  allowNavigation: boolean;
  allowFormFill: boolean;
  allowDownload: boolean;
  allowUpload: boolean;
  allowSubmit: boolean;
  allowInternalNetwork: boolean;
}

export interface BrowserObservationLimits {
  maxTextChars: number;
  maxInteractiveElements: number;
  maxLinks: number;
  maxForms: number;
  maxErrors: number;
}

export interface BrowserInteractiveElement {
  index: number;
  tag: string;
  role?: string;
  name?: string;
  inputType?: string;
  href?: string;
  disabled?: boolean;
}

export interface BrowserFormObservation {
  index: number;
  method: string;
  action?: string;
  fields: Array<{
    tag: string;
    type?: string;
    name?: string;
    label?: string;
    required?: boolean;
  }>;
}

export interface BrowserLinkObservation {
  text: string;
  href: string;
}

export interface BrowserObservation {
  url: string;
  title: string;
  visibleText: string;
  interactiveElements: BrowserInteractiveElement[];
  forms: BrowserFormObservation[];
  links: BrowserLinkObservation[];
  errors: string[];
  truncated: {
    text: boolean;
    interactiveElements: boolean;
    forms: boolean;
    links: boolean;
    errors: boolean;
  };
}

export interface BrowserElementInfo {
  tag: string;
  role?: string;
  name?: string;
  inputType?: string;
  href?: string;
  formMethod?: string;
  formAction?: string;
  disabled?: boolean;
  isSubmit?: boolean;
}

export type BrowserPolicyReason =
  | "allowed"
  | "navigation-disabled"
  | "form-fill-disabled"
  | "submit-disabled"
  | "authorization-required"
  | "unsupported-scheme"
  | "credentials-in-url"
  | "domain-denied"
  | "domain-not-allowed"
  | "internal-network-blocked"
  | "dns-resolution-failed"
  | "executable-download-blocked"
  | "payment-prohibited"
  | "purchase-prohibited"
  | "account-creation-prohibited"
  | "verification-bypass-prohibited"
  | "upload-disabled";

export interface BrowserPolicyDecision {
  allowed: boolean;
  reason: BrowserPolicyReason;
  detail?: string;
}

export interface BrowserActionResult {
  status: "ok" | "blocked" | "error";
  action: BrowserAction["type"];
  observation?: BrowserObservation;
  data?: unknown;
  policy?: BrowserPolicyDecision;
  error?: {
    code: "INVALID_ACTION" | "SESSION_NOT_FOUND" | "ELEMENT_NOT_FOUND" | "TIMEOUT" | "BROWSER_ERROR";
    message: string;
  };
}

export interface BrowserTelemetryEvent {
  name: BrowserEventName;
  timestamp: string;
  sessionId: string;
  actionId?: string;
  details: Record<string, unknown>;
}

export interface BrowserTelemetrySink {
  emit(event: BrowserTelemetryEvent): void | Promise<void>;
}

export interface BrowserSession {
  current(): Promise<{ url: string; title: string }>;
  navigate(url: string): Promise<void>;
  back(): Promise<void>;
  observe(limits: BrowserObservationLimits): Promise<BrowserObservation>;
  extractText(target: BrowserTarget | undefined, maxChars: number): Promise<string>;
  inspect(target: BrowserTarget): Promise<BrowserElementInfo>;
  click(target: BrowserTarget): Promise<void>;
  fill(target: BrowserTarget, value: string): Promise<void>;
  scroll(direction: "up" | "down", amount: number): Promise<void>;
  waitFor(target: BrowserTarget, state: "attached" | "visible" | "hidden", timeoutMs: number): Promise<void>;
  screenshot(fullPage: boolean): Promise<Buffer>;
  close(): Promise<void>;
}

export interface BrowserSessionFactory {
  create(policy: BrowserPolicy): Promise<BrowserSession>;
}

export interface BrowserAuthorizationContext {
  sessionId: string;
  authorizationId: string;
  action: Extract<BrowserAction, { type: "click" }>;
  element: BrowserElementInfo;
}

export type BrowserAuthorizationVerifier = (context: BrowserAuthorizationContext) => boolean | Promise<boolean>;
