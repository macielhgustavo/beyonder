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

  it("filters Cloudflare and NVIDIA models to chat-compatible BIB targets", () => {
    const targets = selectFreeModelTargets(
      {
        version: 1,
        updatedAt: new Date().toISOString(),
        providers: {
          "cloudflare-workers-ai": {
            providerId: "cloudflare-workers-ai",
            state: "READY",
            classification: "MANUAL_REQUIRED",
            attempts: 1,
            lastUpdatedAt: new Date().toISOString(),
            validation: {
              status: "validated",
              models: ["@cf/baai/bge-base-en-v1.5", "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/openai/whisper"]
            }
          },
          "nvidia-nim": {
            providerId: "nvidia-nim",
            state: "READY",
            classification: "AUTO_WITH_HUMAN_GATE",
            attempts: 1,
            lastUpdatedAt: new Date().toISOString(),
            validation: {
              status: "validated",
              models: ["nvidia/nv-rerankqa-mistral-4b-v3", "qwen/qwen2.5-coder-32b-instruct"]
            }
          }
        }
      },
      new CredentialBroker({}, {
        CLOUDFLARE_ACCOUNT_ID: "account",
        CLOUDFLARE_API_TOKEN: "cf-secret",
        NVIDIA_NIM_API_KEY: "nim-secret"
      })
    );
    expect(targets.filter((target) => target.provider === "cloudflare-workers-ai").map((target) => target.model)).toEqual([
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
    ]);
    expect(targets.filter((target) => target.provider === "nvidia-nim").map((target) => target.model)).toEqual([
      "qwen/qwen2.5-coder-32b-instruct"
    ]);
  });
});
