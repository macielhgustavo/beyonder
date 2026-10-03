import { describe, expect, it } from "vitest";
import { normalizeOpportunity } from "./normalizer.js";
import { OpportunityEvaluator, OpportunityQueue } from "./evaluator.js";
import { StateOpportunityStore } from "./store.js";
import { openDatabase } from "../db/client.js";
import { StateStore } from "../memory/state-store.js";

const opportunity = (overrides: Record<string, unknown> = {}) => normalizeOpportunity({
  source: "fixture",
  sourceItemId: "good",
  title: "Extract public project details",
  description: "Read a public page and return structured information.",
  type: "RESEARCH",
  reward: { type: "FIXED", amount: 10, currency: "USD" },
  requiredCapabilities: ["browser.read", "structured extraction"],
  ...overrides
}, "2026-10-03T00:00:00.000Z");

describe("opportunity evaluator", () => {
  it("queues a feasible zero-cost opportunity", async () => {
    const evaluation = await new OpportunityEvaluator({ economicState: "survival", now: () => new Date("2026-10-03T01:00:00.000Z") }).evaluate(opportunity());
    expect(evaluation.feasibility).toBe("FEASIBLE");
    expect(evaluation.decision).toBe("QUEUE");
    expect(evaluation.estimatedMonetaryCostUsd).toBe(0);
  });

  it("rejects impossible capabilities", async () => {
    const evaluation = await new OpportunityEvaluator().evaluate(opportunity({ requiredCapabilities: ["physical delivery"] }));
    expect(evaluation.feasibility).toBe("NOT_FEASIBLE");
    expect(evaluation.decision).toBe("IGNORE");
  });

  it("requires approval for payment and identity actions", async () => {
    const item = opportunity({ metadata: { requiresPayment: true, requiresIdentityVerification: true } });
    const evaluation = await new OpportunityEvaluator().evaluate(item);
    expect(evaluation.decision).toBe("REQUIRES_APPROVAL");
  });

  it("does not invent an unknown reward and expires old opportunities", async () => {
    const unknown = await new OpportunityEvaluator().evaluate(opportunity({ reward: undefined }));
    expect(unknown.estimatedRewardUsd).toBeUndefined();
    expect(unknown.decision).toBe("REQUIRES_APPROVAL");
    const expired = await new OpportunityEvaluator({ now: () => new Date("2026-10-03T01:00:00.000Z") }).evaluate(opportunity({ deadline: "2026-10-02T00:00:00.000Z" }));
    expect(expired.decision).toBe("IGNORE");
    expect(expired.feasibility).toBe("NOT_FEASIBLE");
  });

  it("persists decisions and dequeues by expected net value", async () => {
    const { db, sqlite } = openDatabase(":memory:");
    const store = new StateOpportunityStore(new StateStore(db));
    const evaluator = new OpportunityEvaluator({}, store);
    const low = opportunity({ sourceItemId: "low", reward: { type: "FIXED", amount: 2, currency: "USD" } });
    const high = opportunity({ sourceItemId: "high", reward: { type: "FIXED", amount: 20, currency: "USD" } });
    await evaluator.evaluate(low);
    await evaluator.evaluate(high);
    const queue = new OpportunityQueue(store);
    expect((await queue.list())[0]?.sourceItemId).toBe("high");
    expect((await queue.dequeue())?.status).toBe("EXECUTING");
    sqlite.close();
  });
});
