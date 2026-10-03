import { describe, expect, it } from "vitest";
import { runOpportunityEvalSuite } from "./opportunity.js";

describe("opportunity engine evals", () => {
  it("discovers, evaluates, queues and completes simulated revenue work", async () => {
    const result = await runOpportunityEvalSuite();
    expect(result.discovered).toBe(3);
    expect(result.queued).toBe(2);
    expect(result.results.every((item) => item.status === "PASS")).toBe(true);
    expect(result.taskStatus).toBe("COMPLETED");
    expect(result.result).toContain("Atlas");
    expect(result.simulatedRevenueUsd).toBe(3);
    expect(result.realizedRevenueUsd).toBe(0);
    expect(result.monetaryCostUsd).toBe(0);
  });
});
