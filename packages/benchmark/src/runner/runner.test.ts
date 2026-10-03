import { describe, expect, it } from "vitest";
import { BenchmarkRequestError } from "../models/openai-compatible-client.js";
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
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("PROVIDER_ERROR");
    expect(results[0].quality).toBeNull();
    expect(results[0].success).toBeNull();
    expect(results.every((result) => result.monetaryCost === 0)).toBe(true);
  });

  it("records PASS when a response is evaluated successfully", async () => {
    const results = await runBenchmark({ mode: "smoke", targets: [target], client: new FixedClient("115") });
    expect(results[0].status).toBe("PASS");
    expect(results[0].quality).toBe(1);
    expect(results[0].success).toBe(true);
  });

  it("records FAIL when a response is evaluated and wrong", async () => {
    const results = await runBenchmark({ mode: "smoke", targets: [target], client: new FixedClient("not the answer") });
    expect(results[0].status).toBe("FAIL");
    expect(results[0].quality).toBe(0);
    expect(results[0].success).toBe(false);
  });

  it("maps HTTP 429 to RATE_LIMITED and stops the model", async () => {
    const results = await runBenchmark({ mode: "smoke", targets: [target], client: new RateLimitedClient() });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("RATE_LIMITED");
    expect(results[0].httpStatus).toBe(429);
    expect(results[0].quality).toBeNull();
  });

  it("maps HTTP 404 to INVALID_ENDPOINT", async () => {
    const results = await runBenchmark({ mode: "smoke", targets: [target], client: new HttpErrorClient(404) });
    expect(results[0].status).toBe("INVALID_ENDPOINT");
    expect(results[0].quality).toBeNull();
  });

  it("maps HTTP 500 to PROVIDER_ERROR", async () => {
    const results = await runBenchmark({ mode: "smoke", targets: [target], client: new HttpErrorClient(500) });
    expect(results[0].status).toBe("PROVIDER_ERROR");
    expect(results[0].quality).toBeNull();
  });

  it("maps timeout failures to TIMEOUT", async () => {
    const results = await runBenchmark({ mode: "smoke", targets: [target], client: new TimeoutClient() });
    expect(results[0].status).toBe("TIMEOUT");
    expect(results[0].quality).toBeNull();
  });
});

class FixedClient implements BenchmarkModelClient {
  constructor(private readonly content: string) {}

  async complete(target: ModelTarget) {
    return { content: this.content, provider: target.provider, model: target.model, estimatedCostUsd: 0 };
  }
}

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
    throw new BenchmarkRequestError("HTTP 429 rate limit", { httpStatus: 429, errorCode: "Too Many Requests" });
  }
}

class HttpErrorClient implements BenchmarkModelClient {
  constructor(private readonly status: number) {}

  async complete(_target: ModelTarget, _messages: BenchmarkModelMessage[]): Promise<BenchmarkModelResponse> {
    throw new BenchmarkRequestError(`HTTP ${this.status}`, { httpStatus: this.status });
  }
}

class TimeoutClient implements BenchmarkModelClient {
  async complete(_target: ModelTarget, _messages: BenchmarkModelMessage[]): Promise<BenchmarkModelResponse> {
    throw new BenchmarkRequestError("Request timed out.", { errorCode: "TIMEOUT" });
  }
}
