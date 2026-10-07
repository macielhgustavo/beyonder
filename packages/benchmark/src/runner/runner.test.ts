import { describe, expect, it } from "vitest";
import { BenchmarkRequestError } from "../models/openai-compatible-client.js";
import { runBenchmark } from "./index.js";
import type { BenchmarkModelClient, BenchmarkModelMessage, BenchmarkModelResponse, ModelTarget } from "../types.js";

const target: ModelTarget = { provider: "test", providerName: "Test", model: "free-model" };

describe("benchmark runner", () => {
  it.each([0.01, 0.25, 1.2])("preserves unexpected cost %s without a semantic grade or further requests", async cost => {
    let calls = 0;
    const results = await runBenchmark({ mode: "smoke", targets: [target], client: { async complete() { calls++; return { provider: target.provider, model: target.model, content: "115", estimatedCostUsd: cost }; } } });
    expect(calls).toBe(1);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: "BILLING_REQUIRED", quality: null, success: null, monetaryCost: cost });
  });
  it("runs smoke mode with two cases per category and adversarial code/verification", async () => {
    const results = await runBenchmark({ mode: "smoke", targets: [target], client: new EchoClient() });
    expect(results).toHaveLength(36);
    expect(new Set(results.map((result) => result.category)).size).toBe(12);
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
    const reasoning = results.find(result => result.caseId === "reasoning-001")!;
    expect(reasoning.status).toBe("PASS");
    expect(reasoning.quality).toBe(1);
    expect(reasoning.success).toBe(true);
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

  it("does not confuse a response output limit with a model-wide outage", async () => {
    let calls = 0;
    const results = await runBenchmark({ mode: "smoke", targets: [target], client: {
      async complete(target) {
        if (++calls === 1) throw new BenchmarkRequestError("Budget exhausted", { errorCode: "OUTPUT_LIMIT" });
        return { provider: target.provider, model: target.model, content: "READY", estimatedCostUsd: 0 };
      }
    } });
    expect(results).toHaveLength(36);
    expect(results[0]).toMatchObject({ status: "OUTPUT_LIMIT", quality: null, success: null });
    expect(results.at(-1)?.status).toBe("PASS");
  });

  it("maps HTTP 404 model failures to MODEL_UNAVAILABLE", async () => {
    const results = await runBenchmark({ mode: "smoke", targets: [target], client: new HttpErrorClient(404, "HTTP 404 model not found") });
    expect(results[0].status).toBe("MODEL_UNAVAILABLE");
    expect(results[0].quality).toBeNull();
  });

  it("maps HTTP 404 endpoint failures to INVALID_ENDPOINT", async () => {
    const results = await runBenchmark({ mode: "smoke", targets: [target], client: new HttpErrorClient(404, "HTTP 404 endpoint missing") });
    expect(results[0].status).toBe("INVALID_ENDPOINT");
    expect(results[0].quality).toBeNull();
  });

  it("maps auth, quota, and billing failures without capability scoring", async () => {
    const auth = await runBenchmark({ mode: "smoke", targets: [target], client: new HttpErrorClient(401) });
    const quota = await runBenchmark({ mode: "smoke", targets: [target], client: new HttpErrorClient(402, "HTTP 402 credits depleted") });
    const billing = await runBenchmark({ mode: "smoke", targets: [target], client: new HttpErrorClient(402, "HTTP 402 payment required") });
    expect(auth[0].status).toBe("AUTH_ERROR");
    expect(quota[0].status).toBe("QUOTA_EXHAUSTED");
    expect(billing[0].status).toBe("BILLING_REQUIRED");
    expect([auth[0], quota[0], billing[0]].every((result) => result.quality === null && result.success === null)).toBe(true);
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
  constructor(private readonly status: number, private readonly message = `HTTP ${status}`) {}

  async complete(_target: ModelTarget, _messages: BenchmarkModelMessage[]): Promise<BenchmarkModelResponse> {
    throw new BenchmarkRequestError(this.message, { httpStatus: this.status });
  }
}

class TimeoutClient implements BenchmarkModelClient {
  async complete(_target: ModelTarget, _messages: BenchmarkModelMessage[]): Promise<BenchmarkModelResponse> {
    throw new BenchmarkRequestError("Request timed out.", { errorCode: "TIMEOUT" });
  }
}
