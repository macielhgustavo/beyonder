import { describe, it, expect } from "vitest";
import { openDatabase } from "../../db/client.js";
import { BudgetAccountant } from "../../economy/budget-accountant.js";
import { resolveComputeEconomy } from "../../economy/compute-economy-config.js";
import { usdToMicros } from "../../economy/money.js";
import { BudgetBackedResourceAuthority } from "./budget-authority.js";
import { UnboundedLocalResourceAuthority } from "./resource-authority.js";
import type { ResourceRequest } from "./resource-authority.js";

function makeAccountant(mode: "zero_cost" | "bounded" = "bounded"): BudgetAccountant {
  const sqlite = openDatabase(":memory:").sqlite;
  const config = resolveComputeEconomy({
    mode,
    monthlyHardCapUsd: 10.0,
    dailyHardCapUsd: 1.0,
    defaultObjectiveHardCapUsd: 0.50
  });
  return new BudgetAccountant(sqlite, config);
}

function moneyRequest(estimatedUsd?: number): ResourceRequest {
  return {
    missionId: "mission-1",
    nodeId: "node-exec",
    kind: "MONEY",
    estimatedAmount: estimatedUsd
  };
}

describe("BudgetBackedResourceAuthority (v0.6 economy → v0.7 kernel)", () => {
  it("authorizes zero-cost requests without consulting the budget", async () => {
    const authority = new BudgetBackedResourceAuthority(makeAccountant("zero_cost"));
    const decision = await authority.authorize(moneyRequest(0));
    expect(decision.status).toBe("AUTHORIZED");
  });

  it("denies any positive-cost request when economy mode is zero_cost", async () => {
    const authority = new BudgetBackedResourceAuthority(makeAccountant("zero_cost"));
    const decision = await authority.authorize(moneyRequest(0.01));
    expect(decision.status).toBe("DENIED");
  });

  it("authorizes an affordable worst-case in bounded mode", async () => {
    const authority = new BudgetBackedResourceAuthority(makeAccountant("bounded"));
    const decision = await authority.authorize(moneyRequest(0.10));
    expect(decision.status).toBe("AUTHORIZED");
  });

  it("denies when worst-case exceeds the objective hard cap", async () => {
    const authority = new BudgetBackedResourceAuthority(makeAccountant("bounded"));
    const decision = await authority.authorize(moneyRequest(5.0));
    expect(decision.status).toBe("DENIED");
    if (decision.status === "DENIED") {
      expect(decision.reason).toContain("node-exec");
    }
  });

  it("denies when the objective budget is already exhausted", async () => {
    const accountant = makeAccountant("bounded");
    // Exhaust the objective budget ($0.50 hard cap).
    const reserved = accountant.reserve({
      objectiveId: "mission-1",
      provider: "openrouter",
      model: "anthropic/claude-3.5-sonnet",
      estimatedInputTokens: 1000,
      maxOutputTokens: 1000,
      worstCaseMicros: usdToMicros(0.50),
      idempotencyKey: "exhaust-objective-1"
    });
    expect(reserved).not.toBeNull();

    const authority = new BudgetBackedResourceAuthority(accountant);
    const decision = await authority.authorize(moneyRequest(0.01));
    expect(decision.status).toBe("DENIED");
  });

  it("delegates non-MONEY kinds to the fallback authority", async () => {
    const fallback = new UnboundedLocalResourceAuthority();
    const authority = new BudgetBackedResourceAuthority(makeAccountant("zero_cost"), { fallback });
    const decision = await authority.authorize({
      missionId: "mission-1",
      nodeId: "node-exec",
      kind: "COMPUTE"
    });
    expect(decision.status).toBe("AUTHORIZED");
  });

  it("treats an absent estimate as zero cost (authorized, never billed blindly)", async () => {
    const authority = new BudgetBackedResourceAuthority(makeAccountant("zero_cost"));
    const decision = await authority.authorize(moneyRequest());
    expect(decision.status).toBe("AUTHORIZED");
  });
});
