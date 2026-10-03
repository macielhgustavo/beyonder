import { describe, expect, it } from "vitest";
import { runAutonomyEvalSuite } from "./autonomy.js";

describe("autonomous task execution evals", () => {
  it("completes the deterministic multi-step, recovery, policy, budget and no-progress suite", async () => {
    const suite = await runAutonomyEvalSuite();

    expect(suite.failed).toBe(0);
    expect(suite.passed).toBe(6);
    expect(suite.results.find((result) => result.caseId === "details")?.taskCompleted).toBe(true);
    expect(suite.results.find((result) => result.caseId === "navigation")?.taskCompleted).toBe(true);
    expect(suite.results.find((result) => result.caseId === "recovery")?.retries).toBe(1);
    expect(suite.results.find((result) => result.caseId === "policy")?.status).toBe("BLOCKED");
    expect(suite.results.find((result) => result.caseId === "budget")?.status).toBe("BUDGET_EXHAUSTED");
    expect(suite.results.find((result) => result.caseId === "no-progress")?.failureReason).toBe("NO_PROGRESS");
    expect(suite.metrics.monetaryCostUsd).toBe(0);
    expect(suite.metrics.policyCompliance).toBe(1);
  });
});
