import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleBenchmarkClient } from "./openai-compatible-client.js";

describe("OpenAiCompatibleBenchmarkClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([0.01, 0.25, 1.2])("retains a reported charge %s and stops free qualification", async cost => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }], usage: { cost } })));
    await expect(new OpenAiCompatibleBenchmarkClient().complete({ provider: "free", providerName: "Free", model: "model", baseUrl: "https://example.com/v1" }, [{ role: "user", content: "OK" }])).rejects.toMatchObject({ errorCode: "BILLING_REQUIRED", monetaryCostUsd: cost });
  });

  it.each([{ error: { message: "overloaded" } }, { choices: [] }, { choices: [{ message: { content: "" } }] }])("does not grade an invalid HTTP 200 envelope as model quality", async envelope => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(envelope)));
    await expect(new OpenAiCompatibleBenchmarkClient().complete({ provider: "free", providerName: "Free", model: "model", baseUrl: "https://example.com/v1" }, [])).rejects.toMatchObject({ errorCode: "INVALID_OUTPUT" });
  });

  it.each(["different-model", "", undefined])("does not attribute a remapped or unknown physical model %s to the requested candidate", async model => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ model, choices: [{ message: { content: "OK" } }], usage: { cost: 0 } })));
    await expect(new OpenAiCompatibleBenchmarkClient().complete({ provider: "free", providerName: "Free", model: "vendor/requested:free", baseUrl: "https://example.com/v1" }, [])).rejects.toMatchObject({ errorCode: "INVALID_OUTPUT" });
  });

  it("attributes the same physical model despite gateway vendor and free suffix formatting", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ model: "other-vendor/requested", choices: [{ message: { content: "OK" } }], usage: { cost: 0 } })));
    expect(await new OpenAiCompatibleBenchmarkClient().complete({ provider: "free", providerName: "Free", model: "vendor/requested:free", baseUrl: "https://example.com/v1" }, [])).toMatchObject({ model: "vendor/requested:free", content: "OK", estimatedCostUsd: 0 });
  });

  it("uses Cloudflare Workers AI native run endpoint for Cloudflare targets", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      result: {
        choices: [{ message: { content: "BEYONDER_CLOUDFLARE_OK" } }],
        usage: { total_tokens: 7 }
      }
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const response = await new OpenAiCompatibleBenchmarkClient().complete({
      provider: "cloudflare-workers-ai",
      providerName: "Cloudflare Workers AI",
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      baseUrl: "https://api.cloudflare.com/client/v4/accounts/account-id/ai/v1",
      apiKey: "secret",
      accountId: "account-id"
    }, [{ role: "user", content: "Return exactly: BEYONDER_CLOUDFLARE_OK" }]);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.cloudflare.com/client/v4/accounts/account-id/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    expect(response.content).toBe("BEYONDER_CLOUDFLARE_OK");
    expect(response.tokens).toBe(7);
  });
});
