import { createRequire } from "node:module";
import { BrowserElementNotFoundError, BrowserTimeoutError } from "./errors.js";
import { BrowserPolicyEngine, type AddressResolver } from "./policy.js";
import { PinnedHttpTransport, type BrowserNetworkTransport } from "./pinned-transport.js";
import type {
  BrowserElementInfo,
  BrowserFormObservation,
  BrowserInteractiveElement,
  BrowserLinkObservation,
  BrowserObservation,
  BrowserObservationLimits,
  BrowserPolicy,
  BrowserSession,
  BrowserSessionFactory,
  BrowserTarget
} from "./types.js";

interface PlaywrightModuleLike {
  chromium: {
    launch(options?: Record<string, unknown>): Promise<BrowserLike>;
  };
}

interface BrowserLike {
  newContext(options?: Record<string, unknown>): Promise<BrowserContextLike>;
  close(): Promise<void>;
}

interface BrowserContextLike {
  newPage(): Promise<PageLike>;
  route(pattern: string, handler: (route: RouteLike, request: RequestLike) => Promise<void> | void): Promise<void>;
  routeWebSocket(pattern: string, handler: (socket: { close(options?: { code?: number; reason?: string }): Promise<void> }) => void): Promise<void>;
  close(): Promise<void>;
}

interface RouteLike {
  continue(): Promise<void>;
  fulfill(options: { status: number; headers: Record<string, string>; body: Buffer }): Promise<void>;
  abort(errorCode?: string): Promise<void>;
}

interface RequestLike {
  url(): string;
  method(): string;
  headers(): Record<string, string>;
  postDataBuffer(): Buffer | null;
  isNavigationRequest?(): boolean;
  frame?(): { parentFrame(): unknown };
}

interface DownloadLike {
  suggestedFilename(): string;
  cancel(): Promise<void>;
}

interface LocatorLike {
  count(): Promise<number>;
  click(options?: Record<string, unknown>): Promise<void>;
  fill(value: string, options?: Record<string, unknown>): Promise<void>;
  innerText(options?: Record<string, unknown>): Promise<string>;
  waitFor(options?: Record<string, unknown>): Promise<void>;
  evaluate<R>(fn: (element: Element) => R): Promise<R>;
  evaluateAll<R, Arg>(fn: (elements: Element[], arg: Arg) => R, arg: Arg): Promise<R>;
}

interface PageLike {
  url(): string;
  mainFrame?(): { parentFrame(): unknown };
  title(): Promise<string>;
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  goBack(options?: Record<string, unknown>): Promise<unknown>;
  getByRole(role: string, options?: Record<string, unknown>): LocatorLike;
  getByLabel(text: string, options?: Record<string, unknown>): LocatorLike;
  getByText(text: string, options?: Record<string, unknown>): LocatorLike;
  getByPlaceholder(text: string, options?: Record<string, unknown>): LocatorLike;
  getByTestId(testId: string): LocatorLike;
  locator(selector: string): LocatorLike;
  evaluate<R>(fn: (limits: BrowserObservationLimits) => R, arg: BrowserObservationLimits): Promise<R>;
  screenshot(options?: Record<string, unknown>): Promise<Buffer>;
  mouse: { wheel(deltaX: number, deltaY: number): Promise<void> };
  on(event: "console", listener: (message: { type(): string; text(): string }) => void): void;
  on(event: "pageerror", listener: (error: Error) => void): void;
  on(event: "download", listener: (download: DownloadLike) => void | Promise<void>): void;
  on(event: "response", listener: (response: { status(): number; request(): RequestLike }) => void): void;
}

