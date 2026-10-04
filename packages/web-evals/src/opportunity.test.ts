import { afterEach, describe, expect, it, vi } from "vitest";
import { runOpportunityEvalSuite } from "./opportunity.js";

afterEach(() => vi.unstubAllGlobals());

describe("opportunity engine evals", () => {
  it("discovers, evaluates, queues and completes simulated revenue work", async () => {
    // Unit/economic assertions must not depend on public marketplace uptime or
    // a shared CI IP's GitHub quota. The separate CLI smokes retain real reads.
    const fetchFixture = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === "api.github.com") return Response.json([]);
      if (url.hostname === "agentwork.app") return new Response("unavailable", { status: 500 });
      if (url.hostname === "www.openbounty.app") return Response.json({ data: [] });
      throw new Error(`Unexpected fixture network request: ${url.hostname}`);
    });
    vi.stubGlobal("fetch", fetchFixture);
    const result = await runOpportunityEvalSuite();
    expect(fetchFixture).toHaveBeenCalledTimes(3);
    expect(result.results.find((item) => item.caseId === "agentwork-read-only")?.notes).toContain("HTTP 500");
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
