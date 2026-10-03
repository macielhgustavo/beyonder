import { parseBrowserActionJson } from "./action-parser.js";
import type { BrowserAgent } from "./browser-agent.js";
import type { BrowserPolicy } from "./types.js";

export interface BrowserToolCallResult {
  ok: boolean;
  output: string;
  error?: string;
}

/**
 * Temporary structural adapter for the current runtime Tool contract.
 * It intentionally does not import @beyonder/runtime so the browser package
 * stays independent from the parallel Tool Runtime implementation.
 */
export class BrowserRuntimeToolAdapter {
  readonly name = "browser";
  readonly enabled = true;
  private sessionId?: string;

  constructor(
    private readonly agent: BrowserAgent,
    private readonly policy: Partial<BrowserPolicy> = {}
  ) {}

  async run(input: string): Promise<BrowserToolCallResult> {
    let action;
    try {
      action = parseBrowserActionJson(input);
    } catch (error) {
      return {
        ok: false,
        output: "",
        error: error instanceof Error ? error.message : String(error)
      };
    }

    if (!this.sessionId) this.sessionId = await this.agent.startSession(this.policy);
    const sessionId = this.sessionId;
    const result = await this.agent.execute(sessionId, action);
    if (action.type === "close" && result.status === "ok") this.sessionId = undefined;

    const output = JSON.stringify({ sessionId, result });
    if (result.status === "ok") return { ok: true, output };
    if (result.status === "blocked") {
      return {
        ok: false,
        output,
        error: `Browser action blocked: ${result.policy?.reason ?? "policy"}`
      };
    }
    return {
      ok: false,
      output,
      error: result.error?.message ?? "Browser action failed."
    };
  }

  async close(): Promise<void> {
    if (!this.sessionId) return;
    const sessionId = this.sessionId;
    this.sessionId = undefined;
    await this.agent.closeSession(sessionId);
  }
}
