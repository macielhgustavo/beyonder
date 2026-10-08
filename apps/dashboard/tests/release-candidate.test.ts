import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, loadConfig } from "@beyonder/runtime";
import { AutopilotStateStore } from "@beyonder/compute";
import { LocalDashboardDataSource } from "../data/local";

let dir: string | undefined;
afterEach(() => { vi.unstubAllEnvs(); if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });
async function setup() {
  dir = mkdtempSync(join(tmpdir(), "control-rc-"));
  const dbPath = join(dir, "runtime.sqlite"), providerPath = join(dir, "providers.json");
  const runtime = createRuntime(loadConfig({ BEYONDER_DB_PATH: dbPath, BEYONDER_MODEL_PROVIDER: "none" }));
  await new AutopilotStateStore(providerPath).write({ version: 1, updatedAt: new Date().toISOString(), providers: { groq: { providerId: "groq", state: "READY", classification: "AUTO_WITH_HUMAN_GATE", attempts: 1, lastUpdatedAt: new Date().toISOString() } } });
  return { runtime, source: new LocalDashboardDataSource(dbPath, providerPath) };
}
describe("release candidate provider truth", () => {
  it("attributes a completed task to its last successful result producer, including deterministic fallback", async () => {
    const { runtime, source } = await setup();
    try {
      const now = new Date().toISOString();
      await runtime.state.set("control-center:tasks:index", ["exec-result-producer"]);
      await runtime.state.set("control-center:task:exec-result-producer", { id: "exec-result-producer", state: "COMPLETED", task: { id: "result-producer" }, plan: { objective: "Grounded result", steps: [] }, usage: {}, result: "verified", startedAt: now, completedAt: now, steps: [{ stepId: "read", status: "COMPLETED", toolCall: { tool: "browser.open" }, toolResult: { success: true, sideEffects: ["READ"] } }, { stepId: "respond", status: "COMPLETED" }] });
      await runtime.state.set("task-attempts:result-producer", [
        { phase: "DIRECT_RESPONSE", provider: "groq", model: "remote-model", status: "FAILED", failureClass: "RATE_LIMITED", monetaryCostUsd: 0, shadowCostUsd: 0 },
        { phase: "DIRECT_RESPONSE", provider: "ollama", model: "local-model", status: "FAILED", failureClass: "TIMEOUT", monetaryCostUsd: 0, shadowCostUsd: 0 },
        { phase: "DIRECT_RESPONSE", provider: "deterministic", model: "observed-evidence-format", status: "SUCCEEDED", monetaryCostUsd: 0, shadowCostUsd: 0 }
      ]);
      expect((await source.getTasks())[0]).toMatchObject({ status: "succeeded", provider: "deterministic", model: "observed-evidence-format", tool: "browser.open", result: "verified" });
    } finally { runtime.sqlite.close(); }
  });
  it("does not claim available quota or perfect health from READY alone", async () => {
    vi.stubEnv("GROQ_API_KEY", "fixture");
    const { runtime, source } = await setup();
    try {
      const provider = (await source.getProviders()).find((p) => p.id === "groq")!;
      expect(provider.health).toBeNull();
      expect(provider.latencyMs).toBeNull();
      expect(provider.runway).toMatchObject({ state: "UNKNOWN", label: "Quota atual não conhecida" });
      expect(provider.note).toContain("inferência ainda não verificada");
      expect(JSON.stringify(provider)).not.toContain("fixture");
    } finally { runtime.sqlite.close(); }
  });
  it("exposes missing process credentials after restart without reading raw vault data", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    const { runtime, source } = await setup();
    try {
      const provider = (await source.getProviders()).find((p) => p.id === "groq")!;
      expect(provider).toMatchObject({ configured: false, status: "HUMAN_GATE" });
      expect(provider.note).toContain("Credencial não está disponível");
    } finally { runtime.sqlite.close(); }
  });
  it("shows actual failure metrics and active provider cooldown", async () => {
    vi.stubEnv("GROQ_API_KEY", "fixture");
    const { runtime, source } = await setup();
    try {
      await runtime.modelRouter.recordAttempt({ id: "failure", taskId: "t", phase: "PLANNING", attempt: 1, provider: "groq", model: "m", status: "FAILED", failureClass: "RATE_LIMITED", responseBody: "daily quota exhausted", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), latencyMs: 32, monetaryCostUsd: 0, shadowCostUsd: 0 });
      const provider = (await source.getProviders()).find((p) => p.id === "groq")!;
      expect(provider).toMatchObject({ status: "RATE_LIMITED", health: 0, latencyMs: 32 });
      expect(provider.note).toContain("QUOTA_EXHAUSTED");
    } finally { runtime.sqlite.close(); }
  });
});
