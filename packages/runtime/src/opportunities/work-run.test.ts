import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/client.js";
import { StateStore } from "../memory/state-store.js";
import { ApprovalDeniedError, ApprovalGate } from "./approval.js";
import { FixtureApplicationAdapter, FixtureSubmissionAdapter, OpportunityBridge } from "./bridge.js";
import { normalizeOpportunity } from "./normalizer.js";
import { StateOpportunityStore } from "./store.js";
import { StateWorkRunStore, WorkRunError, WorkRunManager } from "./work-run.js";
import { OpenBountyPublicOpportunitySource } from "./sources.js";

const item = normalizeOpportunity({ source: "fixture", sourceItemId: "work-five", sourceUrl: "https://fixture.invalid/work-five", title: "Five dollar coding work", description: "Implement a small tested change.", type: "CODING", reward: { amount: 5, currency: "USD", type: "FIXED" }, requiredCapabilities: ["coding"], metadata: { requiresApplication: true, requiresSubmission: true } }, "2026-10-03T00:00:00.000Z");

describe("persistent real work loop", () => {
  it("runs application, work, verification, submission, settlement and survives re-read", async () => {
    const { db, sqlite } = openDatabase(":memory:"); const state = new StateStore(db); const opportunities = new StateOpportunityStore(state); await opportunities.upsert(item); const approvals = new ApprovalGate(state); const manager = new WorkRunManager(new StateWorkRunStore(state), opportunities, new OpportunityBridge(approvals, new FixtureApplicationAdapter(), new FixtureSubmissionAdapter()), approvals);
    const started = await manager.start(item.id); let run = await manager.prepareApplication(started.id);
    await expect(manager.markWorkAvailable(run.id)).rejects.toBeInstanceOf(WorkRunError); await expect(manager.beginExecution(run.id, "too-early")).rejects.toBeInstanceOf(WorkRunError);
    await expect(manager.sendApplication(run.id)).rejects.toBeInstanceOf(ApprovalDeniedError);
    await approvals.approve(run.application!.approvalId!); run = await manager.sendApplication(run.id); expect(run.state).toBe("APPLICATION_SENT");
    run = await manager.markWorkAvailable(run.id); run = await manager.beginExecution(run.id, "task-1"); run = await manager.completeExecution(run.id, { taskId: "task-1", status: "COMPLETED", monetaryCostUsd: 0, shadowCostUsd: 0, completedSteps: ["step-1"], completionEvidence: "verified task result" });
    run = await manager.createDeliverable(run.id, { type: "CODE", summary: "tested change", text: "deliverable" });
    await expect(manager.requestSubmissionApproval(run.id)).rejects.toBeInstanceOf(WorkRunError); run = await manager.verifyDeliverable(run.id, "PASS", "checks passed"); run = await manager.requestSubmissionApproval(run.id);
    await expect(manager.submit(run.id)).rejects.toBeInstanceOf(ApprovalDeniedError); await approvals.approve(run.deliverable!.metadata!.submissionApprovalId as string); run = await manager.submit(run.id); expect(run.state).toBe("AWAITING_SETTLEMENT"); expect(run.realizedRewardUsd).toBe(0);
    await expect(manager.recordSettlement(run.id, { type: "MANUAL_CONFIRMED", amount: -1, currency: "USD", source: "human", observedAt: new Date().toISOString() })).rejects.toBeInstanceOf(WorkRunError); await expect(manager.recordSettlement(run.id, { type: "MANUAL_CONFIRMED", amount: 5, currency: "EUR", source: "human", observedAt: new Date().toISOString() })).rejects.toBeInstanceOf(WorkRunError);
    run = await manager.recordSettlement(run.id, { type: "EXTERNAL_REFERENCE", amount: 5, currency: "USD", source: "fixture", externalReference: "payment-5", observedAt: new Date().toISOString() }); expect(run.state).toBe("COMPLETED"); expect(run.realizedRewardUsd).toBe(5);
    await expect(manager.recordSettlement(run.id, { type: "EXTERNAL_REFERENCE", amount: 5, currency: "USD", source: "fixture", externalReference: "payment-duplicate", observedAt: new Date().toISOString() })).rejects.toBeInstanceOf(WorkRunError);
    const resumed = await new WorkRunManager(new StateWorkRunStore(state), opportunities, new OpportunityBridge(approvals, new FixtureApplicationAdapter(), new FixtureSubmissionAdapter()), approvals).inspect(run.id); expect(resumed?.state).toBe("COMPLETED"); expect(resumed?.settlement?.evidence.externalReference).toBe("payment-5"); sqlite.close();
  });

  it("does not accept malformed public marketplace payloads", async () => {
    const source = new OpenBountyPublicOpportunitySource({ fetchImpl: async () => new Response(JSON.stringify({ data: { nope: true } }), { status: 200 }) }); const result = await source.discover(); expect(result.items).toEqual([]); expect(result.errors[0]).toContain("malformed");
  });
});
