import { nanoid } from "nanoid";
import type { AuditLog } from "../audit/audit-log.js";
import type { MemoryEngine } from "../memory/memory-engine.js";
import type { EconomicLedger } from "../economy/ledger.js";
import { ApprovalDeniedError, ApprovalGate } from "./approval.js";
import type { OpportunityStore } from "./store.js";
import type { Opportunity, PreparedApplication, SettlementEvidence, WorkRun, WorkRunState, DeliverableType, ExecutionState, ExternalActionEvidence } from "./contracts.js";
import { OpportunityBridge } from "./bridge.js";

const INDEX = "work-runs:index";
const itemKey = (id: string) => `work-run:${id}`;
const TERMINAL: WorkRunState[] = ["COMPLETED", "FAILED", "CANCELLED", "EXPIRED"];

export class WorkRunError extends Error { readonly code = "WORK_RUN_INVALID"; }
export interface WorkRunStore { save(run: WorkRun): Promise<WorkRun>; get(id: string): Promise<WorkRun | undefined>; list(): Promise<WorkRun[]>; }
export class StateWorkRunStore implements WorkRunStore {
  constructor(private readonly state: import("../memory/state-store.js").StateStore) {}
  async save(run: WorkRun) { const ids = await this.state.get<string[]>(INDEX, []); await this.state.set(INDEX, ids.includes(run.id) ? ids : [...ids, run.id]); await this.state.set(itemKey(run.id), run); return run; }
  async get(id: string) { return this.state.get<WorkRun | undefined>(itemKey(id), undefined); }
  async list() { const ids = await this.state.get<string[]>(INDEX, []); const runs: WorkRun[] = []; for (const id of ids) { const run = await this.get(id); if (run) runs.push(run); } return runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
}

export class WorkRunManager {
  constructor(
    private readonly runs: WorkRunStore,
    private readonly opportunities: OpportunityStore,
    private readonly bridge: OpportunityBridge,
    private readonly approvals: ApprovalGate,
    private readonly audit?: AuditLog,
    private readonly memory?: MemoryEngine,
    private readonly ledger?: EconomicLedger,
    private readonly now: () => Date = () => new Date()
  ) {}

  async list() { return this.runs.list(); }
  async inspect(id: string) { return this.runs.get(id); }
  async start(opportunityId: string): Promise<WorkRun> {
    const opportunity = await this.requireOpportunity(opportunityId);
    const existing = (await this.runs.list()).find((run) => run.opportunityId === opportunityId && !TERMINAL.includes(run.state));
    if (existing) return existing;
    const now = this.now().toISOString();
    const run: WorkRun = { id: nanoid(), opportunityId, source: opportunity.source, externalOpportunityId: opportunity.sourceItemId, state: "SELECTED", estimatedRewardUsd: rewardEstimate(opportunity), simulatedRewardUsd: 0, realizedRewardUsd: 0, monetaryCostUsd: 0, shadowCostUsd: 0, createdAt: now, updatedAt: now };
    return this.save(run, "work.created");
  }

  async prepareApplication(id: string): Promise<WorkRun> {
    const run = await this.requireRun(id); if (run.application) return run;
    const opportunity = await this.requireOpportunity(run.opportunityId);
    const prepared = await this.bridge.prepareApplication(opportunity, run.taskId);
    return this.save({ ...run, application: { ...prepared.application, approvalId: prepared.approval.approvalId, idempotencyKey: `work-run:${run.id}:application`, mode: this.bridge.applicationMode, status: "PENDING_APPROVAL" }, state: "AWAITING_APPLICATION_APPROVAL" }, "application.approval_requested", { approvalId: prepared.approval.approvalId });
  }

  async approveApplication(id: string): Promise<WorkRun> {
    const run = await this.requireRun(id); const approvalId = run.application?.approvalId; if (!approvalId || run.state !== "AWAITING_APPLICATION_APPROVAL") throw new WorkRunError("Application is not awaiting approval.");
    await this.approvals.approve(approvalId);
    return this.save({ ...run, state: "APPLICATION_APPROVED", application: { ...run.application!, status: "APPROVED" } }, "approval.approved", { approvalId });
  }

