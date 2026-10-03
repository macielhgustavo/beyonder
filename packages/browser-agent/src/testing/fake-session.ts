import { BrowserElementNotFoundError, BrowserTimeoutError } from "../errors.js";
import type {
  BrowserElementInfo,
  BrowserObservation,
  BrowserObservationLimits,
  BrowserPolicy,
  BrowserSession,
  BrowserSessionFactory,
  BrowserTarget
} from "../types.js";

export class FakeBrowserSessionFactory implements BrowserSessionFactory {
  readonly sessions: FakeBrowserSession[] = [];
  lastPolicy?: BrowserPolicy;

  async create(policy: BrowserPolicy): Promise<BrowserSession> {
    this.lastPolicy = policy;
    const session = new FakeBrowserSession();
    this.sessions.push(session);
    return session;
  }
}

export class FakeBrowserSession implements BrowserSession {
  url = "about:blank";
  title = "";
  closed = false;
  text = "";
  readonly filled = new Map<string, string>();
  readonly elements = new Map<string, BrowserElementInfo>();
  timeoutTargets = new Set<string>();

  constructor() {
    this.elements.set("role:button:Documentation", { tag: "button", role: "button", name: "Documentation", isSubmit: false });
    this.elements.set("label:Search", { tag: "input", inputType: "text", name: "Search", isSubmit: false });
    this.elements.set("role:button:Save changes", {
      tag: "button",
      role: "button",
      name: "Save changes",
      formMethod: "post",
      formAction: "https://example.com/save",
      isSubmit: true
    });
    this.elements.set("role:button:Purchase", {
      tag: "button",
      role: "button",
      name: "Purchase",
      formMethod: "post",
      formAction: "https://example.com/checkout",
      isSubmit: true
    });
  }

  async current() {
    return { url: this.url, title: this.title };
  }

  async navigate(url: string): Promise<void> {
    this.url = url;
    this.title = url.includes("docs") ? "Documentation" : "Example";
    this.text = url.includes("docs") ? "Documentation page" : "Example page";
  }

  async back(): Promise<void> {
    this.url = "https://example.com/";
    this.title = "Example";
    this.text = "Example page";
  }

  async observe(limits: BrowserObservationLimits): Promise<BrowserObservation> {
    return {
      url: this.url,
      title: this.title,
      visibleText: this.text.slice(0, limits.maxTextChars),
      interactiveElements: [...this.elements.values()].slice(0, limits.maxInteractiveElements).map((element, index) => ({ index, ...element })),
      forms: [],
      links: [],
      errors: [],
      truncated: { text: this.text.length > limits.maxTextChars, interactiveElements: false, forms: false, links: false, errors: false }
    };
  }

  async extractText(target: BrowserTarget | undefined, maxChars: number): Promise<string> {
    if (target) await this.requireElement(target);
    return this.text.slice(0, maxChars);
  }

  async inspect(target: BrowserTarget): Promise<BrowserElementInfo> {
    return this.requireElement(target);
  }

  async click(target: BrowserTarget): Promise<void> {
    const element = await this.requireElement(target);
    if (element.name === "Documentation") {
      this.url = "https://example.com/docs";
      this.title = "Documentation";
      this.text = "Documentation page";
    }
  }

  async fill(target: BrowserTarget, value: string): Promise<void> {
    await this.requireElement(target);
    this.filled.set(targetKey(target), value);
  }

  async scroll(): Promise<void> {}

  async waitFor(target: BrowserTarget): Promise<void> {
    const key = targetKey(target);
    if (this.timeoutTargets.has(key)) throw new BrowserTimeoutError(`Timed out waiting for ${key}`);
    await this.requireElement(target);
  }

  async screenshot(): Promise<Buffer> {
    return Buffer.from("fake-png");
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private async requireElement(target: BrowserTarget): Promise<BrowserElementInfo> {
    const element = this.elements.get(targetKey(target));
    if (!element) throw new BrowserElementNotFoundError(`Missing ${targetKey(target)}`);
    return element;
  }
}

export function targetKey(target: BrowserTarget): string {
  if ("role" in target) return `role:${target.role}:${target.name ?? ""}`;
  if ("label" in target) return `label:${target.label}`;
  if ("text" in target) return `text:${target.text}`;
  if ("placeholder" in target) return `placeholder:${target.placeholder}`;
  return `testId:${target.testId}`;
}
