import type { BenchmarkModelClient, BenchmarkModelMessage, BenchmarkModelResponse, ModelTarget } from "../types.js";

const REQUEST_TIMEOUT_MS = 20_000;

export class OpenAiCompatibleBenchmarkClient implements BenchmarkModelClient {
  async complete(target: ModelTarget, messages: BenchmarkModelMessage[]): Promise<BenchmarkModelResponse> {
    if (!target.baseUrl) throw new BenchmarkRequestError(`Provider ${target.provider} has no OpenAI-compatible endpoint.`, {
      errorCode: "MISSING_ENDPOINT"
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${target.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: requestHeaders(target),
        signal: controller.signal,
        body: JSON.stringify({
          model: target.model,
          messages,
          temperature: 0,
          max_tokens: 256
        })
      });
      if (!response.ok) {
        throw new BenchmarkRequestError(`HTTP ${response.status} ${await response.text()}`, {
          httpStatus: response.status,
          errorCode: response.statusText || `HTTP_${response.status}`
        });
      }
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { total_tokens?: number; totalTokens?: number };
      };
      return {
        content: json.choices?.[0]?.message?.content ?? "",
        provider: target.provider,
        model: target.model,
        estimatedCostUsd: 0,
        tokens: json.usage?.total_tokens ?? json.usage?.totalTokens,
        raw: json
      };
    } catch (error) {
      if (error instanceof BenchmarkRequestError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new BenchmarkRequestError("Request timed out.", { errorCode: "TIMEOUT" });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export class BenchmarkRequestError extends Error {
  readonly httpStatus?: number;
  readonly errorCode?: string;

  constructor(message: string, details: { httpStatus?: number; errorCode?: string } = {}) {
    super(message);
    this.name = "BenchmarkRequestError";
    this.httpStatus = details.httpStatus;
    this.errorCode = details.errorCode;
  }
}

function requestHeaders(target: ModelTarget): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (target.apiKey) headers.authorization = `Bearer ${target.apiKey}`;
  return headers;
}
