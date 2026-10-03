import assert from "node:assert/strict";
import test from "node:test";
import { providers } from "./catalog.js";
import { eligibleModelsForWorkload, isModelEligibleForWorkload } from "./model-capabilities.js";

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

test("Cloudflare and NVIDIA expose explicit capability metadata", () => {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const cloudflare = byId.get("cloudflare-workers-ai");
  const nvidia = byId.get("nvidia-nim");
  assert.ok(cloudflare);
  assert.ok(nvidia);
  assert.ok(cloudflare.modelCatalog?.some((model) => model.capabilities.includes("CHAT")));
  assert.ok(cloudflare.modelCatalog?.some((model) => model.capabilities.includes("EMBEDDING")));
  assert.ok(nvidia.credentialEnvVars[0] === "NVIDIA_NIM_API_KEY");
  assert.equal(nvidia.billingRisk, false);
});

test("capability filtering excludes non-chat models from general text workloads", () => {
  const cloudflare = providers.find((provider) => provider.id === "cloudflare-workers-ai");
  const nvidia = providers.find((provider) => provider.id === "nvidia-nim");
  assert.ok(cloudflare);
  assert.ok(nvidia);
  assert.equal(isModelEligibleForWorkload(cloudflare, "@cf/baai/bge-base-en-v1.5", "general_chat"), false);
  assert.equal(isModelEligibleForWorkload(cloudflare, "@cf/openai/whisper", "benchmark_text"), false);
  assert.equal(isModelEligibleForWorkload(nvidia, "nvidia/nv-rerankqa-mistral-4b-v3", "coding"), false);
  assert.deepEqual(eligibleModelsForWorkload(cloudflare, cloudflare.knownFreeModels, "general_chat"), [
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    "@cf/meta/llama-3.1-8b-instruct",
    "@cf/mistral/mistral-7b-instruct-v0.1"
  ]);
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