const collectObservation = new Function(
  "requestedLimits",
  `
  const normalize = (value) => (value ?? "").replace(/\\s+/g, " ").trim();
  let bodyText = normalize(document.body?.innerText ?? "");
  // innerText loses deletion/strikethrough semantics. Preserve that observed
  // markup without changing the page: superseded documentation is not a
  // current factual assertion.
  for (const element of document.querySelectorAll("s,del")) {
    if (!element.getClientRects().length) continue;
    const superseded = normalize(element.innerText || element.textContent);
    if (superseded) bodyText = bodyText.replace(superseded, "[SUPERSEDED]" + superseded + "[/SUPERSEDED]");
  }
  const interactiveNodes = Array.from(
    document.querySelectorAll(
      'a[href],button,input:not([type="hidden"]),textarea,select,[role="button"],[role="link"],[role="textbox"],[role="checkbox"],[role="radio"]'
    )
  );
  const visibleInteractive = interactiveNodes.filter((element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  });
  const interactiveElements = visibleInteractive.slice(0, requestedLimits.maxInteractiveElements).map((element, index) => {
    const input = element instanceof HTMLInputElement ? element : undefined;
    const anchor = element instanceof HTMLAnchorElement ? element : undefined;
    const named = element.getAttribute("aria-label") || element.getAttribute("name") || input?.placeholder || element.textContent;
    return {
      index,
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role") || undefined,
      name: normalize(named),
      inputType: input?.type,
      href: anchor?.href,
      disabled: "disabled" in element ? Boolean(element.disabled) : undefined
    };
  });

  const formNodes = Array.from(document.forms);
  const forms = formNodes.slice(0, requestedLimits.maxForms).map((form, index) => {
    const fields = Array.from(form.querySelectorAll("input,textarea,select"))
      .filter((field) => field.type !== "hidden")
      .slice(0, 20)
      .map((field) => {
        const labels = field.labels ? Array.from(field.labels).map((label) => normalize(label.textContent)).filter(Boolean) : [];
        return {
          tag: field.tagName.toLowerCase(),
          type: field instanceof HTMLInputElement ? field.type : undefined,
          name: field.name || undefined,
          label: labels[0] || field.getAttribute("aria-label") || field.getAttribute("placeholder") || undefined,
          required: field.required
        };
      });
    return {
      index,
      method: (form.method || "get").toLowerCase(),
      action: form.action || undefined,
      fields
    };
  });

  const linkNodes = Array.from(document.querySelectorAll("a[href]"));
  const links = linkNodes.slice(0, requestedLimits.maxLinks).map((link) => ({
    text: normalize(link.innerText || link.textContent),
    href: link.href
  }));

  return {
    visibleText: bodyText.slice(0, requestedLimits.maxTextChars),
    interactiveElements,
    forms,
    links,
    truncated: {
      text: bodyText.length > requestedLimits.maxTextChars,
      interactiveElements: visibleInteractive.length > requestedLimits.maxInteractiveElements,
      forms: formNodes.length > requestedLimits.maxForms,
      links: linkNodes.length > requestedLimits.maxLinks
    }
  };
`
) as (requestedLimits: BrowserObservationLimits) => {
  visibleText: string;
  interactiveElements: BrowserInteractiveElement[];
  forms: BrowserFormObservation[];
  links: BrowserLinkObservation[];
  truncated: Omit<BrowserObservation["truncated"], "errors">;
};

const inspectElement = new Function(
  "element",
  `
  const html = element;
  const input = element instanceof HTMLInputElement ? element : undefined;
  const button = element instanceof HTMLButtonElement ? element : undefined;
  const anchor = element instanceof HTMLAnchorElement ? element : undefined;
  const form = input?.form ?? button?.form ?? html.closest("form");
  const name =
    html.getAttribute("aria-label") ||
    html.getAttribute("name") ||
    input?.placeholder ||
    html.textContent ||
    undefined;
  const inputType = input?.type ?? button?.type;
  const tag = html.tagName.toLowerCase();
  const isSubmit =
    (tag === "button" && (button?.type ?? "submit") === "submit") ||
    (tag === "input" && (inputType === "submit" || inputType === "image"));
  return {
    tag,
    role: html.getAttribute("role") || undefined,
    name: name?.replace(/\\s+/g, " ").trim(),
    inputType,
    href: anchor?.href,
    formMethod: form?.method?.toLowerCase(),
    formAction: form?.action,
    disabled: "disabled" in html ? Boolean(html.disabled) : undefined,
    isSubmit
  };
`
) as (element: Element) => BrowserElementInfo;

export interface PlaywrightBrowserSessionFactoryOptions {
  headless?: boolean;
  navigationTimeoutMs?: number;
  actionTimeoutMs?: number;
  executablePath?: string;
  addressResolver?: AddressResolver;
  networkTransport?: BrowserNetworkTransport;
}

export class PlaywrightBrowserSessionFactory implements BrowserSessionFactory {
  constructor(private readonly options: PlaywrightBrowserSessionFactoryOptions = {}) {}

