import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrowserAgent } from "./browser-agent.js";
import { isPlaywrightAvailable, PlaywrightBrowserSessionFactory } from "./playwright-session.js";
import { startBrowserTestServer, type BrowserTestServer } from "./testing/test-server.js";
import { BrowserPolicyEngine } from "./policy.js";
import { createServer } from "node:http";

const playwrightAvailable = isPlaywrightAvailable();
if (process.env.BEYONDER_BROWSER_E2E === "1" && !playwrightAvailable) {
  throw new Error("BEYONDER_BROWSER_E2E=1 requires Playwright to be installed.");
}

const suite = playwrightAvailable ? describe : describe.skip;

suite("BrowserAgent Playwright deterministic integration", () => {
  let server: BrowserTestServer;
  let agent: BrowserAgent;
  let sessionId: string;

  beforeAll(async () => {
    server = await startBrowserTestServer();
    agent = new BrowserAgent({
      sessionFactory: new PlaywrightBrowserSessionFactory({ headless: true }),
      defaultPolicy: { allowInternalNetwork: true, allowDomains: ["127.0.0.1"] }
    });
    sessionId = await agent.startSession();
  });

  afterAll(async () => {
    await agent?.closeAll();
    await server?.close();
  });

  it("disables the unsupported WebSocket channel even for a permitted test origin", async () => {
    let socketHits = 0;
    const ownedServer = createServer((_request, response) => { response.end("<h1>Source</h1><script>new WebSocket('ws://'+location.host+'/socket')</script>"); });
    ownedServer.on("upgrade", (_request, socket) => { socketHits++; socket.end(); });
    await new Promise<void>(resolve => ownedServer.listen(0, "127.0.0.1", resolve));
    const port = (ownedServer.address() as { port: number }).port;
    const reader = new BrowserAgent({ sessionFactory: new PlaywrightBrowserSessionFactory(), defaultPolicy: { allowInternalNetwork: true } });
    try {
      const id = await reader.startSession();
      expect((await reader.execute(id, { type: "open", url: `http://127.0.0.1:${port}/` })).status).toBe("ok");
      await new Promise(resolve => setTimeout(resolve, 250));
      expect(socketHits).toBe(0);
    } finally { await reader.closeAll(); await new Promise<void>(resolve => ownedServer.close(() => resolve())); }
  });

  it.each(["127.0.0.1", "2130706433", "[::ffff:127.0.0.1]"])("never lets source scripts open an unprotected WebSocket to %s", async host => {
    let privateHits = 0;
    const privateServer = createServer();
    privateServer.on("upgrade", (_request, socket) => { privateHits++; socket.end(); });
    await new Promise<void>(resolve => privateServer.listen(0, "127.0.0.1", resolve));
    const port = (privateServer.address() as { port: number }).port;
    const resolver = { async resolve(hostname: string) { return hostname === "public.test" ? ["93.184.216.34"] : ["127.0.0.1"]; } };
    const protectedReader = new BrowserAgent({ policyEngineFactory: policy => new BrowserPolicyEngine(policy, resolver), sessionFactory: new PlaywrightBrowserSessionFactory({ addressResolver: resolver, networkTransport: { async fetch() { return { status: 200, headers: { "content-type": "text/html" }, body: Buffer.from(`<h1>Public source</h1><script>new WebSocket('ws://${host}:${port}/private')</script>`) }; } } }) });
    try {
      const id = await protectedReader.startSession();
      expect((await protectedReader.execute(id, { type: "open", url: "http://public.test/" })).status).toBe("ok");
      await new Promise(resolve => setTimeout(resolve, 250));
      expect(privateHits).toBe(0);
    } finally { await protectedReader.closeAll(); await new Promise<void>(resolve => privateServer.close(() => resolve())); }
  });

  it.each([["fetch", false], ["xhr", false], ["beacon", false], ["fetch", true], ["xhr", true], ["beacon", true]] as const)("scripts cannot perform unapproved %s writes, even with submit enabled=%s", async (method, allowSubmit) => {
    const isolatedServer = await startBrowserTestServer();
    const reader = new BrowserAgent({ sessionFactory: new PlaywrightBrowserSessionFactory(), defaultPolicy: { allowInternalNetwork: true, allowSubmit } });
    try {
      const id = await reader.startSession();
      expect((await reader.execute(id, { type: "open", url: `${isolatedServer.baseUrl}/script-write-${method}` })).status).toBe("ok");
      await new Promise(resolve => setTimeout(resolve, 250));
      expect(isolatedServer.getPostCount()).toBe(0);
    } finally { await reader.closeAll(); await isolatedServer.close(); }
  });

  it("allows exactly the approved form submission and rejects later scripted writes", async () => {
    const isolatedServer = await startBrowserTestServer();
    const writer = new BrowserAgent({ sessionFactory: new PlaywrightBrowserSessionFactory(), defaultPolicy: { allowInternalNetwork: true, allowSubmit: true }, authorize: ({ authorizationId }) => authorizationId === "owned-test-approval" });
    try {
      const id = await writer.startSession();
      await writer.execute(id, { type: "open", url: isolatedServer.baseUrl });
      expect(await writer.execute(id, { type: "click", target: { role: "button", name: "Save changes" } })).toMatchObject({ status: "blocked" });
      expect(isolatedServer.getPostCount()).toBe(0);
      expect(await writer.execute(id, { type: "click", target: { role: "button", name: "Save changes" }, authorizationId: "owned-test-approval" })).toMatchObject({ status: "ok" });
      expect(isolatedServer.getPostCount()).toBe(1);
      await writer.execute(id, { type: "open", url: `${isolatedServer.baseUrl}/script-write-fetch` });
      await new Promise(resolve => setTimeout(resolve, 250));
      expect(isolatedServer.getPostCount()).toBe(1);
    } finally { await writer.closeAll(); await isolatedServer.close(); }
  });

  it.each(["fetch", "xhr", "beacon"])("an approved form cannot donate its grant to a same-destination %s script", async method => {
    const isolatedServer = await startBrowserTestServer();
    const writer = new BrowserAgent({ sessionFactory: new PlaywrightBrowserSessionFactory(), defaultPolicy: { allowInternalNetwork: true, allowSubmit: true }, authorize: ({ authorizationId }) => authorizationId === "owned-test-approval" });
    try {
      const id = await writer.startSession();
      await writer.execute(id, { type: "open", url: `${isolatedServer.baseUrl}/grant-hijack-${method}` });
      await writer.execute(id, { type: "click", target: { role: "button", name: "Save changes" }, authorizationId: "owned-test-approval" });
      await new Promise(resolve => setTimeout(resolve, 250));
      expect(isolatedServer.getPostBodies()).toEqual([]);
      expect(isolatedServer.getPostCount()).toBe(0);
    } finally { await writer.closeAll(); await isolatedServer.close(); }
  });

  it.each(["/missing-release", "/missing-documentation", "/missing-index"])("never counts an HTTP error page as observed source evidence: %s", async path => {
    const result = await agent.execute(sessionId, { type: "open", url: `${server.baseUrl}${path}` });
    expect(result).toMatchObject({ status: "error", error: { message: expect.stringContaining("SOURCE_READ: HTTP 404") } });
    expect(result.observation).toBeUndefined();
    expect(await agent.execute(sessionId, { type: "observe" })).toMatchObject({ status: "error" });
    expect(await agent.execute(sessionId, { type: "open", url: `${server.baseUrl}/docs` })).toMatchObject({ status: "ok" });
  });

  it("navigates, fills, clicks, extracts and follows redirects", async () => {
    const opened = await agent.execute(sessionId, { type: "open", url: `${server.baseUrl}/` });
    expect(opened).toMatchObject({ status: "ok", observation: { title: "Beyonder Browser Fixture" } });

    const fill = await agent.execute(sessionId, { type: "fill", target: { label: "Search" }, value: "Playwright browser context" });
    expect(fill, JSON.stringify(fill)).toMatchObject({ status: "ok" });

    const echo = await agent.execute(sessionId, { type: "click", target: { role: "button", name: "Echo search" } });
    expect(echo, JSON.stringify(echo)).toMatchObject({ status: "ok" });
    const extracted = await agent.execute(sessionId, { type: "extractText", target: { text: "Playwright browser context", exact: true } });
    expect(extracted).toMatchObject({ status: "ok", data: { text: "Playwright browser context" } });

    const docs = await agent.execute(sessionId, { type: "click", target: { role: "button", name: "Documentation" } });
    expect(docs).toMatchObject({ status: "ok", observation: { title: "Documentation" } });
    await agent.execute(sessionId, { type: "back" });

    const redirect = await agent.execute(sessionId, { type: "click", target: { text: "Redirect", exact: true } });
    expect(redirect).toMatchObject({ status: "ok", observation: { title: "Redirect complete" } });
  });
  it("observes the complete document with repeated response fields in real Chromium", async () => {
    const result = await agent.execute(sessionId, { type: "open", url: `${server.baseUrl}/duplicate-header` });
    expect(result).toMatchObject({ status: "ok", observation: { title: "Repeated headers", visibleText: "The complete public document was observed." } });
  });

  it.each(["/superseded-s", "/superseded-del", "/superseded-update"])("preserves observed superseded markup without modifying the page: %s", async path => {
    const result = await agent.execute(sessionId, { type: "open", url: `${server.baseUrl}${path}` });
    expect(result.status).toBe("ok");
    expect(result.observation?.visibleText).toContain("[SUPERSEDED]Large transactions may fail in the obsolete release.[/SUPERSEDED]");
    expect(result.observation?.visibleText).toContain("Current releases support large transactions efficiently.");
  });

  it("waits for elements, reports timeout, screenshots, and blocks side effects", async () => {
    await agent.execute(sessionId, { type: "navigate", url: `${server.baseUrl}/slow` });
    const waited = await agent.execute(sessionId, { type: "waitFor", target: { role: "button", name: "Ready" }, timeoutMs: 2_000 });
    expect(waited.status).toBe("ok");

    const timeout = await agent.execute(sessionId, { type: "waitFor", target: { text: "Never appears" }, timeoutMs: 50 });
    expect(timeout).toMatchObject({ status: "error", error: { code: "TIMEOUT" } });

    const screenshot = await agent.execute(sessionId, { type: "screenshot" });
    expect(screenshot).toMatchObject({ status: "ok", data: { mimeType: "image/png" } });

    await agent.execute(sessionId, { type: "navigate", url: `${server.baseUrl}/` });
    const blocked = await agent.execute(sessionId, { type: "click", target: { role: "button", name: "Save changes" } });
    expect(blocked).toMatchObject({ status: "blocked", policy: { reason: "submit-disabled" } });
    expect(server.getPostCount()).toBe(0);

    const purchase = await agent.execute(sessionId, { type: "click", target: { role: "button", name: "Purchase" }, authorizationId: "ignored" });
    expect(purchase).toMatchObject({ status: "blocked", policy: { reason: "purchase-prohibited" } });
    expect(server.getPostCount()).toBe(0);
  });

  it("extracts bounded read-only evidence from duplicate text matches", async () => {
    await agent.execute(sessionId, { type: "navigate", url: `${server.baseUrl}/duplicate-text` });

    const extracted = await agent.execute(sessionId, {
      type: "extractText",
      target: { text: "Download Python" },
      maxChars: 120
    });

    expect(extracted).toMatchObject({
      status: "ok",
      data: {
        text: expect.stringContaining("Download Python for Any OS")
      }
    });
    expect(JSON.stringify(extracted)).not.toContain("strict mode violation");
    expect(extracted).toMatchObject({
      status: "ok",
      data: {
        text: expect.stringContaining("Latest stable release: Python 3.14.8")
      }
    });
  });

  it("preserves browser cookies across pinned redirects", async () => {
    const result = await agent.execute(sessionId, { type: "navigate", url: `${server.baseUrl}/cookie-set` });
    expect(result).toMatchObject({ status: "ok", observation: { title: "Session preserved" } });
  });

  it.each(["127.0.0.1", "localhost", "[::ffff:127.0.0.1]"])("blocks a redirect to %s in actual Chromium before any unprotected request", async host => {
    const publicResolver = { async resolve(hostname: string) { return hostname === "public.test" ? ["93.184.216.34"] : ["127.0.0.1"]; } };
    const port = new URL(server.baseUrl).port;
    const protectedAgent = new BrowserAgent({ policyEngineFactory: policy => new BrowserPolicyEngine(policy, publicResolver), sessionFactory: new PlaywrightBrowserSessionFactory({ addressResolver: publicResolver, networkTransport: { async fetch() { return { status: 307, headers: { location: `http://${host}:${port}/` }, body: Buffer.alloc(0) }; } } }) });
    try {
      const session = await protectedAgent.startSession();
      const result = await protectedAgent.execute(session, { type: "open", url: "https://public.test/" });
      expect(result.status).toBe("error");
      expect(result.observation).toBeUndefined();
    } finally { await protectedAgent.closeAll(); }
  });
});
