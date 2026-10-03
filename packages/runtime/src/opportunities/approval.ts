import { nanoid } from "nanoid";
import type { AuditLog } from "../audit/audit-log.js";
import type { StateStore } from "../memory/state-store.js";

export type ApprovalActionType = "APPLY_TO_OPPORTUNITY" | "SEND_PROPOSAL" | "SEND_EXTERNAL_MESSAGE" | "SUBMIT_DELIVERABLE" | "ACCEPT_TERMS";
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CONSUMED";
export interface ApprovalRequest {
  approvalId: string;
  opportunityId: string;
  taskId?: string;
  action: ApprovalActionType;
  summary: string;
  destination: string;
  payloadPreview: string;
  risks: string[];
  createdAt: string;
  expiresAt?: string;
  status: ApprovalStatus;
}
export interface ApprovalDecision { approvalId: string; status: "APPROVED" | "REJECTED"; decidedAt: string; reason?: string; }

const KEY = "approvals:index";
const itemKey = (id: string) => `approval:${id}`;

export class ApprovalDeniedError extends Error { readonly code = "APPROVAL_DENIED"; }
export class ApprovalGate {
  constructor(private readonly state: StateStore, private readonly audit?: AuditLog, private readonly now: () => Date = () => new Date()) {}

  async request(input: Omit<ApprovalRequest, "approvalId" | "createdAt" | "status">): Promise<ApprovalRequest> {
    const request: ApprovalRequest = { ...input, approvalId: nanoid(), createdAt: this.now().toISOString(), status: "PENDING" };
    const ids = await this.state.get<string[]>(KEY, []);
    await this.state.set(KEY, [...ids, request.approvalId]);
    await this.state.set(itemKey(request.approvalId), request);
    await this.emit("approval.requested", request);
    return request;
  }

  async list(): Promise<ApprovalRequest[]> {
    const ids = await this.state.get<string[]>(KEY, []);
    const values: ApprovalRequest[] = [];
    for (const id of ids) { const value = await this.inspect(id); if (value) values.push(this.expireIfNeeded(value)); }
    return values.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async inspect(id: string): Promise<ApprovalRequest | undefined> { const value = await this.state.get<ApprovalRequest | undefined>(itemKey(id), undefined); return value ? this.expireIfNeeded(value) : undefined; }
  async approve(id: string): Promise<ApprovalDecision> { return this.decide(id, "APPROVED"); }
  async reject(id: string, reason?: string): Promise<ApprovalDecision> { return this.decide(id, "REJECTED", reason); }

  async consume(id: string, action: ApprovalActionType, opportunityId: string, taskId?: string): Promise<ApprovalRequest> {
    const request = await this.inspect(id);
    if (!request || request.status !== "APPROVED" || request.action !== action || request.opportunityId !== opportunityId || (request.taskId !== undefined && request.taskId !== taskId)) {
      throw new ApprovalDeniedError(`Approval ${id} is not valid for ${action} on ${opportunityId}.`);
    }
    const consumed = { ...request, status: "CONSUMED" as const };
    await this.state.set(itemKey(id), consumed);
    await this.emit("approval.consumed", consumed);
    return consumed;
  }

  private async decide(id: string, status: "APPROVED" | "REJECTED", reason?: string): Promise<ApprovalDecision> {
    const request = await this.inspect(id);
    if (!request || request.status !== "PENDING") throw new ApprovalDeniedError(`Approval ${id} is not pending.`);
    const decision = { approvalId: id, status, decidedAt: this.now().toISOString(), ...(reason ? { reason } : {}) } as ApprovalDecision;
    await this.state.set(itemKey(id), { ...request, status });
    await this.emit(`approval.${status.toLowerCase()}`, decision);
    return decision;
  }
  private expireIfNeeded(request: ApprovalRequest): ApprovalRequest {
    if (request.status === "PENDING" && request.expiresAt && new Date(request.expiresAt).getTime() <= this.now().getTime()) {
      const expired = { ...request, status: "EXPIRED" as const }; void this.state.set(itemKey(request.approvalId), expired); return expired;
    }
    return request;
  }
  private async emit(event: string, value: object) { await this.audit?.record("info", event, value as Record<string, unknown>); }
}