  async create(policy: BrowserPolicy): Promise<BrowserSession> {
    const playwright = loadPlaywright();
    const browser = await playwright.chromium.launch({
      headless: this.options.headless ?? true,
      ...(this.options.executablePath ? { executablePath: this.options.executablePath } : {}),
      args: [
        "--disable-extensions",
        "--disable-component-extensions-with-background-pages",
        "--disable-background-networking",
        "--disable-sync"
      ]
    });

    const policyEngine = new BrowserPolicyEngine(policy, this.options.addressResolver);
    const networkTransport = this.options.networkTransport ?? new PinnedHttpTransport({ timeoutMs: this.options.navigationTimeoutMs ?? 15_000 });
    const context = await browser.newContext({
      acceptDownloads: policy.allowDownload,
      javaScriptEnabled: policy.javaScriptEnabled ?? true,
      permissions: [],
      serviceWorkers: "block"
    });

    const redirects: string[] = [];
    // v0.5 supports protected HTTP(S) only. WebSockets must not escape the
    // validated/pinned transport via Chromium's separate network channel.
    await context.routeWebSocket("**/*", socket => { void socket.close({ code: 1008, reason: "WebSocket transport is disabled" }).catch(() => undefined); });
    let approvedSubmission: { url: string; method: string; expiresAt: number } | undefined;
    const approveSubmission = (submission?: { url: string; method: string }) => {
      approvedSubmission = policy.allowSubmit && submission ? { ...submission, expiresAt: Date.now() + 5_000 } : undefined;
    };
    const consumeSubmission = (url: string, method: string) => {
      const approved = approvedSubmission;
      if (!approved || approved.expiresAt < Date.now() || approved.url !== url || approved.method !== method) return false;
      approvedSubmission = undefined;
      return true;
    };
    await context.route("**/*", async (route, request) => {
      const mainNavigation = request.isNavigationRequest?.() && Boolean(page.mainFrame) && request.frame?.() === page.mainFrame?.();
      // A script cannot spend an approved form's grant, even when it targets
      // the same URL and method. Only this session's main-frame submission can.
      await proxyBrowserRequest(route, request, policyEngine, networkTransport, mainNavigation ? url => { redirects.push(url); } : undefined, mainNavigation ? consumeSubmission : undefined);
    });

    const page = await context.newPage();
    return new PlaywrightBrowserSession(browser, context, page, policy, {
      navigationTimeoutMs: this.options.navigationTimeoutMs ?? 15_000,
      actionTimeoutMs: this.options.actionTimeoutMs ?? 10_000
    }, redirects, this.options.networkTransport ? undefined : () => networkTransport.close?.(), approveSubmission);
  }
}

export async function proxyBrowserRequest(
  route: RouteLike,
  request: RequestLike,
  policyEngine: BrowserPolicyEngine,
  transport: BrowserNetworkTransport,
  navigateRedirect?: (url: string) => void,
  consumeSubmission?: (url: string, method: string) => boolean
): Promise<void> {
  // Scripts, XHR and beacon do not pass through evaluateClick. A mutation
  // needs the one-use destination/method grant from that authorized action.
  const method = request.method().toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && !consumeSubmission?.(request.url(), method)) { await route.abort("blockedbyclient"); return; }
  const resolved = await policyEngine.resolveConnection(request.url());
  if (!resolved.decision.allowed || !resolved.target) {
    await route.abort("blockedbyclient");
    return;
  }
  try {
    let input = {
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      body: request.postDataBuffer()
    };
    let target = resolved.target;
    for (let hop = 0; hop <= 10; hop++) {
      const response = await transport.fetch(input, target);
      if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.location) {
        await route.fulfill(response);
        return;
      }
      const nextUrl = new URL(response.headers.location, target.url).href;
      const next = await policyEngine.resolveConnection(nextUrl);
      if (!next.decision.allowed || !next.target) { await route.abort("blockedbyclient"); return; }
      if (navigateRedirect && ["GET", "HEAD"].includes(input.method)) {
        // Chromium does not invoke route handlers on redirected requests. Never
        // hand it an HTTP redirect: stage a separately intercepted navigation.
        navigateRedirect(nextUrl);
        await route.fulfill({ status: 200, headers: { "content-type": "text/html", ...(response.headers["set-cookie"] ? { "set-cookie": response.headers["set-cookie"] } : {}) }, body: Buffer.from("<!doctype html><html><head></head><body></body></html>") });
        return;
      }
      const method = response.status === 303 || ([301, 302].includes(response.status) && input.method === "POST") ? "GET" : input.method;
      // Approval covers one physical submission, not another mutation at a
      // redirect target. Its outcome must be reconciled rather than replayed.
      if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) { await route.abort("blockedbyclient"); return; }
      const headers = { ...input.headers };
      if (target.url.origin !== next.target.url.origin) for (const key of Object.keys(headers)) if (["authorization", "cookie"].includes(key.toLowerCase())) delete headers[key];
      input = { ...input, url: nextUrl, method, headers, body: method === "GET" ? null : input.body };
      target = next.target;
    }
    await route.abort("failed");
  } catch {
    await route.abort("failed");
  }
}

