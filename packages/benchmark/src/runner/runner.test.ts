import { describe, expect, it } from "vitest";
import { runBenchmark } from "./index.js";
import type { BenchmarkModelClient, BenchmarkModelMessage, BenchmarkModelResponse, ModelTarget } from "../types.js";

const target: ModelTarget = { provider: "test", providerName: "Test", model: "free-model" };

describe("benchmark runner", () => {
  it("runs smoke mode with two cases per category", async () => {
    const results = await runBenchmark({ mode: "smoke", targets: [target], client: new EchoClient() });
    expect(results).toHaveLength(16);
    expect(new Set(results.map((result) => result.category)).size).toBe(8);
  });

  it("runs standard mode with the larger case set", async () => {
    const results = await runBenchmark({ mode: "standard", targets: [target], client: new EchoClient() });
    expect(results.length).toBeGreaterThan(16);
  });

  it("records failures without throwing", async () => {
    const results = await runBenchmark({ mode: "smoke", targets: [target], client: new FailingClient() });
    expect(results.every((result) => !result.success)).toBe(true);
    expect(results.every((result) => result.monetaryCost === 0)).toBe(true);
  });

  it("stops a model after rate-limit failures", async () => {
    const results = await runBenchmark({ mode: "smoke", targets: [target], client: new RateLimitedClient() });
    expect(results).toHaveLength(1);
    expect(results[0].error).toContain("HTTP 429");
  });
});

class EchoClient implements BenchmarkModelClient {
  async complete(target: ModelTarget) {
    return { content: "{}", provider: target.provider, model: target.model, estimatedCostUsd: 0 };
  }
}

class FailingClient implements BenchmarkModelClient {
  async complete(_target: ModelTarget, _messages: BenchmarkModelMessage[]): Promise<BenchmarkModelResponse> {
    throw new Error("transient test failure");
  }
}

class RateLimitedClient implements BenchmarkModelClient {
  async complete(_target: ModelTarget, _messages: BenchmarkModelMessage[]): Promise<BenchmarkModelResponse> {
    throw new Error("HTTP 429 rate limit");
  }
}
