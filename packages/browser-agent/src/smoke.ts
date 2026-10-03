import { BrowserAgent } from "./browser-agent.js";
import { PlaywrightBrowserSessionFactory } from "./playwright-session.js";

const agent = new BrowserAgent({
  sessionFactory: new PlaywrightBrowserSessionFactory({ headless: true }),
  defaultPolicy: { allowDomains: ["example.com"] }
});

const sessionId = await agent.startSession();
try {
  const opened = await agent.execute(sessionId, { type: "open", url: "https://example.com/" });
  if (opened.status !== "ok") throw new Error(`Smoke navigation failed: ${JSON.stringify(opened)}`);
  const text = await agent.execute(sessionId, { type: "extractText", maxChars: 1_000 });
  if (text.status !== "ok") throw new Error(`Smoke extraction failed: ${JSON.stringify(text)}`);
  const current = await agent.execute(sessionId, { type: "current" });
  process.stdout.write(`${JSON.stringify({ opened: opened.observation?.title, current: current.data, text: text.data }, null, 2)}\n`);
} finally {
  await agent.closeAll();
}
