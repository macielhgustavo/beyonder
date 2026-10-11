import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyEconomicState } from "../economy/economic-state.js";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/client.js";
import { StateStore } from "../memory/state-store.js";
import { EconomicLedger } from "../economy/ledger.js";
import { ApprovalDeniedError, ApprovalGate } from "./approval.js";
import { FixtureApplicationAdapter, FixtureSubmissionAdapter, OpportunityBridge } from "./bridge.js";
import { normalizeOpportunity } from "./normalizer.js";
import { StateOpportunityStore } from "./store.js";
import { StateWorkRunStore, WorkRunError, WorkRunManager } from "./work-run.js";
import { OpenBountyPublicOpportunitySource } from "./sources.js";
import type { SettlementEvidenceType } from "./contracts.js";

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

  it("credits a submitted fixture once across database restart and updates economic state", async () => {
    const directory = mkdtempSync(join(tmpdir(), "settlement-e2e-"));
    const path = join(directory, "runtime.sqlite");
    const { db, sqlite } = openDatabase(path);
    const state = new StateStore(db);
    const opportunities = new StateOpportunityStore(state);
    await opportunities.upsert(item);
    const approvals = new ApprovalGate(state);
    const ledger = new EconomicLedger(db);
    const manager = new WorkRunManager(new StateWorkRunStore(state), opportunities, new OpportunityBridge(approvals, new FixtureApplicationAdapter(), new FixtureSubmissionAdapter()), approvals, undefined, undefined, ledger);

    const started = await manager.start(item.id);
    let run = await manager.prepareApplication(started.id);
    await approvals.approve(run.application!.approvalId!);
    run = await manager.sendApplication(run.id);
    run = await manager.markWorkAvailable(run.id);
    run = await manager.beginExecution(run.id, "task-1");
    run = await manager.completeExecution(run.id, { taskId: "task-1", status: "COMPLETED", monetaryCostUsd: 0, shadowCostUsd: 0, completedSteps: ["step-1"], completionEvidence: "verified task result" });
    run = await manager.createDeliverable(run.id, { type: "CODE", summary: "tested change", text: "deliverable" });
    run = await manager.verifyDeliverable(run.id, "PASS", "checks passed");
    run = await manager.requestSubmissionApproval(run.id);
    await approvals.approve(run.deliverable!.metadata!.submissionApprovalId as string);
    run = await manager.submit(run.id);

    // Record settlement
    const settlementEvidence: { type: SettlementEvidenceType; amount: number; currency: string; source: string; externalReference: string; observedAt: string } = { type: "MANUAL_CONFIRMED", amount: 10, currency: "USD", source: "test", externalReference: "tx-123", observedAt: new Date().toISOString() };
    run = await manager.recordSettlement(run.id, settlementEvidence);

    // Check that revenue was recorded in ledger
    const entries = await ledger.latest(10);
    const revenueEntries = entries.filter(e => e.type === "revenue");
    expect(revenueEntries).toHaveLength(1);
    expect(revenueEntries[0].amountUsd).toBe(10);
    expect(JSON.parse(revenueEntries[0].metadata).idempotencyKey).toBe("tx-123");
    expect(JSON.parse(revenueEntries[0].metadata).workRunId).toBe(run.id);

    expect(classifyEconomicState(await ledger.summary(0))).toBe("growth");
    sqlite.close();
    const reopened = openDatabase(path);
    try {
      const restartedState = new StateStore(reopened.db);
      const restartedApprovals = new ApprovalGate(restartedState);
      const restartedLedger = new EconomicLedger(reopened.db);
      const restarted = new WorkRunManager(new StateWorkRunStore(restartedState), new StateOpportunityStore(restartedState), new OpportunityBridge(restartedApprovals, new FixtureApplicationAdapter(), new FixtureSubmissionAdapter()), restartedApprovals, undefined, undefined, restartedLedger);
      expect(await restarted.recordSettlement(run.id, settlementEvidence)).toMatchObject({ state: "COMPLETED", realizedRewardUsd: 10 });
      expect(await restartedLedger.summary(0)).toMatchObject({ revenueUsd: 10, balanceUsd: 10 });
      expect((await restartedLedger.latest()).filter(entry => entry.type === "revenue")).toHaveLength(1);
      await expect(restarted.recordSettlement(run.id, { ...settlementEvidence, amount: 99 })).rejects.toThrow("different evidence");
    } finally { reopened.sqlite.close(); rmSync(directory, { recursive: true, force: true }); }
  });
  it("rolls back ledger credit if the state write fails and safely retries", async () => {
    const { db, sqlite } = openDatabase(":memory:");
    try {
      const state = new StateStore(db); const ledger = new EconomicLedger(db);
      const expected = { state: "AWAITING_SETTLEMENT" }; const completed = { state: "COMPLETED" };
      await state.set("work-run:atomic", expected);
      sqlite.exec("CREATE TRIGGER reject_completion BEFORE UPDATE ON state BEGIN SELECT RAISE(ABORT, 'simulated storage interruption'); END");
      const metadata = { idempotencyKey: "fixture-payment", workRunId: "atomic" };
      await expect(ledger.recordRevenueWithState(5, "fixture", metadata, { key: "work-run:atomic", expected, value: completed })).rejects.toThrow("simulated storage interruption");
      expect(await ledger.summary(0)).toMatchObject({ revenueUsd: 0, balanceUsd: 0 });
      expect(await state.get("work-run:atomic", null)).toEqual(expected);
      sqlite.exec("DROP TRIGGER reject_completion");
      await ledger.recordRevenueWithState(5, "fixture", metadata, { key: "work-run:atomic", expected, value: completed });
      for (let i = 0; i < 110; i++) await ledger.record("expense", 0, "unrelated history");
      await state.set("work-run:other", expected);
      await expect(ledger.recordRevenueWithState(5, "fixture", { ...metadata, workRunId: "other" }, { key: "work-run:other", expected, value: completed })).rejects.toThrow("different work run");
      expect(await ledger.summary(0)).toMatchObject({ revenueUsd: 5, balanceUsd: 5 });
    } finally { sqlite.close(); }
  });

});
