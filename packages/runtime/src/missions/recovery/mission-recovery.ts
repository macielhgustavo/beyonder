/**
 * Recovery taxonomy and bounded policies (ADR 0012).
 *
 * Each failure class maps to a bounded decision. Policy blocks are never
 * bypassed; budgets cap all recovery attempts.
 */
export type MissionFailureClass =
  | "TRANSIENT"
  | "CAPABILITY_LOSS"
  | "BAD_OUTPUT"
  | "VERIFICATION_FAILURE"
  | "EXTERNAL_STATE_CHANGED"
  | "AUTH_REQUIRED"
  | "APPROVAL_REQUIRED"
  | "INPUT_REQUIRED"
  | "DEADLINE"
  | "RESOURCE_EXHAUSTED"
  | "POLICY_BLOCK"
  | "UNKNOWN_OUTCOME";

export type MissionRecoveryAction =
  | "RETRY_NODE"
  | "RESOLVE_CAPABILITY"
  | "REVISE_OUTPUT"
  | "LOCAL_REPAIR"
  | "SUBGRAPH_REPLAN"
  | "GLOBAL_REPLAN"
  | "WAIT_FOR_INPUT"
  | "WAIT_FOR_APPROVAL"
  | "WAIT_FOR_CREDENTIAL"
  | "RECONCILE_ACTION"
  | "FAIL_MISSION"
  | "NO_ACTION";

export interface MissionRecoveryRequest {
  missionId: string;
  nodeId: string;
  failureClass: MissionFailureClass;
  attempt: number;
  maxAttempts: number;
  missionReplans: number;
  maxMissionReplans: number;
  detail: string;
}

export interface MissionRecoveryDecision {
  action: MissionRecoveryAction;
  reason: string;
}

export class DefaultMissionRecoveryPolicy {
  decide(request: MissionRecoveryRequest): MissionRecoveryDecision {
    if (request.failureClass === "POLICY_BLOCK") {
      return { action: "FAIL_MISSION", reason: "Policy blocked the action; recovery must not bypass policy." };
    }
    if (request.failureClass === "DEADLINE") {
      return { action: "FAIL_MISSION", reason: "Mission deadline exceeded." };
    }
    if (request.failureClass === "APPROVAL_REQUIRED") {
      return { action: "WAIT_FOR_APPROVAL", reason: "Node requires a valid approval before continuing." };
    }
    if (request.failureClass === "INPUT_REQUIRED") {
      return { action: "WAIT_FOR_INPUT", reason: "Node requires human input; mission waits without failing." };
    }
    if (request.failureClass === "AUTH_REQUIRED") {
      return { action: "WAIT_FOR_CREDENTIAL", reason: "Capability is waiting for credentials." };
    }
    if (request.failureClass === "UNKNOWN_OUTCOME") {
      return { action: "RECONCILE_ACTION", reason: "External outcome is unknown; reconcile before any retry." };
    }
    if (request.failureClass === "RESOURCE_EXHAUSTED") {
      return { action: "FAIL_MISSION", reason: "Resource envelope is exhausted." };
    }

    if (request.attempt >= request.maxAttempts) {
      return request.missionReplans < request.maxMissionReplans
        ? { action: "SUBGRAPH_REPLAN", reason: "Node attempts exhausted; bounded subgraph replan." }
        : { action: "FAIL_MISSION", reason: "Node attempts and mission replan budget exhausted." };
    }

    switch (request.failureClass) {
      case "TRANSIENT":
        return { action: "RETRY_NODE", reason: "Transient failure; bounded retry." };
      case "CAPABILITY_LOSS":
        return { action: "RESOLVE_CAPABILITY", reason: "Try an alternate capability implementation." };
      case "BAD_OUTPUT":
        return { action: "REVISE_OUTPUT", reason: "Revise the failed output with a bounded attempt." };
      case "VERIFICATION_FAILURE":
        return { action: "LOCAL_REPAIR", reason: "Verification failed; attempt bounded local repair." };
      case "EXTERNAL_STATE_CHANGED":
        return request.missionReplans < request.maxMissionReplans
          ? { action: "SUBGRAPH_REPLAN", reason: "External state changed; replan the affected subgraph." }
          : { action: "FAIL_MISSION", reason: "External state changed and replan budget is exhausted." };
      default:
        return { action: "FAIL_MISSION", reason: `Failure class ${request.failureClass} has no bounded recovery.` };
    }
  }
}
