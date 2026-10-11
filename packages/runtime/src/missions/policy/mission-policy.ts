import type { ToolRisk, ToolSideEffect } from "@beyonder/tools";
import type { MissionContract, MissionNode, MissionState, MissionNodeAction } from "../contracts/mission.js";
import { isTerminalMissionState } from "../state-machine/mission-state-machine.js";

/**
 * Mission policy engine — deterministic runtime decisions (ADR 0010).
 * Small and focused: action allowed? transition allowed? capability allowed?
 * No LLM involvement in any of these decisions.
 */
export interface MissionPolicyDecision {
  allowed: boolean;
  reason?: string;
}

const RISK_SEVERITY: Record<ToolRisk, number> = {
  NONE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4
};

const SIDE_EFFECT_SEVERITY: Record<ToolSideEffect, number> = {
  NONE: 0,
  READ: 1,
  WRITE: 2,
  EXTERNAL_ACTION: 3,
  FINANCIAL: 4,
  SYSTEM: 5
};

export class MissionPolicyEngine {
  constructor(
    private readonly resolveCapability: (capabilityId: string) =>
      | { risk: ToolRisk; sideEffectLevel: ToolSideEffect; requiresApproval: boolean }
      | undefined
  ) {}

  canTransition(from: MissionState, to: MissionState): MissionPolicyDecision {
    if (isTerminalMissionState(from)) {
      return { allowed: false, reason: `Mission is terminal (${from}); no transitions allowed.` };
    }
    return { allowed: true };
  }

  actionAllowed(contract: MissionContract, node: MissionNode, action: MissionNodeAction): MissionPolicyDecision {
    // Invariant 11: cancelled missions start no new actions.
    if (contract.id !== node.missionId) {
      return { allowed: false, reason: "Node does not belong to this mission." };
    }

    if (action.kind === "EXTERNAL_ACTION") {
      if (contract.autonomyLevel === "READ_ONLY") {
        return { allowed: false, reason: "Mission autonomy level READ_ONLY forbids external actions." };
      }
      if (contract.autonomyLevel === "PREPARE_ONLY") {
        return { allowed: false, reason: "Mission autonomy level PREPARE_ONLY: external actions may be prepared but not committed." };
      }
      const capability = this.resolveCapability(action.capabilityId);
      if (!capability) {
        return { allowed: false, reason: `Capability '${action.capabilityId}' is not resolvable.` };
      }
      if (RISK_SEVERITY[capability.risk] > RISK_SEVERITY[contract.constraints.maxRiskLevel]) {
        return { allowed: false, reason: `Capability risk ${capability.risk} exceeds mission max ${contract.constraints.maxRiskLevel}.` };
      }
      if (SIDE_EFFECT_SEVERITY[capability.sideEffectLevel] > SIDE_EFFECT_SEVERITY[contract.constraints.maxSideEffectLevel]) {
        return { allowed: false, reason: `Capability side effect ${capability.sideEffectLevel} exceeds mission max ${contract.constraints.maxSideEffectLevel}.` };
      }
      if (capability.requiresApproval && contract.autonomyLevel !== "BOUNDED_AUTONOMOUS") {
        // BOUNDED_AUTONDOMOUS still requires approval for irreversible actions via graph APPROVAL nodes.
        return { allowed: true };
      }
    }

    if (action.kind === "CAPABILITY" || action.kind === "TOOL") {
      if (contract.constraints.forbiddenCapabilities?.length) {
        const forbidden = new Set(contract.constraints.forbiddenCapabilities);
        if (action.kind === "CAPABILITY" && forbidden.has(action.capabilityId)) {
          return { allowed: false, reason: `Capability '${action.capabilityId}' is forbidden by contract.` };
        }
      }
    }

    return { allowed: true };
  }

  nodeCanRun(contract: MissionContract, node: MissionNode): MissionPolicyDecision {
    if (node.attempt >= node.spec.maxAttempts) {
      return { allowed: false, reason: `Node '${node.id}' exhausted its attempt budget (${node.spec.maxAttempts}).` };
    }
    if (contract.constraints.deadlineAt && new Date(contract.constraints.deadlineAt).getTime() <= Date.now()) {
      return { allowed: false, reason: "Mission deadline has passed." };
    }
    return { allowed: true };
  }
}
