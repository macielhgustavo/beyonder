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
