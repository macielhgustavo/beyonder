import { getBenchmarkCases } from "../cases/index.js";
import { evaluateCase } from "../evaluators/index.js";
import { BenchmarkRequestError } from "../models/openai-compatible-client.js";
import type { BenchmarkCategory, BenchmarkExecutionStatus, BenchmarkMode, BenchmarkModelClient, BenchmarkResult, ModelTarget, TelemetrySink } from "../types.js";

export interface BenchmarkRunOptions {
  mode: BenchmarkMode;
  targets: ModelTarget[];
  client: BenchmarkModelClient;
  telemetry?: TelemetrySink;
  attempts?: number;
  categories?: BenchmarkCategory[];
}

export async function runBenchmark(options: BenchmarkRunOptions): Promise<BenchmarkResult[]> {
  const attempts = options.attempts ?? 1;
  const cases = getBenchmarkCases(options.mode).filter(testCase => !options.categories || options.categories.includes(testCase.category));
  const results: BenchmarkResult[] = [];
  await options.telemetry?.emit("benchmark.started", { mode: options.mode, models: options.targets.length, cases: cases.length });

  for (const target of options.targets) {
    for (const testCase of cases) {
      await options.telemetry?.emit("benchmark.case.started", { provider: target.provider, model: target.model, caseId: testCase.id });
      const started = Date.now();
      let result: BenchmarkResult;
      let stopModel = false;
      try {
        const response = await options.client.complete(target, [
          {
            role: "system",
            content: "You are running inside a deterministic benchmark. Follow the user's requested output format exactly. Keep the complete answer concise, under 200 words unless the user explicitly requires more."
          },
          { role: "user", content: testCase.prompt }
        ]);
        if (!Number.isFinite(response.estimatedCostUsd) || response.estimatedCostUsd < 0) throw new BenchmarkRequestError("Invalid monetary usage.", { errorCode: "INVALID_COST" });
        if (response.estimatedCostUsd > 0) throw new BenchmarkRequestError("Zero-money qualification received a charge.", { errorCode: "BILLING_REQUIRED", monetaryCostUsd: response.estimatedCostUsd });
        const evaluation = evaluateCase(testCase, response.content);
        result = {
          caseId: testCase.id,
          provider: response.provider,
          model: response.model,
          category: testCase.category,
          status: evaluation.success ? "PASS" : "FAIL",
          quality: evaluation.quality,
          success: evaluation.success,
          latencyMs: Date.now() - started,
          monetaryCost: response.estimatedCostUsd,
          structuredOutputMode: response.structuredOutputMode,
          tokens: response.tokens,
          attempts,
          inferenceProfile: `reasoning-${target.reasoning?.effort ?? (target.reasoning?.enabled === false ? "disabled" : "default")}:max-output-2400`,
          timestamp: new Date()
        };
      } catch (error) {
        const failure = classifyFailure(error);
        stopModel = shouldStopModel(failure.status);
        result = {
          caseId: testCase.id,
          provider: target.provider,
          model: target.model,
          category: testCase.category,
          status: failure.status,
          quality: null,
          success: null,
          latencyMs: Date.now() - started,
          monetaryCost: error instanceof BenchmarkRequestError ? error.monetaryCostUsd ?? 0 : 0,
          attempts,
          inferenceProfile: `reasoning-${target.reasoning?.effort ?? (target.reasoning?.enabled === false ? "disabled" : "default")}:max-output-2400`,
          httpStatus: failure.httpStatus,
          errorCode: failure.errorCode,
          failureReason: failure.failureReason,
          timestamp: new Date()
        };
      }
      results.push(result);
      await options.telemetry?.emit("benchmark.case.completed", { ...result, timestamp: result.timestamp.toISOString() });
      if (stopModel) break;
      if (target.rateLimitDelayMs) await sleep(target.rateLimitDelayMs);
    }
    await options.telemetry?.emit("benchmark.model.completed", { provider: target.provider, model: target.model });
  }

  await options.telemetry?.emit("benchmark.completed", { results: results.length });
  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldStopModel(status: BenchmarkExecutionStatus): boolean {
  // A single response exhausting its budget is not a provider outage. Preserve
  // the operational observation, then still measure unrelated capabilities.
  return !["PASS", "FAIL", "OUTPUT_LIMIT"].includes(status);
}

function classifyFailure(error: unknown): {
  status: BenchmarkExecutionStatus;
  httpStatus?: number;
  errorCode?: string;
  failureReason: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const httpStatus = error instanceof BenchmarkRequestError ? error.httpStatus : extractHttpStatus(message);
  const errorCode = error instanceof BenchmarkRequestError ? error.errorCode : undefined;
  if (errorCode === "OUTPUT_LIMIT") return { status: "OUTPUT_LIMIT", errorCode, failureReason: message };
  if (errorCode === "BILLING_REQUIRED") return { status: "BILLING_REQUIRED", errorCode, failureReason: message };

  if (httpStatus === 429) return { status: "RATE_LIMITED", httpStatus, errorCode, failureReason: message };
  if (httpStatus === 401 || httpStatus === 403) return { status: "AUTH_ERROR", httpStatus, errorCode, failureReason: message };
  if (httpStatus === 402) {
    return {
      status: /quota|credit|depleted|exhaust/i.test(message) ? "QUOTA_EXHAUSTED" : "BILLING_REQUIRED",
      httpStatus,
      errorCode,
      failureReason: message
    };
  }
  if (httpStatus === 404) {
    return {
      status: /model|does not exist|not found/i.test(message) ? "MODEL_UNAVAILABLE" : "INVALID_ENDPOINT",
      httpStatus,
      errorCode,
      failureReason: message
    };
  }
  if (httpStatus === 400 && /model|unsupported|messages|chat|completion|template/i.test(message)) {
    return { status: "UNSUPPORTED", httpStatus, errorCode, failureReason: message };
  }
  if (httpStatus && httpStatus >= 500) return { status: "PROVIDER_ERROR", httpStatus, errorCode, failureReason: message };
  if (httpStatus === 408 || errorCode === "TIMEOUT" || /timed?\s*out|abort/i.test(message)) {
    return { status: "TIMEOUT", httpStatus, errorCode: errorCode ?? "TIMEOUT", failureReason: message };
  }
  if (/unavailable|missing endpoint|not available/i.test(message)) {
    return { status: "UNAVAILABLE", httpStatus, errorCode, failureReason: message };
  }
  return { status: "PROVIDER_ERROR", httpStatus, errorCode, failureReason: message };
}

function extractHttpStatus(message: string): number | undefined {
  const match = /\bHTTP\s+(\d{3})\b/.exec(message);
  return match ? Number(match[1]) : undefined;
}
