import { describe, expect, it } from "vitest";
import { BrowserAgent } from "./browser-agent.js";
import { BrowserPolicyEngine, mergeBrowserPolicy, type AddressResolver } from "./policy.js";
import { InMemoryBrowserTelemetrySink } from "./telemetry.js";
import { FakeBrowserSessionFactory, targetKey } from "./testing/fake-session.js";

class PublicResolver implements AddressResolver {
  async resolve(): Promise<string[]> {
    return ["93.184.216.34"];
  }
}

function setup(options: { allowDomains?: string[]; authorize?: (id: string) => boolean } = {}) {
  const sessionFactory = new FakeBrowserSessionFactory();
  const telemetry = new InMemoryBrowserTelemetrySink();
  const agent = new BrowserAgent({
    sessionFactory,
    telemetry,
    defaultPolicy: { allowDomains: options.allowDomains ?? [] },
    authorize: options.authorize ? ({ authorizationId }) => options.authorize!(authorizationId) : undefined,
    policyEngineFactory: (policy) => new BrowserPolicyEngine(mergeBrowserPolicy(policy), new PublicResolver())
  });
  return { agent, sessionFactory, telemetry };
}

describe("BrowserAgent", () => {
  it("navigates allowed pages and emits compact observations", async () => {
    const { agent, telemetry } = setup({ allowDomains: ["example.com"] });
    const sessionId = await agent.startSession();
    const result = await agent.execute(sessionId, { type: "open", url: "https://example.com/" });

    expect(result.status).toBe("ok");
    expect(result.observation).toMatchObject({ url: "https://example.com/", title: "Example", visibleText: "Example page" });
    expect(telemetry.events.map((event) => event.name)).toEqual(
      expect.arrayContaining(["browser.session.started", "browser.action.requested", "browser.navigation", "browser.observation", "browser.action.completed"])
    );
    const observationEvent = telemetry.events.find((event) => event.name === "browser.observation");
    expect(observationEvent?.details).not.toHaveProperty("visibleText");
  });

  it("blocks denied domains and file URLs before the session navigates", async () => {
    const { agent, sessionFactory, telemetry } = setup({ allowDomains: ["example.com"] });
    const sessionId = await agent.startSession();

    const domainResult = await agent.execute(sessionId, { type: "navigate", url: "https://other.test/" });
    expect(domainResult).toMatchObject({ status: "blocked", policy: { reason: "domain-not-allowed" } });
    expect(sessionFactory.sessions[0]?.url).toBe("about:blank");

    const fileResult = await agent.execute(sessionId, { type: "navigate", url: "file:///etc/passwd" });
    expect(fileResult).toMatchObject({ status: "blocked", policy: { reason: "unsupported-scheme" } });
    expect(telemetry.events.some((event) => event.name === "browser.action.blocked")).toBe(true);
  });

  it("clicks, fills and extracts without autonomous loops", async () => {
    const { agent, sessionFactory } = setup({ allowDomains: ["example.com"] });
    const sessionId = await agent.startSession();
    await agent.execute(sessionId, { type: "open", url: "https://example.com/" });

    const fill = await agent.execute(sessionId, { type: "fill", target: { label: "Search" }, value: "Playwright browser context" });
    expect(fill.status).toBe("ok");
    expect(sessionFactory.sessions[0]?.filled.get("label:Search")).toBe("Playwright browser context");

    const click = await agent.execute(sessionId, { type: "click", target: { role: "button", name: "Documentation" } });
    expect(click).toMatchObject({ status: "ok", observation: { url: "https://example.com/docs" } });

    const extraction = await agent.execute(sessionId, { type: "extractText" });
    expect(extraction).toMatchObject({ status: "ok", data: { text: "Documentation page" } });
  });

  it("returns element-not-found and timeout errors as structured results", async () => {
    const { agent, sessionFactory } = setup();
    const sessionId = await agent.startSession();

    const missing = await agent.execute(sessionId, { type: "click", target: { role: "button", name: "Missing" } });
    expect(missing).toMatchObject({ status: "error", error: { code: "ELEMENT_NOT_FOUND" } });

    sessionFactory.sessions[0]!.timeoutTargets.add(targetKey({ text: "Never appears" }));
    const timeout = await agent.execute(sessionId, { type: "waitFor", target: { text: "Never appears" }, timeoutMs: 25 });
    expect(timeout).toMatchObject({ status: "error", error: { code: "TIMEOUT" } });
  });

  it("blocks real side effects without explicit authorization", async () => {
    const { agent } = setup({ allowDomains: ["example.com"] });
    const sessionId = await agent.startSession();
    const blocked = await agent.execute(sessionId, { type: "click", target: { role: "button", name: "Save changes" } });
    expect(blocked).toMatchObject({ status: "blocked", policy: { reason: "authorization-required" } });
  });

  it("permits explicitly authorized non-prohibited side effects but never purchases", async () => {
    const { agent } = setup({ allowDomains: ["example.com"], authorize: (id) => id === "approval-1" });
    const sessionId = await agent.startSession();
    const allowed = await agent.execute(sessionId, {
      type: "click",
      target: { role: "button", name: "Save changes" },
      authorizationId: "approval-1"
    });
    expect(allowed.status).toBe("ok");

    const purchase = await agent.execute(sessionId, {
      type: "click",
      target: { role: "button", name: "Purchase" },
      authorizationId: "approval-1"
    });
    expect(purchase).toMatchObject({ status: "blocked", policy: { reason: "purchase-prohibited" } });
  });

  it("redacts fill values and authorization ids from telemetry", async () => {
    const { agent, telemetry } = setup();
    const sessionId = await agent.startSession();
    await agent.execute(sessionId, { type: "fill", target: { label: "Search" }, value: "super-secret-value" });
    await agent.execute(sessionId, {
      type: "click",
      target: { role: "button", name: "Save changes" },
      authorizationId: "approval-secret"
    });
    const serialized = JSON.stringify(telemetry.events);
    expect(serialized).not.toContain("super-secret-value");
    expect(serialized).not.toContain("approval-secret");
  });

  it("cleans up sessions and emits session.closed", async () => {
    const { agent, sessionFactory, telemetry } = setup();
    const first = await agent.startSession();
    const second = await agent.startSession();
    await agent.closeAll();

    expect(agent.hasSession(first)).toBe(false);
    expect(agent.hasSession(second)).toBe(false);
    expect(sessionFactory.sessions.every((session) => session.closed)).toBe(true);
    expect(telemetry.events.filter((event) => event.name === "browser.session.closed")).toHaveLength(2);
  });
});
