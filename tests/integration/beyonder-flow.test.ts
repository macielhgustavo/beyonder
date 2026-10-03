import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createRuntime, loadConfig } from "@beyonder/runtime";
import { AutopilotStateStore, buildComputeInventory } from "@beyonder/compute";

describe("Beyonder adaptive intelligence flow", () => {
  it("retrieves memory, ranks multiple candidates, executes safely, evaluates, persists outcome, and updates performance at zero monetary cost", async () => {
    const dir = await mkdtemp(join(tmpdir(), "beyonder-flow-"));
    const providerStatePath = join(dir, "autopilot-state.json");
    const dbPath = join(dir, "beyonder.sqlite");
    const stateStore = new AutopilotStateStore(providerStatePath);
    const now = new Date().toISOString();
    await stateStore.write({
      version: 1,
      updatedAt: now,
      providers: {
        groq: {
          providerId: "groq",
          state: "READY",
          classification: "AUTO_WITH_HUMAN_GATE",
          attempts: 1,
          lastUpdatedAt: now,
          validation: {
            status: "validated",
            models: ["groq-e2e-model"],
            latencyMs: 80,
            rateLimitHeaders: {
              "x-ratelimit-limit-requests": "1000",
              "x-ratelimit-remaining-requests": "700"
            }
          }
        },
        ovh: {
          providerId: "ovh",
          state: "READY",
          classification: "AUTO_WITH_HUMAN_GATE",
          attempts: 1,
          lastUpdatedAt: now,
          validation: {
            status: "validated",
            models: ["ovh-e2e-model"],
            latencyMs: 140,
            rateLimitHeaders: {
              "x-ratelimit-limit-requests": "1000",
              "x-ratelimit-remaining-requests": "850"
            }
          }
        },
        "ai-horde": {
          providerId: "ai-horde",
          state: "READY",
          classification: "KEYLESS",
          attempts: 1,
          lastUpdatedAt: now,
          validation: { status: "validated", models: ["horde-e2e-model"], latencyMs: 500 }
        }
      }
    });

    const inventory = buildComputeInventory(await stateStore.read());
    expect(inventory.some((entry) => entry.status === "keyless" && entry.cost === "$0")).toBe(true);

    const config = loadConfig({
      BEYONDER_DB_PATH: dbPath,
      BEYONDER_USE_SIMULATED_CAPITAL: "true",
      BEYONDER_SIMULATED_CAPITAL_USD: "0",
      BEYONDER_MODEL_PROVIDER: "auto",
      BEYONDER_PROVIDER_STATE_PATH: providerStatePath,
      BEYONDER_TOOLS_ENABLED: "false"
    });
    const runtime = createRuntime(config);

    const seed = await runtime.memory.remember("semantic", "Readiness checks should avoid side effects and preserve scarce quota.", 4, {
      utility: 0.9,
      metadata: { taskType: "compression" }
    });

    const inspection = await runtime.intelligence.inspect("Summarize readiness without side effects");
    expect(inspection.task.type).toBe("compression");
    expect(inspection.relevantMemories.some((memory) => memory.id === seed.id)).toBe(true);

    const dryRoute = await runtime.modelRouter.route(inspection.task, "survival");
    expect(dryRoute.candidates.length).toBeGreaterThanOrEqual(3);
    expect(dryRoute.selected).toBeDefined();
    expect(dryRoute.selected?.monetaryCostUsd).toBe(0);
    expect(dryRoute.selected?.explanation.positives.length).toBeGreaterThan(0);

    const [result] = await runtime.agent.run(1, "Summarize readiness without side effects");
    const memories = await runtime.memoryStore.recent(30);
    const seedAfter = await runtime.memoryStore.get(seed.id);
    const summary = await runtime.ledger.summary(0);
    const economicMemory = memories.find((memory) => memory.kind === "economic" && memory.metadata.taskType === "compression");
    const provider = String(economicMemory?.metadata.provider ?? "none");
    const model = String(economicMemory?.metadata.model ?? "none");
    const performance = await runtime.performance.get(provider, model, "compression");

    expect(result.status).toBe("completed");
    expect(result.decision.expectedCostUsd).toBe(0);
    expect(result.decision.rationale).toContain("Selected zero-cost provider");
    expect(result.toolResult).toMatchObject({ ok: true });
    expect(memories.map((memory) => memory.kind)).toEqual(expect.arrayContaining(["episodic", "economic", "semantic"]));
    expect(economicMemory?.metadata).toMatchObject({ taskType: "compression", monetaryCostUsd: 0, success: true });
    expect(Number(economicMemory?.metadata.shadowCostUsd)).toBeGreaterThan(0);
    expect(performance.samples).toBeGreaterThanOrEqual(1);
    expect(performance.avgMonetaryCostUsd).toBe(0);
    expect(seedAfter?.accessCount).toBeGreaterThan(0);
    expect(summary.expensesUsd).toBe(0);
    expect(summary.balanceUsd).toBe(0);

    runtime.sqlite.close();
  });
});
