import assert from "node:assert/strict";
import test from "node:test";
import { providers } from "./catalog.js";

test("catalog has unique provider ids and required URLs", () => {
  const ids = new Set<string>();
  for (const provider of providers) {
    assert.ok(provider.id);
    assert.ok(!ids.has(provider.id), `duplicate provider id: ${provider.id}`);
    ids.add(provider.id);
    assert.ok(provider.name);
    assert.match(provider.signupUrl, /^https:\/\//);
    assert.ok(provider.freeTier.length > 0);
    assert.ok(provider.knownFreeModels.length > 0);
    assert.ok(provider.credentialEnvVars.every((envVar) => /^[A-Z0-9_]+$/.test(envVar)));
  }
});

test("catalog includes FreeLLMAPI-prioritized providers", () => {
  const required = [
    "gemini",
    "groq",
    "cerebras",
    "cloudflare-workers-ai",
    "mistral",
    "openrouter",
    "github-models",
    "cohere",
    "sambanova",
    "nvidia-nim",
    "zai",
    "pollinations"
  ];
  const ids = new Set(providers.map((provider) => provider.id));
  for (const id of required) {
    assert.ok(ids.has(id), `missing ${id}`);
  }
});
