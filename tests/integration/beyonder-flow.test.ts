import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createRuntime, loadConfig } from "@beyonder/runtime";
import { AutopilotStateStore, buildComputeInventory } from "@beyonder/compute";

describe("Beyonder milestone flow", () => {
  it("starts with zero simulated capital, selects free compute, runs a safe tool, records memory, and accounts cost", async () => {
    const dir = await mkdtemp(join(tmpdir(), "beyonder-flow-"));
    const providerStatePath = join(dir, "autopilot-state.json");
    const dbPath = join(dir, "beyonder.sqlite");
    const stateStore = new AutopilotStateStore(providerStatePath);
    await stateStore.write({ version: 1, updatedAt: new Date().toISOString(), providers: {} });

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

    const [result] = await runtime.agent.run(1, "Summarize readiness without side effects");
    const memories = await runtime.memoryStore.recent(20);
    const summary = await runtime.ledger.summary(0);

    expect(result.status).toBe("completed");
    expect(result.decision.expectedCostUsd).toBe(0);
    expect(result.decision.rationale).toContain("Selected zero-cost provider");
    expect(result.toolResult).toMatchObject({ ok: true });
    expect(memories.map((memory) => memory.kind)).toEqual(expect.arrayContaining(["working", "episodic", "economic", "procedural"]));
    expect(summary.expensesUsd).toBe(0);
    expect(summary.balanceUsd).toBe(0);

    runtime.sqlite.close();
  });
});
