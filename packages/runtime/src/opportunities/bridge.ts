import type { AuditLog } from "../audit/audit-log.js";
import type { Opportunity, PreparedApplication } from "./contracts.js";
import { ApprovalGate, type ApprovalRequest } from "./approval.js";

export interface ApplicationAdapter { apply(opportunity: Opportunity, application: PreparedApplication): Promise<{ status: "APPLICATION_SENT"; externalId?: string }>; }
export interface SubmissionAdapter { submit(opportunity: Opportunity, taskId: string, deliverable: string): Promise<{ status: "COMPLETED"; evidence: string }>; }
export class FixtureApplicationAdapter implements ApplicationAdapter { async apply(opportunity: Opportunity) { return { status: "APPLICATION_SENT" as const, externalId: `fixture-application:${opportunity.id}` }; } }
export class FixtureSubmissionAdapter implements SubmissionAdapter { async submit(opportunity: Opportunity, taskId: string) { return { status: "COMPLETED" as const, evidence: `fixture-submission:${opportunity.id}:${taskId}` }; } }

export class OpportunityBridge {
  constructor(private readonly gate: ApprovalGate, private readonly application: ApplicationAdapter, private readonly submission: SubmissionAdapter, private readonly audit?: AuditLog) {}

  async prepareApplication(opportunity: Opportunity, taskId?: string): Promise<{ application: PreparedApplication; approval: ApprovalRequest }> {
    const application: PreparedApplication = {
      opportunityId: opportunity.id,
      proposalText: `I can deliver “${opportunity.title}” using ${opportunity.requiredCapabilities.join(", ") || "research and planning"}. I will provide verifiable work aligned with the listed requirements.`,
      executionPlan: ["Review requirements", "Complete the work locally", "Verify the deliverable", "Submit only after separate approval"],
      estimatedDelivery: typeof opportunity.metadata?.estimatedDurationMinutes === "number" ? `${opportunity.metadata.estimatedDurationMinutes} minutes` : "bounded local task",
      requiredCapabilities: opportunity.requiredCapabilities,
      expectedCostUsd: 0,
      risks: ["External application creates a marketplace commitment", "Account/authentication may be required", "Reward is not realized until explicit payment evidence exists"],
      preparedAt: new Date().toISOString()
    };
    const approval = await this.gate.request({ opportunityId: opportunity.id, taskId, action: "APPLY_TO_OPPORTUNITY", summary: `Apply to ${opportunity.title}`, destination: opportunity.sourceUrl ?? opportunity.source, payloadPreview: application.proposalText, risks: application.risks });
    await this.audit?.record("info", "opportunity.application_prepared", { opportunityId: opportunity.id, taskId, approvalId: approval.approvalId });
    return { application, approval };
  }

  async apply(opportunity: Opportunity, application: PreparedApplication, approvalId: string, taskId?: string) {
    await this.gate.consume(approvalId, "APPLY_TO_OPPORTUNITY", opportunity.id, taskId);
    const result = await this.application.apply(opportunity, application);
    await this.audit?.record("info", "opportunity.application_sent", { opportunityId: opportunity.id, approvalId, ...result });
    return result;
  }

  async requestSubmission(opportunity: Opportunity, taskId: string, deliverable: string): Promise<ApprovalRequest> {
    const approval = await this.gate.request({ opportunityId: opportunity.id, taskId, action: "SUBMIT_DELIVERABLE", summary: `Submit verified deliverable for ${opportunity.title}`, destination: opportunity.sourceUrl ?? opportunity.source, payloadPreview: deliverable.slice(0, 500), risks: ["Submission is an external action", "Submission may start review/payment terms"] });
    await this.audit?.record("info", "deliverable.submission_requested", { opportunityId: opportunity.id, taskId, approvalId: approval.approvalId });
    return approval;
  }

  async submit(opportunity: Opportunity, taskId: string, deliverable: string, approvalId: string) {
    await this.gate.consume(approvalId, "SUBMIT_DELIVERABLE", opportunity.id, taskId);
    const result = await this.submission.submit(opportunity, taskId, deliverable);
    await this.audit?.record("info", "deliverable.submitted", { opportunityId: opportunity.id, taskId, approvalId, evidence: result.evidence, realizedRewardUsd: 0 });
    return result;
  }
}
