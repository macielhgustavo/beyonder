import { describe, expect, it, vi } from "vitest";
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
  it("budgets both complete document navigations without extending interactive open or relaxing policy", async () => {
    vi.useFakeTimers();
    try {
      const factory = new FakeBrowserSessionFactory(), create = factory.create.bind(factory);
      vi.spyOn(factory, "create").mockImplementation(async policy => {
        const session = await create(policy);
        vi.spyOn(session, "observe").mockImplementation(async limits => {
          await new Promise(resolve => setTimeout(resolve, 10_000));
          return { ...await Object.getPrototypeOf(session).observe.call(session, limits), visibleText: policy.javaScriptEnabled === false ? "Table: Loading..." : "Observed complete table" };
        });
        return session;
      });
      const agent = new BrowserAgent({ sessionFactory: factory, policyEngineFactory: policy => new BrowserPolicyEngine(mergeBrowserPolicy(policy), new PublicResolver()) });
      const definitions = createBrowserToolDefinitions(agent);
      expect(definitions.find(tool => tool.id === "browser.open")?.timeoutMs).toBe(15_000);
      const executor = new ToolExecutor(new ToolRegistry().registerMany(definitions));
      const promise = executor.execute<BrowserToolOutput>({ id: "two-complete-reads", tool: "browser.read", arguments: { url: "https://example.com/" } });
      await vi.advanceTimersByTimeAsync(20_000);
      expect((await promise).output?.result.observation?.visibleText).toBe("Observed complete table");
      expect(factory.sessions).toHaveLength(2);
      expect(factory.sessions.every(session => session.closed)).toBe(true);
      expect(factory.lastPolicy).toMatchObject({ allowInternalNetwork: false, allowSubmit: false });
    } finally { vi.useRealTimers(); }
  });
  it("never promotes a still-pending dynamic document and does not accept a caller-owned session", async () => {
    const factory = new FakeBrowserSessionFactory(), create = factory.create.bind(factory);
    vi.spyOn(factory, "create").mockImplementation(async policy => {
      const session = await create(policy);
      vi.spyOn(session, "observe").mockImplementation(async limits => ({ ...await Object.getPrototypeOf(session).observe.call(session, limits), visibleText: "Table: Loading..." }));
      return session;
    });
    const agent = new BrowserAgent({ sessionFactory: factory, policyEngineFactory: policy => new BrowserPolicyEngine(mergeBrowserPolicy(policy), new PublicResolver()) });
    const executor = new ToolExecutor(new ToolRegistry().registerMany(createBrowserToolDefinitions(agent)));
    expect((await executor.execute({ id: "pending", tool: "browser.read", arguments: { url: "https://example.com/" } })).error?.message).toContain("SOURCE_READ");
    expect(factory.sessions.every(session => session.closed)).toBe(true);
    expect((await executor.execute({ id: "owned", tool: "browser.read", arguments: { url: "https://example.com/", sessionId: "existing" } })).success).toBe(false);
  });
  it("reads a static document with unchanged protections and closes its owned session", async () => {
    const sessionFactory = new FakeBrowserSessionFactory();
    const agent = new BrowserAgent({ sessionFactory, policyEngineFactory: policy => new BrowserPolicyEngine(mergeBrowserPolicy(policy), new PublicResolver()) });
    const executor = new ToolExecutor(new ToolRegistry().registerMany(createBrowserToolDefinitions(agent)));
    const result = await executor.execute<BrowserToolOutput>({ id: "document", tool: "browser.open", arguments: { url: "https://example.com/", readMode: "adaptive" } });
    expect(result.output).toMatchObject({ sessionClosed: true, result: { status: "ok", observation: { visibleText: "Example page" } } });
    expect(sessionFactory.lastPolicy).toMatchObject({ javaScriptEnabled: false, allowInternalNetwork: false, allowSubmit: false });
    expect(sessionFactory.sessions).toHaveLength(1);
    expect(sessionFactory.sessions[0]!.closed).toBe(true);
  });
  it("observes dynamic content instead of promoting a static loading placeholder", async () => {
    const sessionFactory = new FakeBrowserSessionFactory();
    const create = sessionFactory.create.bind(sessionFactory);
    vi.spyOn(sessionFactory, "create").mockImplementation(async policy => {
      const session = await create(policy);
      if (policy.javaScriptEnabled === false) vi.spyOn(session, "observe").mockImplementation(async limits => ({ ...await Object.getPrototypeOf(session).observe.call(session, limits), visibleText: "Chart: Loading..." }));
      return session;
    });
    const agent = new BrowserAgent({ sessionFactory, policyEngineFactory: policy => new BrowserPolicyEngine(mergeBrowserPolicy(policy), new PublicResolver()) });
    const executor = new ToolExecutor(new ToolRegistry().registerMany(createBrowserToolDefinitions(agent)));
    const result = await executor.execute<BrowserToolOutput>({ id: "chart", tool: "browser.open", arguments: { url: "https://example.com/", readMode: "adaptive" } });
    expect(result.output?.result.observation?.visibleText).toBe("Example page");
    expect(sessionFactory.sessions).toHaveLength(2);
    expect(sessionFactory.sessions.every(session => session.closed)).toBe(true);
    expect(sessionFactory.lastPolicy).toMatchObject({ allowInternalNetwork: false, allowSubmit: false });
    expect(sessionFactory.lastPolicy?.javaScriptEnabled).not.toBe(false);
  });
  it("disposes a session created after the tool deadline instead of leaving work running", async () => {
    const sessionFactory = new FakeBrowserSessionFactory();
    const create = sessionFactory.create.bind(sessionFactory);
    vi.spyOn(sessionFactory, "create").mockImplementation(async policy => { await new Promise(resolve => setTimeout(resolve, 25)); return create(policy); });
    const agent = new BrowserAgent({ sessionFactory });
    const executor = new ToolExecutor(new ToolRegistry().registerMany(createBrowserToolDefinitions(agent, { timeoutMs: 5 })));
    const result = await executor.execute({ id: "late-session", tool: "browser.open", arguments: { url: "https://example.com/" } });
    expect(result.error?.code).toBe("TIMEOUT");
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(sessionFactory.sessions).toHaveLength(1);
    expect(sessionFactory.sessions[0]!.closed).toBe(true);
  });
  it("opens a static read session while preserving every network and mutation boundary", async () => {
    const sessionFactory = new FakeBrowserSessionFactory();
    const create = vi.spyOn(sessionFactory, "create");
    const agent = new BrowserAgent({ sessionFactory, defaultPolicy: { allowDomains: ["example.com"], allowInternalNetwork: false, allowSubmit: false }, policyEngineFactory: policy => new BrowserPolicyEngine(mergeBrowserPolicy(policy), new PublicResolver()) });
    const executor = new ToolExecutor(new ToolRegistry().registerMany(createBrowserToolDefinitions(agent)), { policy: new DefaultToolPolicy() });
    const result = await executor.execute({ id: "static-read", tool: "browser.open", arguments: { url: "https://example.com/", textOnly: true } });
    expect(result.success).toBe(true);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ javaScriptEnabled: false, allowInternalNetwork: false, allowSubmit: false, allowDomains: ["example.com"] }));
    expect((await executor.execute({ id: "bad-static", tool: "browser.open", arguments: { url: "https://example.com/", textOnly: true, sessionId: "existing" } })).success).toBe(false);
    await agent.closeAll();
  });
  it("advertises actual navigation and extraction arguments to the planner", async () => {
    const { registry } = setup();
    const tools = await registry.getAvailableTools({}, new DefaultToolPolicy());
    expect(tools.find((tool) => tool.id === "browser.open")?.inputSchema).toMatchObject({ additionalProperties: false, required: ["url"], properties: { url: { type: "string" } } });
    expect(tools.find((tool) => tool.id === "browser.extractText")?.inputSchema).toMatchObject({ properties: { target: { type: "object" }, maxChars: { type: "integer" } } });
  });
  it("rejects invented browser arguments before navigation", async () => {
    const { executor, sessionFactory } = setup();
    const result = await executor.execute({ id: "invented", tool: "browser.open", arguments: { url: "https://example.com/", shell: "whoami" } });
    expect(result.success).toBe(false);
    expect(sessionFactory.sessions).toHaveLength(0);
  });
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