export class PlaywrightBrowserSession implements BrowserSession {
  private readonly errors: string[] = [];
  private closed = false;
  private sourceReadError?: Error;

  constructor(
    private readonly browser: BrowserLike,
    private readonly context: BrowserContextLike,
    private readonly page: PageLike,
    private readonly policy: BrowserPolicy,
    private readonly timeouts: { navigationTimeoutMs: number; actionTimeoutMs: number },
    private readonly redirects: string[] = [],
    private readonly closeTransport?: () => void,
    private readonly approveSubmission?: (submission?: { url: string; method: string }) => void
  ) {
    page.on("console", (message) => {
      if (message.type() === "error") this.pushError(message.text());
    });
    page.on("pageerror", (error) => this.pushError(error.message));
    page.on("response", response => {
      const request = response.request();
      if (request.isNavigationRequest?.() && !request.frame?.().parentFrame()) {
        this.sourceReadError = response.status() >= 400 ? new Error(`SOURCE_READ: HTTP ${response.status()} while reading ${request.url()}.`) : undefined;
      }
    });
    page.on("download", async (download) => {
      const executable = /\.(?:exe|msi|msp|msix|dmg|pkg|appimage|deb|rpm|apk|bat|cmd|com|scr|ps1|psm1|sh|bash|zsh|fish|bin|jar)$/i.test(
        download.suggestedFilename()
      );
      if (!this.policy.allowDownload || executable) {
        this.pushError(executable ? "Executable download blocked by browser policy." : "Download blocked by browser policy.");
        await download.cancel().catch(() => undefined);
      }
    });
  }

  async current(): Promise<{ url: string; title: string }> {
    this.assertOpen();
    return { url: this.page.url(), title: await this.page.title() };
  }

