import type { ToolRisk, ToolSideEffect } from "@beyonder/tools";

/**
 * v0.7 Autonomy Kernel — Mission domain contracts.
 *
 * A Mission is a long-running, goal-directed unit of autonomous work. It is
 * distinct from a Task (the executable unit): a Mission composes N tasks,
 * verification stages, approval gates, waits, and decisions across a DAG.
 *
 * See docs/adr/0006-mission-vs-task.md.
 */

export const MISSION_SCHEMA_VERSION = 1;

/** How the mission originated. v0.8 attaches economic metadata to OPPORTUNITY missions. */
export type MissionOrigin =
  | { kind: "INTERNAL" }
  | { kind: "USER"; requestedBy?: string }
  | {
      kind: "OPPORTUNITY";
      opportunityId: string;
      workRunId?: string;
      economicMetadata?: Record<string, unknown>;
    };

/** Machine-checkable condition evaluated against observed state, artifacts and evidence. */
export interface MissionSuccessCriterion {
  id: string;
  /** Human-readable statement of what must hold. */
  description: string;
  /** Deterministic check kind; the verifier registry resolves implementations. */
  check:
    | { kind: "ARTIFACT_PRESENT"; artifactType: string }
    | { kind: "TEXT_MATCH"; artifactType: string; contains: string }
    | { kind: "JSON_FIELD"; artifactType: string; path: string[]; equals: unknown }
    | { kind: "EVIDENCE_PRESENT"; evidenceKind: string }
    | { kind: "CUSTOM"; verifierId: string; parameters?: Record<string, unknown> };
}

export interface MissionFailureCondition {
  id: string;
  description: string;
  check: MissionSuccessCriterion["check"];
}

/** Required evidence the mission must attach before it can succeed. */
export interface MissionEvidenceRequirement {
  /** e.g. BROWSER_CAPTURE, TOOL_OUTPUT, ARTIFACT_HASH, RECEIPT */
  evidenceKind: string;
  description: string;
  /** When true, mission cannot reach SUCCEEDED without this evidence attached. */
  required: boolean;
}

export type MissionAutonomyLevel =
  | "READ_ONLY"
  | "PREPARE_ONLY"
  | "APPROVAL_REQUIRED"
  | "BOUNDED_AUTONOMOUS";

/** Declarative specification of what the mission must achieve. */
export interface MissionContract {
  schemaVersion: number;
  id: string;
  objective: string;
  successCriteria: MissionSuccessCriterion[];
  failureConditions?: MissionFailureCondition[];
  requiredEvidence?: MissionEvidenceRequirement[];
  constraints: {
    deadlineAt?: string;
    maxDurationMs?: number;
    maxNodeAttempts: number;
    maxMissionReplans: number;
    maxRecoveryAttempts: number;
    /** Side-effect ceiling for the whole mission; enforced by policy engine. */
    maxSideEffectLevel: ToolSideEffect;
    maxRiskLevel: ToolRisk;
    allowedCapabilities?: string[];
    forbiddenCapabilities?: string[];
  };
  requiredApprovals?: string[];
  autonomyLevel: MissionAutonomyLevel;
  expectedArtifacts?: { artifactType: string; description: string }[];
  origin: MissionOrigin;
  createdAt: string;
}

/** Semantic node types. Deliberately small; avoid enum explosion. */
export type MissionNodeKind =
  | "RESEARCH"
  | "PLANNING"
  | "EXECUTE"
  | "VERIFY"
  | "APPROVAL"
  | "WAIT"
  | "TRANSFORM";

/** What a node intends to do — resolved by the runtime to a concrete implementation. */
export type MissionNodeAction =
  | { kind: "TOOL"; toolId: string; arguments?: Record<string, unknown> }
  | { kind: "CAPABILITY"; capabilityId: string; parameters?: Record<string, unknown> }
  | { kind: "TASK"; taskInput: string; taskType?: string }
  | { kind: "MODEL"; prompt: string; expectedOutputArtifactType?: string }
  | { kind: "EXTERNAL_ACTION"; capabilityId: string; parameters: Record<string, unknown>; idempotencyKey?: string }
  | { kind: "GATE"; approvalActionType: string }
  | { kind: "WAIT_FOR_INPUT"; prompt: string };

export interface MissionNodeSpec {
  id: string;
  kind: MissionNodeKind;
  description: string;
  action?: MissionNodeAction;
  dependsOn: string[];
  /** Capabilities this node requires to run (validated against capability graph). */
  requiredCapabilities?: string[];
  maxAttempts: number;
  optional?: boolean;
  expectedArtifactType?: string;
}

/** Planner output — always a PROPOSAL validated by the runtime (ADR 0010). */
export interface MissionPlanProposal {
  schemaVersion: number;
  missionId: string;
  revision: number;
  objective: string;
  nodes: MissionNodeSpec[];
  assumptions?: string[];
  proposedAt: string;
}

export type MissionState =
  | "CREATED"
  | "READY"
  | "RUNNING"
  | "WAITING_INPUT"
  | "WAITING_APPROVAL"
  | "WAITING_RESOURCE"
  | "WAITING_EXTERNAL"
  | "PAUSED"
  | "RECOVERING"
  | "REPLANNING"
  | "VERIFYING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export type MissionTerminalState = Extract<
  MissionState,
  "SUCCEEDED" | "FAILED" | "CANCELLED"
>;

export type MissionNodeState =
  | "PENDING"
  | "READY"
  | "RUNNING"
  | "WAITING"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED"
  | "CANCELLED";

/** Persisted outcome required for node completion (invariant 3). */
export interface MissionNodeOutcome {
  status: "COMPLETED" | "FAILED" | "SKIPPED";
  observationSummary: string;
  artifactType?: string;
  artifactRef?: string;
  evidenceIds?: string[];
  error?: string;
  completedAt: string;
}

export interface MissionNode {
  schemaVersion: number;
  missionId: string;
  id: string;
  spec: MissionNodeSpec;
  state: MissionNodeState;
  attempt: number;
  outcome?: MissionNodeOutcome;
}

/** Materialized mission state — derived from events, persisted as snapshot. */
export interface MissionSnapshot {
  schemaVersion: number;
  missionId: string;
  contract: MissionContract;
  planRevision: number;
  nodes: MissionNode[];
  state: MissionState;
  waitReason?: {
    kind: "INPUT" | "APPROVAL" | "RESOURCE" | "EXTERNAL" | "DEADLINE";
    detail: string;
    nodeId?: string;
    since: string;
  };
  replans: number;
  recoveryAttempts: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  failureReason?: string;
}

export interface MissionOutcomeReport {
  missionId: string;
  state: MissionTerminalState;
  success: boolean;
  failureReason?: string;
  satisfiedCriteria: string[];
  unsatisfiedCriteria: string[];
  evidenceIds: string[];
  artifactRefs: string[];
}
