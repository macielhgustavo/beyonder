import assert from "node:assert/strict";
import test from "node:test";
import { buildComputeInventory } from "./inventory.js";

test("inventory reports ready and billing-risk status from state", () => {
  const inventory = buildComputeInventory({
    version: 1,
    updatedAt: new Date().toISOString(),
    providers: {
      groq: {
        providerId: "groq",
        state: "READY",
        classification: "AUTO_WITH_HUMAN_GATE",
        attempts: 1,
        lastUpdatedAt: new Date().toISOString(),
        validation: { status: "validated", models: ["llama"], modelCount: 1, latencyMs: 10, rateLimitHeaders: {} }
      }
    }
  });
  assert.equal(inventory.find((entry) => entry.providerId === "groq")?.status, "healthy");
  assert.equal(inventory.find((entry) => entry.providerId === "reka")?.cost, "billing-risk");
});

test("inventory exposes all models and chat-eligible model subset", () => {
  const inventory = buildComputeInventory({
    version: 1,
    updatedAt: new Date().toISOString(),
    providers: {}
  });
  const cloudflare = inventory.find((entry) => entry.providerId === "cloudflare-workers-ai");
  assert.ok(cloudflare);
  assert.ok(cloudflare.models.includes("@cf/baai/bge-base-en-v1.5"));
  assert.ok(!cloudflare.eligibleChatModels.includes("@cf/baai/bge-base-en-v1.5"));
  assert.ok(cloudflare.eligibleChatModels.includes("@cf/meta/llama-3.3-70b-instruct-fp8-fast"));
});

test("NVIDIA inventory never falls back to stale hardcoded models", () => {
  const withoutValidationModels = buildComputeInventory({
    version: 1,
    updatedAt: new Date().toISOString(),
    providers: {
      "nvidia-nim": {
        providerId: "nvidia-nim",
        state: "READY",
        classification: "AUTO_WITH_HUMAN_GATE",
        attempts: 1,
        lastUpdatedAt: new Date().toISOString(),
        validation: { status: "validated", models: [], modelCount: 0, latencyMs: 10, rateLimitHeaders: {} }
      }
    }
  }).find((entry) => entry.providerId === "nvidia-nim");
  assert.ok(withoutValidationModels);
  assert.deepEqual(withoutValidationModels.models, []);
  assert.deepEqual(withoutValidationModels.eligibleChatModels, []);

  const withLiveModels = buildComputeInventory({
    version: 1,
    updatedAt: new Date().toISOString(),
    providers: {
      "nvidia-nim": {
        providerId: "nvidia-nim",
        state: "READY",
        classification: "AUTO_WITH_HUMAN_GATE",
        attempts: 1,
        lastUpdatedAt: new Date().toISOString(),
        validation: {
          status: "validated",
          models: ["account/live-instruct", "account/live-embedding"],
          modelCount: 2,
          latencyMs: 10,
          rateLimitHeaders: {}
        }
      }
    }
  }).find((entry) => entry.providerId === "nvidia-nim");
  assert.ok(withLiveModels);
  assert.deepEqual(withLiveModels.models, ["account/live-instruct", "account/live-embedding"]);
  assert.deepEqual(withLiveModels.eligibleChatModels, ["account/live-instruct"]);
});
