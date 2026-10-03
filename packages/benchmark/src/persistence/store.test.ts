import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { BenchmarkStore } from "./store.js";

describe("benchmark persistence", () => {
  it("stores results and exposes model capability", () => {
    const store = new BenchmarkStore(":memory:");
    store.saveResults([
      benchmarkResult()
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

  it("closes idempotently without losing persisted benchmark results", async () => {
    const dir = await mkdtemp(join(tmpdir(), "beyonder-bib-store-"));
    const dbPath = join(dir, "benchmark.sqlite");
    const store = new BenchmarkStore(dbPath);
    store.saveResults([benchmarkResult()]);
    store.close();
    expect(() => store.close()).not.toThrow();

    const reopened = new BenchmarkStore(dbPath);
    expect(reopened.listResults()).toHaveLength(1);
    expect(reopened.listResults()[0]?.quality).toBe(1);
    reopened.close();
    expect(() => reopened.close()).not.toThrow();
  });

  it("exits a child process cleanly after open, use, and repeated close", () => {
    const storeUrl = pathToFileURL(join(process.cwd(), "packages/benchmark/src/persistence/store.ts")).href;
    const script = `
      import { BenchmarkStore } from ${JSON.stringify(storeUrl)};
      const store = new BenchmarkStore(":memory:");
      store.saveResults([{
        caseId: "coding-001",
        provider: "regression",
        model: "clean-exit",
        category: "coding",
        status: "PASS",
        quality: 1,
        success: true,
        latencyMs: 1,
        monetaryCost: 0,
        attempts: 1,
        timestamp: new Date("2026-10-03T00:00:00.000Z")
      }]);
      if (store.listResults().length !== 1) process.exit(2);
      store.close();
      store.close();
    `;
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    expect(child.signal, child.stderr).toBeNull();
    expect(child.status, child.stderr).toBe(0);
  });
});

function benchmarkResult() {
  return {
    caseId: "coding-001",
    provider: "groq",
    model: "free",
    category: "coding" as const,
    status: "PASS" as const,
    quality: 1,
    success: true,
    latencyMs: 123,
    monetaryCost: 0,
    attempts: 1,
    timestamp: new Date("2026-10-03T00:00:00.000Z")
  };
}
