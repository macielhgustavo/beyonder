import { getBenchmarkCases } from "../cases/index.js";
import { evaluateCase } from "../evaluators/index.js";
import type { BenchmarkMode, BenchmarkModelClient, BenchmarkResult, ModelTarget, TelemetrySink } from "../types.js";

export interface BenchmarkRunOptions {
  mode: BenchmarkMode;
  targets: ModelTarget[];
  client: BenchmarkModelClient;
  telemetry?: TelemetrySink;
  attempts?: number;
}

export async function runBenchmark(options: BenchmarkRunOptions): Promise<BenchmarkResult[]> {
  const attempts = options.attempts ?? 1;
  const cases = getBenchmarkCases(options.mode);
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
            content: "You are running inside a deterministic benchmark. Follow the user's requested output format exactly."
          },
          { role: "user", content: testCase.prompt }
        ]);
        const evaluation = evaluateCase(testCase, response.content);
        result = {
          caseId: testCase.id,
          provider: response.provider,
          model: response.model,
          category: testCase.category,
          quality: evaluation.quality,
          success: evaluation.success,
          latencyMs: Date.now() - started,
          monetaryCost: response.estimatedCostUsd,
          tokens: response.tokens,
          attempts,
          timestamp: new Date()
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stopModel = shouldStopModel(message);
        result = {
          caseId: testCase.id,
          provider: target.provider,
          model: target.model,
          category: testCase.category,
          quality: 0,
          success: false,
          latencyMs: Date.now() - started,
          monetaryCost: 0,
          attempts,
          error: message,
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

function shouldStopModel(error: string): boolean {
  return /\bHTTP (404|408|409|429|5\d\d)\b/.test(error) || error.toLowerCase().includes("rate limit");
}
