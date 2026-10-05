// Test harness only: explicit NODE_OPTIONS preload in an isolated acceptance
// process. Never imported by application code and never used for real acceptance.
import { readFileSync } from "node:fs";
const originalFetch = globalThis.fetch;
let scenarioName, cloudCalls = 0;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const scenario = JSON.parse(readFileSync(process.env.CONTROLLED_SCENARIO_FILE, "utf8"));
  if (scenarioName !== scenario.name) { scenarioName = scenario.name; cloudCalls = 0; }
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  if (url.startsWith("http://127.0.0.1:11599/")) {
    if (url.endsWith("/api/tags")) return json({ models: [{ name: "controlled-local" }, { name: "controlled-local-verifier" }] });
    if (url.endsWith("/api/show")) return json({ capabilities: ["completion", "thinking", "tools"] });
  }
  const provider = url.includes("api.groq.com/") ? "groq" : url.includes("generativelanguage.googleapis.com/") ? "gemini" : url.startsWith("http://127.0.0.1:11599/") && url.endsWith("/api/chat") ? "ollama" : null;
  if (!provider) return originalFetch(input, init);
  if (scenario.delayMs) await new Promise((resolve) => setTimeout(resolve, scenario.delayMs));
  const body = JSON.parse(String(init.body ?? "{}"));
  const verification = body.messages?.[0]?.content?.includes("independent objective verifier");
  if (!verification && provider !== "ollama") {
    const first = cloudCalls++ === 0;
    if (first && scenario.failFirstCloud) return json({ error: "Controlled first cloud unavailable" }, 503);
    if (first && scenario.timeoutFirstCloud) throw new DOMException("Controlled first cloud timeout", "TimeoutError");
  }
  if (!verification && scenario.failProviders?.includes(provider)) return json({ error: "Controlled provider unavailable" }, 503);
  if (!verification && scenario.timeoutProvider === provider) throw new DOMException("Controlled provider timeout", "TimeoutError");
  const verdict = { satisfied: !scenario.badAnswer, confidence: 0.95, relevance: !scenario.badAnswer, completeness: !scenario.badAnswer, consistentWithEvidence: !scenario.badAnswer, reason: scenario.badAnswer ? "Controlled insufficient answer rejected" : "Controlled result satisfies the request", missingRequirements: scenario.badAnswer ? ["correct-answer"] : [], recoveryRecommendation: scenario.badAnswer ? "NONE" : "NONE" };
  const content = verification ? JSON.stringify(verdict) : scenario.badAnswer ?? scenario.goodAnswer ?? "HTTP 404 means the requested resource was not found on the server.";
  return provider === "ollama" ? json({ message: { content } }) : json({ choices: [{ message: { content } }], usage: { total_tokens: 25 } });
};
