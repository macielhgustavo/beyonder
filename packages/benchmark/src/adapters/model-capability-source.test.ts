import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { BenchmarkStore } from "../persistence/store.js";
import { BibModelCapabilitySource } from "./model-capability-source.js";

describe("BibModelCapabilitySource", () => {
  it.each(["structured-output", "verification", "coding"] as const)("preserves the observed prompted mode when routing %s", async category => {
    const store = new BenchmarkStore(":memory:");
    for (const current of new Set([category, "structured-output"] as const)) {
      store.saveResults([0, 1].map(index => ({ ...result(1, true), caseId: `${current}-${index}`, category: current, structuredOutputMode: "prompted" as const })));
    }
    const source = new BibModelCapabilitySource(store);
    const taskType = category === "coding" ? "coding" : "classification";
    expect(await source.getCapability({ provider: "kilo-gateway", model: "openrouter/free", taskType })).toMatchObject({ structuredOutputMode: "prompted", dimensions: { structuredOutput: { samples: 2 } } });
  });

  it("does not invent an observed request mode for legacy or mixed evidence", async () => {
    for (const modes of [[undefined, undefined], ["native", "prompted"]] as const) {
      const store = new BenchmarkStore(":memory:");
      store.saveResults(modes.map((mode, index) => ({ ...result(1, true), category: "structured-output" as const, caseId: `structured-${index}`, structuredOutputMode: mode })));
      const source = new BibModelCapabilitySource(store);
      expect((await source.getCapability({ provider: "kilo-gateway", model: "openrouter/free", taskType: "classification" }))?.structuredOutputMode).toBeUndefined();
    }
  });

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
    await expect(source.getOperationalEvidence({ provider: "ovh", model: "gpt-oss-120b" })).resolves.toMatchObject({ samples: 1, failures: 1 });
    await expect(source.getCapabilityScore({ provider: "ovh", model: "gpt-oss-120b", taskType: "research" })).resolves.toBeNull();
    store.close();
  });

  it("returns null when the BIB database is absent or empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "beyonder-bib-empty-"));
    const store = new BenchmarkStore(join(dir, "missing.sqlite"));
    const source = new BibModelCapabilitySource(store);
    await expect(source.getCapability({ provider: "none", model: "none", taskType: "coding" })).resolves.toBeNull();
    store.close();
  });

  it.each(["chat", "research", "browser"] as const)("uses observed %s capability and keeps independent verification failures", async taskType => {
    const store = new BenchmarkStore(":memory:");
    for (const category of ["synthesis", "research", "verification"] as const) {
      store.saveResults([0, 1].map(index => ({ ...result(category === "verification" ? 0 : 1, category !== "verification"), caseId: `${category}-${index}`, category })));
    }
    const source = new BibModelCapabilitySource(store);
    expect(await source.getCapability({ provider: "kilo-gateway", model: "openrouter/free", taskType, dimensions: ["verification"] })).toMatchObject({
      score: 0, dimensions: { verification: { score: 0, samples: 2 } }
    });
    expect((await source.getCapability({ provider: "kilo-gateway", model: "openrouter/free", taskType }))?.dimensions?.coding).toBeUndefined();
  });

  it("keeps a failed inference profile visible without using it to certify a different profile", async () => {
    const store = new BenchmarkStore(":memory:");
    store.saveResults([
      { ...result(0, false), inferenceProfile: "reasoning-disabled:max-output-1200" },
      { ...result(1, true), inferenceProfile: "reasoning-low:max-output-2400" }
    ]);
    const source = new BibModelCapabilitySource(store);
    expect(await source.getCapabilityScore({ provider: "kilo-gateway", model: "openrouter/free", taskType: "coding", inferenceProfile: "reasoning-low:max-output-2400" })).toBe(1);
    expect(await source.getCapabilityScore({ provider: "kilo-gateway", model: "openrouter/free", taskType: "coding", inferenceProfile: "reasoning-disabled:max-output-1200" })).toBe(0);
    expect(await source.getCapabilityScore({ provider: "kilo-gateway", model: "openrouter/free", taskType: "coding", inferenceProfile: "unmeasured" })).toBeNull();
  });

  it("does not promote a dimension by repeatedly passing the same easy case", async () => {
    const store = new BenchmarkStore(":memory:");
    store.saveResults([result(1, true), result(1, true), result(1, true)]);
    const source = new BibModelCapabilitySource(store);
    expect((await source.getCapability({ provider: "kilo-gateway", model: "openrouter/free", taskType: "coding" }))?.dimensions?.coding).toBeUndefined();
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