  async sendApplication(id: string): Promise<WorkRun> {
    let run = await this.requireRun(id); if (run.state === "APPLICATION_SENT") return run; if (run.state === "AWAITING_APPLICATION_APPROVAL" && run.application?.approvalId && (await this.approvals.inspect(run.application.approvalId))?.status === "APPROVED") run = await this.save({ ...run, state: "APPLICATION_APPROVED", application: { ...run.application, status: "APPROVED" } }, "approval.approved", { approvalId: run.application.approvalId }); if (run.state !== "APPLICATION_APPROVED" || !run.application) throw new ApprovalDeniedError("Application requires a valid approval.");
    const result = await this.bridge.apply(await this.requireOpportunity(run.opportunityId), run.application, run.application.approvalId!, run.taskId);
    if (result.status === "MANUAL_ACTION_REQUIRED") return this.save({ ...run, state: "MANUAL_APPLICATION_REQUIRED", application: { ...run.application, status: "MANUAL_ACTION_REQUIRED" } }, "application.manual_required");
    return this.save({ ...run, state: "APPLICATION_SENT", application: { ...run.application, status: "SENT", sentAt: this.now().toISOString() } }, "application.sent", { approvalId: run.application.approvalId, externalId: result.externalId });
  }

  async recordManualApplication(id: string, evidence: ExternalActionEvidence): Promise<WorkRun> {
    const run = await this.requireRun(id); if (run.state !== "MANUAL_APPLICATION_REQUIRED" || !run.application) throw new ApprovalDeniedError("Application requires manual action and approval before confirmation.");
    validateExternalEvidence(evidence, run.source);
    await this.approvals.consume(run.application.approvalId!, "APPLY_TO_OPPORTUNITY", run.opportunityId, run.taskId);
    return this.save({ ...run, state: "APPLICATION_SENT", application: { ...run.application, status: "SENT", sentAt: evidence.timestamp, externalEvidence: evidence } }, "application.confirmed", { approvalId: run.application.approvalId, executedBy: evidence.executedBy });
  }

  async markWorkAvailable(id: string) { const run = await this.requireRun(id); if (run.state !== "APPLICATION_SENT") throw new WorkRunError("Work is not available before application is sent."); return this.save({ ...run, state: "WORK_AVAILABLE" }, "work.state_changed"); }
  async beginExecution(id: string, taskId: string): Promise<WorkRun> { const run = await this.requireRun(id); if (run.state !== "WORK_AVAILABLE") throw new WorkRunError("Work execution requires WORK_AVAILABLE."); return this.save({ ...run, state: "EXECUTING", taskId, execution: { taskId, status: "RUNNING", monetaryCostUsd: 0, shadowCostUsd: 0, startedAt: this.now().toISOString() } }, "work.execution_started", { taskId }); }
  async completeExecution(id: string, execution: ExecutionState): Promise<WorkRun> { const run = await this.requireRun(id); if (run.state !== "EXECUTING" || run.taskId !== execution.taskId) throw new WorkRunError("Execution does not match the active work run."); return this.save({ ...run, state: "WORK_READY", execution: { ...execution, status: "COMPLETED", completedAt: execution.completedAt ?? this.now().toISOString() }, monetaryCostUsd: execution.monetaryCostUsd, shadowCostUsd: execution.shadowCostUsd }, "work.execution_completed", { taskId: execution.taskId }); }

