import { createServer } from "node:http";
import { once } from "node:events";
import { expect, it } from "vitest";
import { loadConfig } from "../config/env.js";
import { ModelRouter, localOutputTokenBudget } from "./model-router.js";

it("keeps local verifier and producer output bounded without a 180-token judgment cap", () => {
  const short = [{ role: "user" as const, content: "Verify this plan." }];
  const long = [{ role: "user" as const, content: "Observed evidence. ".repeat(2000) }];
  expect(localOutputTokenBudget(short, true)).toBeGreaterThanOrEqual(768);
  expect(localOutputTokenBudget(short, false)).toBeGreaterThanOrEqual(1200);
  expect(localOutputTokenBudget(long, true)).toBe(2400);
});

it("records the physical model reported by a local Ollama response", async () => {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/tags") response.end(JSON.stringify({ models: [{ name: "fixture-local:1b" }] }));
    else if (request.url === "/api/show") response.end(JSON.stringify({ capabilities: ["completion"] }));
    else if (request.url === "/api/chat") response.end(JSON.stringify({ model: "fixture-local:1b", message: { content: "OK" }, done_reason: "stop" }));
    else { response.statusCode = 404; response.end("{}"); }
  });
  server.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing local test server address");
    const config = loadConfig({ BEYONDER_MODEL_PROVIDER: "ollama", BEYONDER_MODEL_NAME: "fixture-local:1b", OLLAMA_BASE_URL: `http://127.0.0.1:${address.port}` });
    const result = await new ModelRouter(config.model).complete([{ role: "user", content: "Say OK" }]);
    expect(result.attribution).toEqual({ requestedModel: "fixture-local:1b", reportedModel: "fixture-local:1b" });
    expect(result.estimatedCostUsd).toBe(0);
  } finally {
    server.close();
    await once(server, "close");
  }
});
