/**
 * v0.7 Autonomy Kernel — public module exports.
 * See docs/v07-autonomy-kernel-architecture.md.
 */
export type {
  MissionContract,
  MissionOrigin,
  MissionSuccessCriterion,
  MissionFailureCondition,
  MissionEvidenceRequirement,
  MissionAutonomyLevel,
  MissionNode,
  MissionNodeKind,
  MissionNodeAction,
  MissionNodeSpec,
  MissionNodeState,
  MissionNodeOutcome,
  MissionPlanProposal,
  MissionSnapshot,
  MissionState,
  MissionTerminalState,
  MissionOutcomeReport
} from "./contracts/mission.js";
export { MISSION_SCHEMA_VERSION } from "./contracts/mission.js";
export {
  validateMissionPlan,
  findCycles,
  MISSION_NODE_KINDS
} from "./contracts/plan-validation.js";
export type {
  MissionPlanValidationCode,
  MissionPlanValidationIssue,
  MissionPlanValidationResult,
  MissionPlanValidationContext
} from "./contracts/plan-validation.js";
export {
  assertMissionStateTransition,
  canTransition,
  isTerminalMissionState,
  InvalidMissionStateTransitionError,
  TERMINAL_MISSION_STATES
} from "./state-machine/mission-state-machine.js";
export type { MissionEvent, MissionEventType, MissionEventStore } from "./events/mission-events.js";
export { MISSION_EVENT_SCHEMA_VERSION } from "./events/mission-events.js";
export type {
  EvidenceRecord,
  EvidenceProvenance,
  EvidenceTrust,
  ClaimEvidenceRelation,
  ClaimRelation,
  EvidenceStore
} from "./evidence/evidence.js";
export { EVIDENCE_SCHEMA_VERSION, hashContent, evidenceFromBrowserCapture } from "./evidence/evidence.js";
export type {
  ActionIntent,
  ActionReceipt,
  ActionReceiptState,
  ActionSideEffectLevel,
  ActionStore
} from "./actions/action-protocol.js";
export { ACTION_INTENT_SCHEMA_VERSION } from "./actions/action-protocol.js";
export type {
  CapabilityContract,
  CapabilityImplementation,
  CapabilityAvailability,
  CapabilityResolver,
  ResolvedCapability,
  Reversibility
} from "./capabilities/capabilities.js";
export { CAPABILITY_SCHEMA_VERSION, ToolBackedCapabilityResolver } from "./capabilities/capabilities.js";
export type {
  MissionFailureClass,
  MissionRecoveryAction,
  MissionRecoveryRequest,
  MissionRecoveryDecision
} from "./recovery/mission-recovery.js";
export { DefaultMissionRecoveryPolicy } from "./recovery/mission-recovery.js";
export type {
  ResourceAuthority,
  ResourceRequest,
  ResourceDecision,
  ResourceRequestKind
} from "./policy/resource-authority.js";
export { UnboundedLocalResourceAuthority, DeadlineResourceAuthority } from "./policy/resource-authority.js";
export { MissionPolicyEngine } from "./policy/mission-policy.js";
export type { MissionPolicyDecision } from "./policy/mission-policy.js";
export { MissionScheduler } from "./scheduler/mission-scheduler.js";
export type { MissionSchedulerOptions, ReadyNode } from "./scheduler/mission-scheduler.js";
export {
  SqliteMissionStore,
  SqliteMissionEventStore,
  SqliteEvidenceStore,
  SqliteActionStore,
  SqliteCapabilityStore
} from "./store/mission-store.js";
export type { MissionStore } from "./store/mission-store.js";