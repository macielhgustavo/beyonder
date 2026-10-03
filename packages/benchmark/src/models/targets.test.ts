import { describe, expect, it } from "vitest";
import { CredentialBroker } from "@beyonder/compute";
import { selectFreeModelTargets } from "./targets.js";

describe("free model target selection", () => {
  it("ignores unavailable providers and billing-risk states", () => {
    const targets = selectFreeModelTargets(
      {
        version: 1,
        updatedAt: new Date().toISOString(),
        providers: {
          groq: { providerId: "groq", state: "READY", classification: "FULL_AUTO", attempts: 1, lastUpdatedAt: new Date().toISOString() },
          reka: { providerId: "reka", state: "READY", classification: "PAID_ONLY", attempts: 1, lastUpdatedAt: new Date().toISOString() },
          mistral: { providerId: "mistral", state: "FAILED", classification: "FULL_AUTO", attempts: 1, lastUpdatedAt: new Date().toISOString() }
        }
      },
      new CredentialBroker({}, { GROQ_API_KEY: "secret", REKA_API_KEY: "secret", MISTRAL_API_KEY: "secret" })
    );
    expect(targets.map((target) => target.provider)).toContain("groq");
    expect(targets.map((target) => target.provider)).not.toContain("reka");
    expect(targets.map((target) => target.provider)).not.toContain("mistral");
  });

  it("requires OpenRouter models to be explicit free routes", () => {
    const targets = selectFreeModelTargets(
      {
        version: 1,
        updatedAt: new Date().toISOString(),
        providers: {
          openrouter: {
            providerId: "openrouter",
            state: "READY",
            classification: "FULL_AUTO",
            attempts: 1,
            lastUpdatedAt: new Date().toISOString(),
            validation: { status: "validated", models: ["openrouter/auto", "deepseek/deepseek-r1:free"] }
          }
        }
      },
      new CredentialBroker({}, { OPENROUTER_API_KEY: "secret" })
    );
    expect(targets.filter((target) => target.provider === "openrouter").map((target) => target.model)).toEqual(["deepseek/deepseek-r1:free"]);
  });
});
