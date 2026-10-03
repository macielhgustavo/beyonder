import { describe, expect, it } from "vitest";
import { BenchmarkStore } from "./store.js";

describe("benchmark persistence", () => {
  it("stores results and exposes model capability", () => {
    const store = new BenchmarkStore(":memory:");
    store.saveResults([
      {
        caseId: "coding-001",
        provider: "groq",
        model: "free",
        category: "coding",
        status: "PASS",
        quality: 1,
        success: true,
        latencyMs: 123,
        monetaryCost: 0,
        attempts: 1,
        timestamp: new Date("2026-10-03T00:00:00.000Z")
      }
    ]);
    expect(store.listResults()).toHaveLength(1);
    expect(store.getModelCapability({ provider: "groq", model: "free", category: "coding" })?.avgQuality).toBe(1);
    store.close();
  });

  it("returns null capability when only operational failures exist", () => {
    const store = new BenchmarkStore(":memory:");
    store.saveResults([
      {
        caseId: "coding-001",
        provider: "ovh",
        model: "gpt-oss",
        category: "coding",
        status: "RATE_LIMITED",
        quality: null,
        success: null,
        httpStatus: 429,
        failureReason: "HTTP 429",
        monetaryCost: 0,
        attempts: 1,
        timestamp: new Date("2026-10-03T00:00:00.000Z")
      }
    ]);
    expect(store.getModelCapability({ provider: "ovh", model: "gpt-oss", category: "coding" })).toBeNull();
    store.close();
  });
});
