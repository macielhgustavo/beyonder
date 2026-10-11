/**
 * Evidence primitives (ADR 0011).
 *
 * Evidence is a first-class runtime entity: an immutable record of an
 * observation with provenance. Verifiers consume persisted evidence —
 * never free-floating prompt text — so v0.8 settlement and v0.9 audit
 * can re-verify against the original artifact.
 */
import { createHash } from "node:crypto";

export const EVIDENCE_SCHEMA_VERSION = 1;

export type EvidenceProvenance =
  | { kind: "BROWSER"; url: string; excerpt: string; contentHash: string }
  | { kind: "TOOL"; toolId: string; requestId: string; responseSummary: string }
  | { kind: "FILE"; path: string; contentHash: string }
  | { kind: "MODEL"; provider: string; model: string; contentHash: string }
  | { kind: "RECEIPT"; actionIntentId: string; receiptId: string }
  | { kind: "OPERATOR"; operatorId?: string; notes?: string };

export type EvidenceTrust = "UNTRUSTED" | "SEMI_TRUSTED" | "TRUSTED";

export type ClaimRelation =
  | "SUPPORTED"
  | "CONTRADICTED"
  | "PARTIALLY_SUPPORTED"
  | "NOT_IN_EVIDENCE";

export interface EvidenceRecord {
  schemaVersion: number;
  id: string;
  missionId: string;
  nodeId?: string;
  /** e.g. BROWSER_CAPTURE, TOOL_OUTPUT, ARTIFACT_HASH, RECEIPT, OPERATOR_CONFIRMATION */
  evidenceKind: string;
  description: string;
  provenance: EvidenceProvenance;
  contentHash: string;
  trust: EvidenceTrust;
  confidence: number;
  recordedAt: string;
  artifactRef?: string;
}

/** Relation between a mission claim and the evidence that supports (or refutes) it. */
export interface ClaimEvidenceRelation {
  missionId: string;
  claimId: string;
  claim: string;
  evidenceId: string;
  relation: ClaimRelation;
  assessedAt: string;
}

export interface EvidenceStore {
  attach(evidence: EvidenceRecord): Promise<void>;
  get(evidenceId: string): Promise<EvidenceRecord | undefined>;
  listByMission(missionId: string): Promise<EvidenceRecord[]>;
  relateClaim(relation: ClaimEvidenceRelation): Promise<void>;
  claimRelations(missionId: string, claimId: string): Promise<ClaimEvidenceRelation[]>;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function evidenceFromBrowserCapture(input: {
  missionId: string;
  nodeId?: string;
  url: string;
  excerpt: string;
  fullContent: string;
  evidenceKind?: string;
  trust?: EvidenceTrust;
  confidence?: number;
  recordedAt?: string;
}): EvidenceRecord {
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    id: `ev_${createHash("sha256")
      .update(`${input.missionId}:${input.url}:${input.fullContent.length}`)
      .digest("hex")
      .slice(0, 24)}`,
    missionId: input.missionId,
    nodeId: input.nodeId,
    evidenceKind: input.evidenceKind ?? "BROWSER_CAPTURE",
    description: `Browser capture from ${input.url}`,
    provenance: {
      kind: "BROWSER",
      url: input.url,
      excerpt: input.excerpt.slice(0, 2000),
      contentHash: hashContent(input.fullContent)
    },
    contentHash: hashContent(input.excerpt),
    trust: input.trust ?? "UNTRUSTED",
    confidence: input.confidence ?? 0.5,
    recordedAt: input.recordedAt ?? new Date().toISOString()
  };
}
