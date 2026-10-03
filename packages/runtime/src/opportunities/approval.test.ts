import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/client.js";
import { StateStore } from "../memory/state-store.js";
import { ApprovalDeniedError, ApprovalGate } from "./approval.js";
import { FixtureApplicationAdapter, FixtureSubmissionAdapter, OpportunityBridge } from "./bridge.js";
import { normalizeOpportunity } from "./normalizer.js";

const item = normalizeOpportunity({ source: "fixture", sourceItemId: "coding-5", title: "Five dollar coding task", description: "Implement and test a small change.", type: "CODING", reward: { amount: 5, currency: "USD", type: "FIXED" }, requiredCapabilities: ["coding"], metadata: { requiresApplication: true, requiresSubmission: true } });

describe("approval gate and real opportunity bridge", () => {
  it("requires explicit, action-specific, single-use approvals for application and submission", async () => {
    const { db, sqlite } = openDatabase(":memory:");
    const gate = new ApprovalGate(new StateStore(db), undefined, () => new Date("2026-10-03T00:00:00.000Z"));
    const bridge = new OpportunityBridge(gate, new FixtureApplicationAdapter(), new FixtureSubmissionAdapter());
    const prepared = await bridge.prepareApplication(item, "task-1");
    await expect(bridge.apply(item, prepared.application, prepared.approval.approvalId, "task-1")).rejects.toBeInstanceOf(ApprovalDeniedError);
    await gate.approve(prepared.approval.approvalId);
    expect((await bridge.apply(item, prepared.application, prepared.approval.approvalId, "task-1")).status).toBe("APPLICATION_SENT");
    await expect(bridge.apply(item, prepared.application, prepared.approval.approvalId, "task-1")).rejects.toBeInstanceOf(ApprovalDeniedError);

    const submission = await bridge.requestSubmission(item, "task-1", "verified deliverable");
    await expect(bridge.submit(item, "task-1", "verified deliverable", submission.approvalId)).rejects.toBeInstanceOf(ApprovalDeniedError);
    await gate.approve(submission.approvalId);
    expect((await bridge.submit(item, "task-1", "verified deliverable", submission.approvalId)).status).toBe("COMPLETED");
    await expect(bridge.submit(item, "task-1", "verified deliverable", submission.approvalId)).rejects.toBeInstanceOf(ApprovalDeniedError);
    expect((await gate.list()).filter((request) => request.opportunityId === item.id).map((request) => request.status)).toEqual(["CONSUMED", "CONSUMED"]);
    sqlite.close();
  });

  it("rejects wrong opportunity/action and expires pending approvals", async () => {
    const { db, sqlite } = openDatabase(":memory:");
    let current = new Date("2026-10-03T00:00:00.000Z");
    const gate = new ApprovalGate(new StateStore(db), undefined, () => current);
    const request = await gate.request({ opportunityId: "one", action: "APPLY_TO_OPPORTUNITY", summary: "apply", destination: "fixture", payloadPreview: "safe", risks: [], expiresAt: "2026-10-03T00:01:00.000Z" });
    await expect(gate.consume(request.approvalId, "SUBMIT_DELIVERABLE", "one")).rejects.toBeInstanceOf(ApprovalDeniedError);
    current = new Date("2026-10-03T00:02:00.000Z");
    expect((await gate.inspect(request.approvalId))?.status).toBe("EXPIRED");
    sqlite.close();
  });
});
