import type { BenchmarkModelClient, BenchmarkModelMessage, BenchmarkModelResponse, ModelTarget } from "../types.js";
import { providerFetch as fetch } from "@beyonder/compute";

const REQUEST_TIMEOUT_MS = 20_000;

export class OpenAiCompatibleBenchmarkClient implements BenchmarkModelClient {
  async complete(target: ModelTarget, messages: BenchmarkModelMessage[]): Promise<BenchmarkModelResponse> {
    if (!target.baseUrl) throw new BenchmarkRequestError(`Provider ${target.provider} has no OpenAI-compatible endpoint.`, {
      errorCode: "MISSING_ENDPOINT"
    });
    if (target.provider === "cloudflare-workers-ai") return completeCloudflareWorkersAi(target, messages);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), target.reasoning ? 45_000 : REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${target.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: requestHeaders(target),
        signal: controller.signal,
        body: JSON.stringify({
          model: target.model,
          messages,
          temperature: 0,
          max_tokens: 2400,
          ...(target.reasoning ? { reasoning: target.reasoning } : {})
        })
      });
      if (!response.ok) {
        throw new BenchmarkRequestError(`HTTP ${response.status}`, {
          httpStatus: response.status,
          errorCode: `HTTP_${response.status}`
        });
      }
      const json = (await response.json()) as {
        choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
        usage?: { total_tokens?: number; totalTokens?: number; cost?: number };
        error?: unknown;
        model?: unknown;
      };
      const cost = freeResponseCost(json.usage?.cost);
      if (json.error || typeof json.choices?.[0]?.message?.content !== "string" || !json.choices[0].message.content.trim()) throw new BenchmarkRequestError("Provider returned an invalid completion envelope.", { errorCode: "INVALID_OUTPUT", monetaryCostUsd: cost });
      if (typeof json.model !== "string" || !json.model || physicalIdentity(json.model) !== physicalIdentity(target.model)) throw new BenchmarkRequestError("Provider did not report the requested physical model; its capability cannot be attributed.", { errorCode: "INVALID_OUTPUT", monetaryCostUsd: cost });
      if (json.choices?.[0]?.finish_reason === "length") throw new BenchmarkRequestError("Completion exhausted its output budget before finishing.", { errorCode: "OUTPUT_LIMIT", monetaryCostUsd: cost });
      return {
        content: json.choices?.[0]?.message?.content ?? "",
        provider: target.provider,
        model: target.model,
        estimatedCostUsd: cost,
        structuredOutputMode: "prompted",
        tokens: json.usage?.total_tokens ?? json.usage?.totalTokens,
        raw: json
      };
    } catch (error) {
      if (error instanceof BenchmarkRequestError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new BenchmarkRequestError("Request timed out.", { errorCode: "TIMEOUT" });
      }
      throw new BenchmarkRequestError("Provider network request failed.", { errorCode: "NETWORK" });
    } finally {
      clearTimeout(timer);
    }
  }
}

async function completeCloudflareWorkersAi(
  target: ModelTarget,
  messages: BenchmarkModelMessage[]
): Promise<BenchmarkModelResponse> {
  const accountMatch = /\/accounts\/([^/]+)\/ai\/v1/.exec(target.baseUrl ?? "");
  const accountId = target.accountId ?? accountMatch?.[1];
  if (!accountId) throw new BenchmarkRequestError("Cloudflare Workers AI target is missing account id.", {
    errorCode: "MISSING_ACCOUNT_ID"
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${target.model}`, {
      method: "POST",
      headers: requestHeaders(target),
      signal: controller.signal,
      body: JSON.stringify({ messages, temperature: 0, max_tokens: 256 })
    });
    if (!response.ok) {
      throw new BenchmarkRequestError(`HTTP ${response.status}`, {
        httpStatus: response.status,
        errorCode: `HTTP_${response.status}`
      });
    }
    const json = (await response.json()) as {
      result?: {
        choices?: Array<{ message?: { content?: string } }>;
        response?: string;
        usage?: { total_tokens?: number; totalTokens?: number; cost?: number };
      };
    };
    return {
      content: json.result?.choices?.[0]?.message?.content ?? json.result?.response ?? "",
      provider: target.provider,
      model: target.model,
      estimatedCostUsd: freeResponseCost(json.result?.usage?.cost),
      structuredOutputMode: "prompted",
      tokens: json.result?.usage?.total_tokens ?? json.result?.usage?.totalTokens,
      raw: json
    };
  } catch (error) {
    if (error instanceof BenchmarkRequestError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new BenchmarkRequestError("Request timed out.", { errorCode: "TIMEOUT" });
    }
    throw new BenchmarkRequestError("Provider network request failed.", { errorCode: "NETWORK" });
  } finally {
    clearTimeout(timer);
  }
}

export class BenchmarkRequestError extends Error {
  readonly httpStatus?: number;
  readonly errorCode?: string;
  readonly monetaryCostUsd?: number;

  constructor(message: string, details: { httpStatus?: number; errorCode?: string; monetaryCostUsd?: number } = {}) {
    super(message);
    this.name = "BenchmarkRequestError";
    this.httpStatus = details.httpStatus;
    this.errorCode = details.errorCode;
    this.monetaryCostUsd = details.monetaryCostUsd;
  }
}

function freeResponseCost(reported: unknown): number {
  if (reported === undefined) return 0; // Targets are selected from explicit free catalog entries.
  if (typeof reported !== "number" || !Number.isFinite(reported) || reported < 0) throw new BenchmarkRequestError("Provider returned invalid monetary usage.", { errorCode: "INVALID_COST" });
  if (reported > 0) throw new BenchmarkRequestError("Provider reported a charge; stop zero-money qualification.", { errorCode: "BILLING_REQUIRED", monetaryCostUsd: reported });
  return reported;
}

function physicalIdentity(model: string): string {
  return model.split("/").at(-1)!.replace(/:free$/i, "").replace(/^meta-/i, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function requestHeaders(target: ModelTarget): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (target.apiKey) headers.authorization = `Bearer ${target.apiKey}`;
  return headers;
}