  async createDeliverable(id: string, input: { type: DeliverableType; summary: string; text?: string; artifacts?: string[]; metadata?: Record<string, unknown> }): Promise<WorkRun> {
    const run = await this.requireRun(id); if (run.state !== "WORK_READY" || !run.execution || run.execution.status !== "COMPLETED") throw new WorkRunError("Deliverable requires completed execution.");
    const deliverable = { id: nanoid(), workRunId: id, ...input, verificationStatus: "UNKNOWN" as const, createdAt: this.now().toISOString() };
    return this.save({ ...run, deliverable }, "deliverable.created");
  }
  async verifyDeliverable(id: string, status: "PASS" | "FAIL" | "UNKNOWN", evidence?: string): Promise<WorkRun> {
    const run = await this.requireRun(id); if (!run.deliverable) throw new WorkRunError("No deliverable exists.");
    if (status === "FAIL") return this.save({ ...run, state: "BLOCKED", deliverable: { ...run.deliverable, verificationStatus: status, verificationEvidence: evidence } }, "deliverable.verified", { status });
    return this.save({ ...run, state: status === "PASS" ? "WORK_READY" : "BLOCKED", deliverable: { ...run.deliverable, verificationStatus: status, verificationEvidence: evidence } }, "deliverable.verified", { status });
  }
  async requestSubmissionApproval(id: string): Promise<WorkRun> { const run = await this.requireRun(id); if (!run.deliverable || run.deliverable.verificationStatus !== "PASS" || run.state !== "WORK_READY") throw new WorkRunError("Only a verified deliverable can request submission approval."); const approval = await this.bridge.requestSubmission(await this.requireOpportunity(run.opportunityId), run.taskId ?? "", run.deliverable.text ?? run.deliverable.summary); return this.save({ ...run, state: "AWAITING_SUBMISSION_APPROVAL", deliverable: { ...run.deliverable, metadata: { ...run.deliverable.metadata, submissionApprovalId: approval.approvalId } } }, "deliverable.approval_requested", { approvalId: approval.approvalId }); }
  async approveSubmission(id: string): Promise<WorkRun> { const run = await this.requireRun(id); const approvalId = this.submissionApproval(run); await this.approvals.approve(approvalId); return this.save({ ...run, state: "SUBMISSION_APPROVED" }, "approval.approved", { approvalId }); }
  async submit(id: string): Promise<WorkRun> { let run = await this.requireRun(id); const approvalId = this.submissionApproval(run); if (run.state === "SUBMITTED" || run.state === "AWAITING_SETTLEMENT") return run; if (run.state === "AWAITING_SUBMISSION_APPROVAL" && (await this.approvals.inspect(approvalId))?.status === "APPROVED") run = await this.save({ ...run, state: "SUBMISSION_APPROVED" }, "approval.approved", { approvalId }); if (run.state !== "SUBMISSION_APPROVED") throw new ApprovalDeniedError("Submission requires a separate valid approval."); const result = await this.bridge.submit(await this.requireOpportunity(run.opportunityId), run.taskId ?? "", run.deliverable?.text ?? run.deliverable?.summary ?? "", approvalId); if (result.status === "MANUAL_ACTION_REQUIRED") return this.save({ ...run, state: "MANUAL_SUBMISSION_REQUIRED" }, "deliverable.manual_required"); return this.save({ ...run, state: "AWAITING_SETTLEMENT", deliverable: { ...run.deliverable!, metadata: { ...run.deliverable?.metadata, submissionEvidence: result.evidence } } }, "deliverable.submitted", { approvalId }); }
  async recordManualSubmission(id: string, evidence: ExternalActionEvidence): Promise<WorkRun> {
    const run = await this.requireRun(id);
    if (run.state !== "MANUAL_SUBMISSION_REQUIRED" || !run.deliverable) throw new ApprovalDeniedError("Submission requires manual action and approval before confirmation.");
    validateExternalEvidence(evidence, run.source);
    await this.approvals.consume(this.submissionApproval(run), "SUBMIT_DELIVERABLE", run.opportunityId, run.taskId ?? "");
    return this.save({ ...run, state: "AWAITING_SETTLEMENT", deliverable: { ...run.deliverable, metadata: { ...run.deliverable.metadata, submissionEvidence: evidence } } }, "deliverable.confirmed", { executedBy: evidence.executedBy });
  }
  async recordSettlement(id: string, evidence: SettlementEvidence): Promise<WorkRun> {
    const run = await this.requireRun(id);
    if (run.settlement || run.state === "SETTLED" || run.state === "COMPLETED") throw new WorkRunError("Settlement is already recorded.");
    if (!["SUBMITTED", "AWAITING_SETTLEMENT"].includes(run.state)) throw new WorkRunError("Settlement requires a submitted deliverable.");
    validateEvidence(evidence);

    // Idempotency check: use settlement evidence externalReference or workRunId as idempotency key
    const idempotencyKey = evidence.externalReference ?? `work-run:${id}:settlement`;
    const alreadyRecorded = await this.ledger?.latest(100).then(entries =>
      entries.some(entry =>
        entry.type === "revenue" &&
        JSON.parse(entry.metadata).idempotencyKey === idempotencyKey
      )
    ) ?? false;

    if (alreadyRecorded) {
      throw new WorkRunError("Settlement already recorded in ledger (idempotency key conflict).");
    }

    const settlement = {
      evidence,
      realizedRewardUsd: evidence.amount,
      realizedNetRevenueUsd: evidence.amount - run.monetaryCostUsd,
      recordedAt: this.now().toISOString()
    };

    const completed = await this.save(
      { ...run, state: "COMPLETED", settlement, realizedRewardUsd: evidence.amount },
      "revenue.realized",
      { amount: evidence.amount, currency: evidence.currency }
    );

    // Record revenue in EconomicLedger with idempotency key
    if (this.ledger) {
      await this.ledger.record("revenue", evidence.amount, `Settlement for work run ${id}`, {
        idempotencyKey,
        workRunId: id,
        opportunityId: run.opportunityId,
        source: run.source,
        evidenceType: evidence.type,
        externalReference: evidence.externalReference
      });
    }

    await this.memory?.remember("economic", JSON.stringify({
      workRunId: id,
      opportunityId: run.opportunityId,
      source: run.source,
      estimatedRewardUsd: run.estimatedRewardUsd,
      simulatedRewardUsd: run.simulatedRewardUsd ?? 0,
      realizedRewardUsd: evidence.amount,
      settlementEvidence: evidence,
      monetaryCostUsd: run.monetaryCostUsd,
      shadowCostUsd: run.shadowCostUsd
    }), 4, { source: "work-run-settlement" });

    return completed;
  }

