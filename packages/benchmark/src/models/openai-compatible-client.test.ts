import { fixtureZeroCost } from './testing/zero-cost-fixture.js';
import { getProvider } from '@beyonder/compute';
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleBenchmarkClient } from "./openai-compatible-client.js";

describe("OpenAiCompatibleBenchmarkClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([0.01, 0.25, 1.2])("retains a reported charge %s and stops free qualification", async cost => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }], usage: { cost } })));
    await expect(fixtureComplete({ provider: "free", providerName: "Free", model: "model", baseUrl: "https://example.com/v1" }, [{ role: "user", content: "OK" }])).rejects.toMatchObject({ errorCode: "BILLING_REQUIRED", monetaryCostUsd: cost });
  });

  it.each([{ error: { message: "overloaded" } }, { choices: [] }, { choices: [{ message: { content: "" } }] }])("does not grade an invalid HTTP 200 envelope as model quality", async envelope => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(envelope)));
    await expect(fixtureComplete({ provider: "free", providerName: "Free", model: "model", baseUrl: "https://example.com/v1" }, [])).rejects.toMatchObject({ errorCode: "INVALID_OUTPUT" });
  });

  it.each(["different-model", "", undefined])("does not attribute a remapped or unknown physical model %s to the requested candidate", async model => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ model, choices: [{ message: { content: "OK" } }], usage: { cost: 0 } })));
    await expect(fixtureComplete({ provider: "free", providerName: "Free", model: "vendor/requested:free", baseUrl: "https://example.com/v1" }, [])).rejects.toMatchObject({ errorCode: "INVALID_OUTPUT" });
  });

  it("attributes the same physical model despite gateway vendor and free suffix formatting", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ model: "other-vendor/requested", choices: [{ message: { content: "OK" } }], usage: { cost: 0 } })));
    expect(await fixtureComplete({ provider: "free", providerName: "Free", model: "vendor/requested:free", baseUrl: "https://example.com/v1" }, [])).toMatchObject({ model: "vendor/requested:free", content: "OK", estimatedCostUsd: 0 });
  });

  it("uses Cloudflare Workers AI native run endpoint for Cloudflare targets", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      result: {
        choices: [{ message: { content: "BEYONDER_CLOUDFLARE_OK" } }],
        usage: { total_tokens: 7 }
      }
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const response = await fixtureComplete({
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


it.each(['vendor/step-5-preview-free','vendor/model-2-free','vendor/model-3:free'])('keeps free request route while attributing its physical model %s',async targetModel=>{
 const model=targetModel.replace(/(?::|-)free$/,'');const spy=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({model,choices:[{message:{content:'OK'}}],usage:{cost:0}})));
 try {const result=await fixtureComplete({provider:'free',providerName:'Free',model:targetModel,baseUrl:'https://example.com/v1'},[]);expect(result.model).toBe(targetModel);expect(JSON.parse(String(spy.mock.calls[0][1]?.body)).model).toBe(targetModel);} finally {spy.mockRestore();}
});

function fixtureComplete(target: Parameters<OpenAiCompatibleBenchmarkClient['complete']>[0], messages: Parameters<OpenAiCompatibleBenchmarkClient['complete']>[1]) {
 const provider = target.provider === 'free' ? 'kilo-gateway' : target.provider;
 return new OpenAiCompatibleBenchmarkClient().complete({ ...target, provider, baseUrl: getProvider(provider)!.openAiCompatibleEndpoint!.replace('{account_id}', target.accountId ?? ''), economics: fixtureZeroCost(provider, target.model) }, messages);
}
it('never invokes transport for proofless targets even when labelled free', async () => {
 const spy = vi.spyOn(globalThis, 'fetch');
 try { await expect(new OpenAiCompatibleBenchmarkClient().complete({ provider: 'kilo-gateway', providerName: 'Kilo', model: 'vendor/model:free', baseUrl: getProvider('kilo-gateway')!.openAiCompatibleEndpoint }, [])).rejects.toMatchObject({ errorCode: 'ECONOMIC_POLICY_BLOCKED' }); expect(spy).not.toHaveBeenCalled(); } finally { spy.mockRestore(); }
});

it.each([0.04, null])('blocks every later model on a provider after contradictory usage %s', async cost => {
 const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ model: 'vendor/first', choices: [{ message: { content: 'OK' } }], usage: { cost } })));
 try {
  const client = new OpenAiCompatibleBenchmarkClient();
  const target = { provider: 'kilo-gateway', providerName: 'Kilo', model: 'vendor/first:free', baseUrl: getProvider('kilo-gateway')!.openAiCompatibleEndpoint, economics: fixtureZeroCost('kilo-gateway', 'vendor/first:free') };
  await expect(client.complete(target, [])).rejects.toMatchObject({ errorCode: cost === null ? 'INVALID_COST' : 'BILLING_REQUIRED' });
  const second = { ...target, model: 'vendor/second:free', economics: fixtureZeroCost('kilo-gateway', 'vendor/second:free') };
  await expect(client.complete(second, [])).rejects.toMatchObject({ errorCode: 'ECONOMIC_POLICY_BLOCKED' });
  expect(spy).toHaveBeenCalledTimes(1);
 } finally { spy.mockRestore(); }
});
