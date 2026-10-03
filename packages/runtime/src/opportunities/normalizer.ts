import { createHash } from "node:crypto";
import type { Opportunity, OpportunityRequirements, RawOpportunity } from "./contracts.js";

export function normalizeOpportunity(raw: RawOpportunity, discoveredAt = new Date().toISOString()): Opportunity {
  const title = raw.title.trim().replace(/\s+/g, " ");
  const description = raw.description.trim();
  const metadata = raw.metadata ?? {};
  const requirements: OpportunityRequirements = {
    requiredCapabilities: unique(raw.requiredCapabilities ?? []),
    constraints: unique(raw.constraints ?? []),
    requiresApplication: booleanMetadata(metadata, "requiresApplication"),
    requiresProposal: booleanMetadata(metadata, "requiresProposal") || booleanMetadata(metadata, "requiresApplication"),
    requiresExternalMessage: booleanMetadata(metadata, "requiresExternalMessage"),
    requiresAccount: booleanMetadata(metadata, "requiresAccount"),
    requiresAuthentication: booleanMetadata(metadata, "requiresAuthentication"),
    requiresIdentity: booleanMetadata(metadata, "requiresIdentity") || booleanMetadata(metadata, "requiresIdentityVerification"),
    requiresIdentityVerification: booleanMetadata(metadata, "requiresIdentityVerification"),
    requiresPayment: booleanMetadata(metadata, "requiresPayment"),
    requiresWallet: booleanMetadata(metadata, "requiresWallet"),
    requiresOnchainAction: booleanMetadata(metadata, "requiresOnchainAction"),
    requiresSubmission: booleanMetadata(metadata, "requiresSubmission"),
    requiredCapitalUsd: numberMetadata(metadata, "requiredCapitalUsd")
  };
  const fingerprint = fingerprintFor(raw.source, raw.sourceItemId, title, raw.reward);
  return {
    id: raw.sourceItemId ? `${raw.source}:${raw.sourceItemId}` : `opportunity:${fingerprint}`,
    source: raw.source,
    sourceItemId: raw.sourceItemId,
    sourceUrl: raw.sourceUrl,
    title,
    description,
    type: raw.type ?? "OTHER",
    reward: raw.reward,
    deadline: raw.deadline,
    requiredCapabilities: requirements.requiredCapabilities,
    constraints: requirements.constraints,
    discoveredAt,
    status: "NORMALIZED",
    requirements,
    metadata,
    fingerprint
  };
}

export function fingerprintFor(source: string, sourceItemId: string | undefined, title: string, reward: Opportunity["reward"]): string {
  const stable = sourceItemId ? `${source}:${sourceItemId}` : `${source}:${title.toLowerCase().replace(/\s+/g, " ")}:${JSON.stringify(reward ?? null)}`;
  return createHash("sha256").update(stable).digest("hex").slice(0, 24);
}

function booleanMetadata(metadata: Record<string, unknown>, key: string): boolean {
  return metadata[key] === true;
}

function numberMetadata(metadata: Record<string, unknown>, key: string): number {
  return typeof metadata[key] === "number" && Number.isFinite(metadata[key]) && metadata[key] >= 0 ? metadata[key] : 0;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
