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