  async navigate(url: string): Promise<void> {
    this.assertOpen();
    try {
      this.redirects.length = 0;
      for (let hop = 0; hop <= 10; hop++) {
        await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: this.timeouts.navigationTimeoutMs });
        const next = this.redirects.shift();
        if (!next) { if (this.sourceReadError) throw this.sourceReadError; return; }
        url = next;
      }
      throw new Error("Browser redirect limit exceeded.");
    } catch (error) {
      throw normalizePlaywrightError(error);
    }
  }

  async back(): Promise<void> {
    this.assertOpen();
    try {
      await this.page.goBack({ waitUntil: "domcontentloaded", timeout: this.timeouts.navigationTimeoutMs });
    } catch (error) {
      throw normalizePlaywrightError(error);
    }
  }

  async observe(limits: BrowserObservationLimits): Promise<BrowserObservation> {
    this.assertOpen();
    const redirect = this.redirects.shift();
    if (redirect) await this.navigate(redirect);
    if (this.sourceReadError) throw this.sourceReadError;
    const snapshot = await this.page.evaluate(collectObservation, limits);

    const current = await this.current();
    const errors = this.errors.slice(-limits.maxErrors);
    return {
      url: current.url,
      title: current.title,
      visibleText: snapshot.visibleText,
      interactiveElements: snapshot.interactiveElements as BrowserInteractiveElement[],
      forms: snapshot.forms as BrowserFormObservation[],
      links: snapshot.links as BrowserLinkObservation[],
      errors,
      truncated: {
        ...snapshot.truncated,
        errors: this.errors.length > limits.maxErrors
      }
    };
  }

  async extractText(target: BrowserTarget | undefined, maxChars: number): Promise<string> {
    this.assertOpen();
    try {
      const text = target ? await this.extractTargetText(target, maxChars) : await this.page.locator("body").innerText({ timeout: this.timeouts.actionTimeoutMs });
      const normalized = text.replace(/\s+/g, " ").trim();
      return normalized.slice(0, maxChars);
    } catch (error) {
      throw normalizePlaywrightError(error);
    }
  }

  async inspect(target: BrowserTarget): Promise<BrowserElementInfo> {
    this.assertOpen();
    const locator = await this.requiredLocator(target);
    try {
      return await locator.evaluate(inspectElement);
    } catch (error) {
      throw normalizePlaywrightError(error);
    }
  }

  async click(target: BrowserTarget, approvedSubmission?: { url: string; method: string }): Promise<void> {
    this.assertOpen();
    try {
      this.approveSubmission?.(approvedSubmission);
      await (await this.requiredLocator(target)).click({ timeout: this.timeouts.actionTimeoutMs });
    } catch (error) {
      throw normalizePlaywrightError(error);
    } finally {
      this.approveSubmission?.();
    }
  }

  async fill(target: BrowserTarget, value: string): Promise<void> {
    this.assertOpen();
    try {
      await (await this.requiredLocator(target)).fill(value, { timeout: this.timeouts.actionTimeoutMs });
    } catch (error) {
      throw normalizePlaywrightError(error);
    }
  }

  async scroll(direction: "up" | "down", amount: number): Promise<void> {
    this.assertOpen();
    const delta = direction === "down" ? amount : -amount;
    await this.page.mouse.wheel(0, delta);
  }

  async waitFor(target: BrowserTarget, state: "attached" | "visible" | "hidden", timeoutMs: number): Promise<void> {
    this.assertOpen();
    try {
      const locator = this.locatorFor(target);
      await locator.waitFor({ state, timeout: timeoutMs });
    } catch (error) {
      throw normalizePlaywrightError(error);
    }
  }

  async screenshot(fullPage: boolean): Promise<Buffer> {
    this.assertOpen();
    return this.page.screenshot({ type: "png", fullPage });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.context.close().catch(() => undefined);
    await this.browser.close().catch(() => undefined);
    this.closeTransport?.();
  }

  private locatorFor(target: BrowserTarget): LocatorLike {
    if ("role" in target) {
      return this.page.getByRole(target.role, {
        ...(target.name !== undefined ? { name: target.name } : {}),
        ...(target.exact !== undefined ? { exact: target.exact } : {})
      });
    }
    if ("label" in target) return this.page.getByLabel(target.label, { ...(target.exact !== undefined ? { exact: target.exact } : {}) });
    if ("text" in target) return this.page.getByText(target.text, { ...(target.exact !== undefined ? { exact: target.exact } : {}) });
    if ("placeholder" in target) {
      return this.page.getByPlaceholder(target.placeholder, { ...(target.exact !== undefined ? { exact: target.exact } : {}) });
    }
    return this.page.getByTestId(target.testId);
  }

  private async requiredLocator(target: BrowserTarget): Promise<LocatorLike> {
    const locator = this.locatorFor(target);
    const count = await locator.count();
    if (count === 0) throw new BrowserElementNotFoundError(`Browser target not found: ${describeTarget(target)}`);
    return locator;
  }

  private async extractTargetText(target: BrowserTarget, maxChars: number): Promise<string> {
    const locator = this.locatorFor(target);
    const count = await locator.count();
    if (count === 0) throw new BrowserElementNotFoundError(`Browser target not found: ${describeTarget(target)}`);
    if (count === 1) return locator.innerText({ timeout: this.timeouts.actionTimeoutMs });

    // Extraction is read-only. Preserve every matching piece of evidence instead
    // of applying Playwright's strict single-element rule. Mutating interactions
    // intentionally continue through requiredLocator and remain strict.
    return locator.evaluateAll(
      (elements, limit) =>
        elements
          .map((element) => (element instanceof HTMLElement ? element.innerText : element.textContent ?? ""))
          .join("\n")
          .slice(0, limit),
      maxChars
    );
  }

  private pushError(message: string): void {
    this.errors.push(message.slice(0, 500));
    if (this.errors.length > 50) this.errors.splice(0, this.errors.length - 50);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Browser session is closed.");
  }
}

export function isPlaywrightAvailable(): boolean {
  try {
    loadPlaywright();
    return true;
  } catch {
    return false;
  }
}

function loadPlaywright(): PlaywrightModuleLike {
  const require = createRequire(import.meta.url);
  try {
    return require("playwright") as PlaywrightModuleLike;
  } catch (error) {
    throw new Error(
      `Playwright is required to launch the real BrowserAgent. Install it in the runtime environment before use. ${error instanceof Error ? error.message : ""}`.trim()
    );
  }
}

function describeTarget(target: BrowserTarget): string {
  if ("role" in target) return `role=${target.role}${target.name ? ` name=${target.name}` : ""}`;
  if ("label" in target) return `label=${target.label}`;
  if ("text" in target) return `text=${target.text}`;
  if ("placeholder" in target) return `placeholder=${target.placeholder}`;
  return `testId=${target.testId}`;
}

function normalizePlaywrightError(error: unknown): Error {
  if (error instanceof BrowserElementNotFoundError || error instanceof BrowserTimeoutError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout/i.test(message)) return new BrowserTimeoutError(message);
  return error instanceof Error ? error : new Error(message);
}
