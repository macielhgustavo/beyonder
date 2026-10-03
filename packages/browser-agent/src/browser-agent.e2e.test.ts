import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrowserAgent } from "./browser-agent.js";
import { isPlaywrightAvailable, PlaywrightBrowserSessionFactory } from "./playwright-session.js";
import { startBrowserTestServer, type BrowserTestServer } from "./testing/test-server.js";

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
    expect(blocked).toMatchObject({ status: "blocked", policy: { reason: "authorization-required" } });
    expect(server.getPostCount()).toBe(0);

    const purchase = await agent.execute(sessionId, { type: "click", target: { role: "button", name: "Purchase" }, authorizationId: "ignored" });
    expect(purchase).toMatchObject({ status: "blocked", policy: { reason: "purchase-prohibited" } });
    expect(server.getPostCount()).toBe(0);
  });
});