  private submissionApproval(run: WorkRun): string { const id = run.deliverable?.metadata?.submissionApprovalId; if (typeof id !== "string") throw new WorkRunError("Submission approval is missing."); return id; }
  private async requireOpportunity(id: string): Promise<Opportunity> { const opportunity = await this.opportunities.get(id); if (!opportunity) throw new WorkRunError(`Opportunity ${id} was not found.`); return opportunity; }
  private async requireRun(id: string): Promise<WorkRun> { const run = await this.runs.get(id); if (!run) throw new WorkRunError(`Work run ${id} was not found.`); return run; }
  private async save(run: WorkRun, event: string, details: Record<string, unknown> = {}) { const saved = await this.runs.save({ ...run, updatedAt: this.now().toISOString() }); await this.audit?.record("info", event, { workRunId: run.id, opportunityId: run.opportunityId, taskId: run.taskId, ...details }); return saved; }
}

function rewardEstimate(opportunity: Opportunity): number | undefined { if (!opportunity.reward) return undefined; if (opportunity.reward.type === "FIXED") return opportunity.reward.amount; if (opportunity.reward.type === "RANGE" && opportunity.reward.minAmount !== undefined && opportunity.reward.maxAmount !== undefined) return (opportunity.reward.minAmount + opportunity.reward.maxAmount) / 2; return undefined; }
function validateEvidence(evidence: SettlementEvidence) { if (!Number.isFinite(evidence.amount) || evidence.amount <= 0) throw new WorkRunError("Settlement amount must be positive."); if (!["USD", "USDC"].includes(evidence.currency.toUpperCase())) throw new WorkRunError("Settlement currency must be USD or USDC."); if (!evidence.source && !evidence.externalReference) throw new WorkRunError("Settlement requires source or externalReference provenance."); if (!evidence.observedAt || Number.isNaN(new Date(evidence.observedAt).getTime())) throw new WorkRunError("Settlement observedAt is invalid."); }

function validateExternalEvidence(evidence: ExternalActionEvidence, source: string) { if (evidence.executedBy !== "HUMAN" || evidence.source !== source || !evidence.timestamp || Number.isNaN(Date.parse(evidence.timestamp))) throw new WorkRunError("Confirmação humana inválida."); }
