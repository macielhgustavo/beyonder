import { describe, expect, it } from "vitest";
import { DefaultToolPolicy, ToolExecutor, ToolRegistry, ToolSideEffect } from "@beyonder/tools";
import { BrowserAgent } from "./browser-agent.js";
import { createBrowserToolDefinitions, type BrowserToolOutput } from "./browser-tools.js";
import { BrowserPolicyEngine, mergeBrowserPolicy, type AddressResolver } from "./policy.js";
import { FakeBrowserSessionFactory } from "./testing/fake-session.js";

class PublicResolver implements AddressResolver {
  async resolve(): Promise<string[]> {
    return ["93.184.216.34"];
  }
}

function setup() {
  const sessionFactory = new FakeBrowserSessionFactory();
  const agent = new BrowserAgent({
    sessionFactory,
    defaultPolicy: { allowDomains: ["example.com"], allowSubmit: false },
    policyEngineFactory: (policy) => new BrowserPolicyEngine(mergeBrowserPolicy(policy), new PublicResolver())
  });
  const registry = new ToolRegistry().registerMany(createBrowserToolDefinitions(agent));
  const executor = new ToolExecutor(registry, { policy: new DefaultToolPolicy() });
  return { executor, registry, sessionFactory };
}

describe("Browser tools", () => {
  it("runs BrowserAgent through ToolRegistry and ToolExecutor", async () => {
    const { executor } = setup();
    const opened = await executor.execute<BrowserToolOutput>({
      id: "tool-open",
      tool: "browser.open",
      arguments: { url: "https://example.com/" }
    });

    expect(opened.success).toBe(true);
    expect(opened.output?.result).toMatchObject({ status: "ok", observation: { title: "Example" } });

    const observed = await executor.execute<BrowserToolOutput>({
      id: "tool-observe",
      tool: "browser.observe",
      arguments: { sessionId: opened.output!.sessionId }
    });

    expect(observed.success).toBe(true);
    expect(observed.output?.result).toMatchObject({
      status: "ok",
      observation: { url: "https://example.com/", visibleText: "Example page" }
    });
  });

  it("keeps mutating browser actions out of the default tool policy", async () => {
    const { executor } = setup();
    const result = await executor.execute<BrowserToolOutput>({
      id: "tool-click",
      tool: "browser.click",
      arguments: { target: { role: "button", name: "Documentation" } }
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: "POLICY_DENIED" });
    expect(result.sideEffects).toEqual([ToolSideEffect.EXTERNAL_ACTION]);
  });

  it("surfaces browser policy denials as safe browser results without executing navigation", async () => {
    const { executor, sessionFactory } = setup();
    const result = await executor.execute<BrowserToolOutput>({
      id: "tool-file",
      tool: "browser.open",
      arguments: { url: "file:///etc/passwd" }
    });

    expect(result.success).toBe(true);
    expect(result.output?.result).toMatchObject({ status: "blocked", policy: { reason: "unsupported-scheme" } });
    expect(sessionFactory.sessions[0]?.url).toBe("about:blank");
  });

  it("lists browser tools as policy-filtered descriptors", async () => {
    const { registry } = setup();
    const available = await registry.getAvailableTools({}, new DefaultToolPolicy());
    const browserTools = available.filter((tool) => tool.id.startsWith("browser."));

    expect(browserTools.map((tool) => tool.id)).toContain("browser.observe");
    expect(browserTools.map((tool) => tool.id)).not.toContain("browser.click");
  });
});
