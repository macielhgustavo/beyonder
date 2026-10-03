import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleBenchmarkClient } from "./openai-compatible-client.js";

describe("OpenAiCompatibleBenchmarkClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
