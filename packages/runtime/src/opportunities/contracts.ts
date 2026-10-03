import type { EconomicState } from "../types.js";

export type OpportunityType = "JOB" | "BOUNTY" | "SERVICE_REQUEST" | "RESEARCH" | "DATA_TASK" | "CODING" | "CONTENT" | "OTHER";
export type OpportunityStatus = "DISCOVERED" | "NORMALIZED" | "EVALUATED" | "QUEUED" | "IGNORED" | "REQUIRES_APPROVAL" | "EXPIRED" | "UNAVAILABLE" | "EXECUTING" | "COMPLETED" | "FAILED";
export type OpportunityRewardType = "FIXED" | "RANGE" | "UNKNOWN";

export interface OpportunityReward {
  amount?: number;
  minAmount?: number;
  maxAmount?: number;
  currency?: string;
  type: OpportunityRewardType;
}

export interface OpportunityRequirements {
  requiredCapabilities: string[];
  constraints: string[];
  requiresApplication: boolean;
  requiresProposal: boolean;
  requiresExternalMessage: boolean;
  requiresAccount: boolean;
  requiresAuthentication: boolean;
  requiresIdentity: boolean;
  requiresIdentityVerification: boolean;
  requiresPayment: boolean;
  requiresWallet: boolean;
  requiresOnchainAction: boolean;
  requiresSubmission: boolean;
  requiredCapitalUsd: number;
}

export interface Opportunity {
  id: string;
  source: string;
  sourceItemId?: string;
  sourceUrl?: string;
  title: string;
  description: string;
  type: OpportunityType;
  reward?: OpportunityReward;
  deadline?: string;
  requiredCapabilities: string[];
  constraints?: string[];
  discoveredAt: string;
  status: OpportunityStatus;
  requirements: OpportunityRequirements;
  metadata?: Record<string, unknown>;
  fingerprint: string;
}

export interface OpportunitySourceContext {
  now?: string;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export interface RawOpportunity {
  source: string;
  sourceItemId?: string;
  sourceUrl?: string;
  title: string;
  description: string;
  type?: OpportunityType;
  reward?: OpportunityReward;
  deadline?: string;
  requiredCapabilities?: string[];
  constraints?: string[];
  metadata?: Record<string, unknown>;
}

export interface PreparedApplication {
  opportunityId: string;
  proposalText: string;
  executionPlan: string[];
  estimatedDelivery: string;
  requiredCapabilities: string[];
  expectedCostUsd: number;
  risks: string[];
  preparedAt: string;
}

export type WorkRunState = "DISCOVERED" | "EVALUATED" | "SELECTED" | "APPLICATION_PREPARED" | "AWAITING_APPLICATION_APPROVAL" | "APPLICATION_APPROVED" | "APPLICATION_SENT" | "APPLICATION_REJECTED" | "WORK_AVAILABLE" | "EXECUTING" | "WORK_READY" | "AWAITING_SUBMISSION_APPROVAL" | "SUBMISSION_APPROVED" | "SUBMITTED" | "AWAITING_SETTLEMENT" | "SETTLED" | "COMPLETED" | "FAILED" | "CANCELLED" | "EXPIRED" | "BLOCKED";
export type ExternalActor = "BEYONDER" | "HUMAN" | "EXTERNAL_SYSTEM";
export type VerificationStatus = "PASS" | "FAIL" | "UNKNOWN";
export type DeliverableType = "TEXT" | "CODE" | "FILE" | "STRUCTURED_DATA" | "RESEARCH_REPORT" | "OTHER";

export interface ExternalActionEvidence { executedBy: ExternalActor; timestamp: string; source: string; externalReference?: string; notes?: string; }
export interface ApplicationState extends PreparedApplication { approvalId?: string; idempotencyKey?: string; status: "PREPARED" | "PENDING_APPROVAL" | "APPROVED" | "SENT" | "REJECTED"; sentAt?: string; externalEvidence?: ExternalActionEvidence; }
export interface ExecutionState { taskId: string; status: string; plan?: unknown; completedSteps?: string[]; retries?: number; replans?: number; monetaryCostUsd: number; shadowCostUsd: number; durationMs?: number; completionEvidence?: string; startedAt?: string; completedAt?: string; }
export interface DeliverableState { id: string; workRunId: string; type: DeliverableType; summary: string; artifacts?: string[]; text?: string; metadata?: Record<string, unknown>; verificationStatus: VerificationStatus; verificationEvidence?: string; createdAt: string; }
export type SettlementEvidenceType = "MANUAL_CONFIRMED" | "MARKETPLACE_CONFIRMED" | "EXTERNAL_REFERENCE";
export interface SettlementEvidence { type: SettlementEvidenceType; amount: number; currency: string; source?: string; externalReference?: string; observedAt: string; metadata?: Record<string, unknown>; }
export interface SettlementState { evidence: SettlementEvidence; realizedRewardUsd: number; realizedNetRevenueUsd: number; recordedAt: string; }
export interface WorkRun {
  id: string; opportunityId: string; source: string; externalOpportunityId?: string; state: WorkRunState;
  application?: ApplicationState; execution?: ExecutionState; deliverable?: DeliverableState; settlement?: SettlementState;
  taskId?: string; estimatedRewardUsd?: number; simulatedRewardUsd?: number; realizedRewardUsd: number;
  monetaryCostUsd: number; shadowCostUsd: number; createdAt: string; updatedAt: string;
}

export interface OpportunityDiscoveryResult {
  sourceId: string;
  discoveredAt: string;
  items: RawOpportunity[];
  nextCursor?: string;
  errors: string[];
}

export interface OpportunitySource {
  id: string;
  discover(context?: OpportunitySourceContext): Promise<OpportunityDiscoveryResult>;
}

export interface OpportunityTelemetry {
  record(level: "debug" | "info" | "warn" | "error", event: string, details?: Record<string, unknown>): Promise<void>;
}

export interface OpportunityDiscoveryContext {
  economicState?: EconomicState;
  source?: string;
  limit?: number;
  signal?: AbortSignal;
}
