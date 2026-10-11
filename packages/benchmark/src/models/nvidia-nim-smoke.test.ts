import { fixtureZeroCost } from './testing/zero-cost-fixture.js';
import { describe, expect, it } from "vitest";
import { NVIDIA_NIM_SMOKE_EXPECTED, runNvidiaNimSmoke } from "./nvidia-nim-smoke.js";

describe("NVIDIA NIM smoke", () => {
  it("uses the authenticated catalog, skips non-chat models, and finds a working instruct model", async () => {
    const calls: Array<{ url: string; model?: string }> = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.endsWith("/models")) {
        calls.push({ url });
        return jsonResponse({
          data: [
            { id: "nvidia/example-embedding" },
            { id: "vendor/dead-instruct" },
            { id: "vendor/live-instruct" }
          ]
        });
      }
      const model = JSON.parse(String(init?.body)) as { model: string };
      calls.push({ url, model: model.model });
      if (model.model === "vendor/dead-instruct") {
        return jsonResponse({ error: { code: "MODEL_UNAVAILABLE", message: "model end-of-life" } }, 404);
      }
      return jsonResponse({ choices: [{ message: { content: NVIDIA_NIM_SMOKE_EXPECTED } }] });
    };

    const result = await runFixtureSmoke("test-key", { fetchImpl: fetchImpl as typeof fetch });

    expect(result.ok).toBe(true);
    expect(result.model).toBe("vendor/live-instruct");
    expect(result.catalogModelCount).toBe(3);
    expect(result.chatCandidateCount).toBe(2);
    expect(result.monetaryCostUsd).toBe(0);
    expect(result.attempts).toEqual([
      expect.objectContaining({ model: "vendor/dead-instruct", status: "MODEL_UNAVAILABLE", httpStatus: 404, errorCode: "MODEL_UNAVAILABLE" }),
      expect.objectContaining({ model: "vendor/live-instruct", status: "PASS" })
    ]);
    expect(calls.some((call) => call.model === "nvidia/example-embedding")).toBe(false);
  });

  it("keeps exact operational failure metadata when no accessible chat model works", async () => {
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url.endsWith("/models")) return jsonResponse({ data: [{ id: "vendor/only-instruct" }] });
      return jsonResponse({ error: { code: "EOL", message: "This model is end-of-life" } }, 410);
    };

    const result = await runFixtureSmoke("test-key", { fetchImpl: fetchImpl as typeof fetch });

    expect(result.ok).toBe(false);
    expect(result.monetaryCostUsd).toBe(0);
    expect(result.attempts).toEqual([
      expect.objectContaining({
        model: "vendor/only-instruct",
        status: "MODEL_UNAVAILABLE",
        httpStatus: 410,
        errorCode: "EOL",
        failureReason: expect.stringContaining("end-of-life")
      })
    ]);
  });

  it("reports catalog authentication failures without inventing model capability", async () => {
    const fetchImpl = async (): Promise<Response> => jsonResponse({ error: { code: "INVALID_KEY", message: "unauthorized" } }, 401);
    const result = await runFixtureSmoke("bad-key", { fetchImpl: fetchImpl as typeof fetch });

    expect(result).toMatchObject({
      ok: false,
      catalogModelCount: 0,
      chatCandidateCount: 0,
      testedCandidates: 0,
      monetaryCostUsd: 0,
      catalogFailure: {
        status: "AUTH_ERROR",
        httpStatus: 401,
        errorCode: "INVALID_KEY"
      }
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function runFixtureSmoke(key: string, options: Parameters<typeof runNvidiaNimSmoke>[1]) { return runNvidiaNimSmoke(key, { economicEvidence: async model => fixtureZeroCost('nvidia-nim', model), maxCandidates: 3, ...options }); }
it('authenticated catalog cannot authorize NVIDIA inference without account cost evidence', async () => {
 const calls: string[]=[]; const fetchImpl=async (input: string | URL | Request) => { calls.push(String(input));return jsonResponse({data:[{id:'qwen/qwen2.5-coder-32b-instruct'}]}); };
 const result=await runNvidiaNimSmoke('test-only-key',{fetchImpl:fetchImpl as typeof fetch});expect(result.testedCandidates).toBe(0);expect(result.catalogFailure?.errorCode).toBe('ZERO_COST_EXECUTION_NOT_GUARANTEED');expect(calls).toHaveLength(1);expect(calls[0]).toMatch(/models$/);
});

it('contradictory billed usage is retained and stops NVIDIA candidate recovery', async()=>{
 const calls:string[]=[];const fetchImpl=async(input:string|URL|Request)=>{calls.push(String(input));return String(input).endsWith('/models')?jsonResponse({data:[{id:'vendor/a-instruct'},{id:'vendor/b-instruct'}]}):jsonResponse({choices:[{message:{content:NVIDIA_NIM_SMOKE_EXPECTED}}],usage:{cost:0.02}});};
 const result=await runFixtureSmoke('test-only-key',{fetchImpl:fetchImpl as typeof fetch});expect(result.ok).toBe(false);expect(result.monetaryCostUsd).toBe(0.02);expect(result.attempts[0]?.errorCode).toBe('ZERO_COST_EVIDENCE_CONTRADICTED');expect(calls).toHaveLength(2);
});
