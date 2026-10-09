import { fixtureZeroCost } from './testing/zero-cost-fixture.js';
import { describe, expect, it } from "vitest";
import { CredentialBroker } from "@beyonder/compute";
import { selectFreeModelTargets } from "./targets.js";

describe("free model target selection", () => {
  it("qualifies disabled reasoning only on explicitly compatible free models", () => {
    const targets = selectFixtureTargets({ version: 1, updatedAt: new Date().toISOString(), providers: {
      "kilo-gateway": { providerId: "kilo-gateway", state: "READY", classification: "KEYLESS", attempts: 1, lastUpdatedAt: new Date().toISOString(), validation: { status: "validated", models: ["measured", "unsupported", "paid"], modelMetadata: [
        { id: "measured", capabilities: ["CHAT"], role: "instruct", costClass: "FREE_CONFIRMED", reasoningControl: true },
        { id: "unsupported", capabilities: ["CHAT"], role: "instruct", costClass: "FREE_CONFIRMED", reasoningControl: false },
        { id: "paid", capabilities: ["CHAT"], role: "instruct", costClass: "PAID", reasoningControl: true }
      ] } }
    } }, new CredentialBroker({}, {}), { provider: "kilo-gateway", models: ["measured", "unsupported", "paid"], reasoningMode: "disabled" });
    expect(targets.map(t => t.model)).toEqual(["measured"]);
    expect(targets[0]?.reasoning).toEqual({ enabled: false });
  });
  it("ignores unavailable providers and billing-risk states", () => {
    const targets = selectFixtureTargets(
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
    const targets = selectFixtureTargets(
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
    const targets = selectFixtureTargets(
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

it('never serializes credential material on selected benchmark targets',()=>{
 const secret='opaque-target-only-material';const targets=selectFixtureTargets({version:1,updatedAt:new Date().toISOString(),providers:{groq:{providerId:'groq',state:'READY',classification:'FULL_AUTO',attempts:1,lastUpdatedAt:new Date().toISOString()}}},new CredentialBroker({}, {GROQ_API_KEY:secret}));
 expect(targets.length).toBeGreaterThan(0);expect(targets[0].apiKey).toBe(secret);expect(JSON.stringify(targets)).not.toContain(secret);
});

const selectFixtureTargets: typeof selectFreeModelTargets = (state, broker, selection = {}) => selectFreeModelTargets(state, broker, { economicEvidence: fixtureZeroCost, ...selection });

it('rechecks observed exhausted quota before a previously selected benchmark target can POST', async () => {
 const { mkdtemp, rm } = await import('node:fs/promises'); const { join } = await import('node:path'); const { tmpdir } = await import('node:os');
 const { AutopilotStateStore, getProvider } = await import('@beyonder/compute'); const { OpenAiCompatibleBenchmarkClient } = await import('./openai-compatible-client.js'); const { vi } = await import('vitest');
 const dir = await mkdtemp(join(tmpdir(), 'benchmark-quota-drift-'));
 try {
  const path = join(dir, 'providers.json'), store = new AutopilotStateStore(path), provider = getProvider('kilo-gateway')!, model = 'vendor/measured:free';
  const validation = { status: 'validated' as const, models: [model], modelMetadata: [{ id: model, capabilities: ['CHAT' as const], role: 'instruct' as const, costClass: 'FREE_TIER_ELIGIBLE' as const, costEvidence: { source: 'live-catalog' as const, observedAt: new Date().toISOString(), zeroPrice: true, explicitFreeRoute: true } }] };
  await store.update(provider, 'READY', { validation });
  const targets = selectFreeModelTargets(await store.read(), new CredentialBroker({}, {}, { providerStatePath: path }), { provider: provider.id, models: [model] });
  expect(targets).toHaveLength(1);
  await store.update(provider, 'READY', { validation: { ...validation, rateLimitHeaders: { 'ratelimit-remaining': '0' } } });
  const spy = vi.spyOn(globalThis, 'fetch');
  try { await expect(new OpenAiCompatibleBenchmarkClient().complete(targets[0], [])).rejects.toMatchObject({ errorCode: 'ECONOMIC_POLICY_BLOCKED' }); expect(spy).not.toHaveBeenCalled(); } finally { spy.mockRestore(); }
 } finally { await rm(dir, { recursive: true, force: true }); }
});
