import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { BenchmarkStore } from "../persistence/store.js";
import { BibModelCapabilitySource } from "./model-capability-source.js";

describe("BibModelCapabilitySource", () => {
  it("returns BIB evidence for evaluated PASS/FAIL samples", async () => {
    const store = new BenchmarkStore(":memory:");
    store.saveResults([
      result(1, true),
      result(0, false)
    ]);
    const source = new BibModelCapabilitySource(store);
    await expect(source.getCapability({ provider: "kilo-gateway", model: "openrouter/free", taskType: "coding" })).resolves.toMatchObject({
      score: 0.5,
      samples: 2,
      source: "BIB"
    });
    store.close();
  });

  it("returns null when benchmark rows are only operational failures", async () => {
    const store = new BenchmarkStore(":memory:");
    store.saveResults([
      {
        caseId: "coding-001",
        provider: "ovh",
        model: "gpt-oss-120b",
        category: "coding",
        status: "RATE_LIMITED",
        quality: null,
        success: null,
        monetaryCost: 0,
        attempts: 1,
        httpStatus: 429,
        timestamp: new Date()
      }
    ]);
    const source = new BibModelCapabilitySource(store);
    await expect(source.getCapabilityScore({ provider: "ovh", model: "gpt-oss-120b", taskType: "coding" })).resolves.toBeNull();
    store.close();
  });

  it("returns null when the BIB database is absent or empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "beyonder-bib-empty-"));
    const store = new BenchmarkStore(join(dir, "missing.sqlite"));
    const source = new BibModelCapabilitySource(store);
    await expect(source.getCapability({ provider: "none", model: "none", taskType: "coding" })).resolves.toBeNull();
    store.close();
  });
});

function result(quality: number, success: boolean) {
  return {
    caseId: "coding-001",
    provider: "kilo-gateway",
    model: "openrouter/free",
    category: "coding" as const,
    status: success ? "PASS" as const : "FAIL" as const,
    quality,
    success,
    latencyMs: 100,
    monetaryCost: 0,
    attempts: 1,
    timestamp: new Date()
  };
}
