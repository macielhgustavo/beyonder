import type {
  MissionContract,
  MissionNodeKind,
  MissionNodeSpec,
  MissionPlanProposal
} from "./mission.js";

/** Typed validation issues, mirroring the PlanValidationIssue pattern in tasks/planner.ts. */
export type MissionPlanValidationCode =
  | "INVALID_PROPOSAL"
  | "EMPTY_PLAN"
  | "EXCESSIVE_PLAN_SIZE"
  | "DUPLICATE_NODE_ID"
  | "UNKNOWN_DEPENDENCY"
  | "CYCLE_DETECTED"
  | "UNKNOWN_CAPABILITY"
  | "FORBIDDEN_CAPABILITY"
  | "MISSING_APPROVAL_FOR_SIDE_EFFECT"
  | "UNSUPPORTED_NODE_ACTION"
  | "INVALID_NODE_KIND"
  | "DEADLINE_INFEASIBLE";

export interface MissionPlanValidationIssue {
  code: MissionPlanValidationCode;
  message: string;
  nodeId?: string;
}

export type MissionPlanValidationResult =
  | { valid: true; proposal: MissionPlanProposal }
  | { valid: false; issues: MissionPlanValidationIssue[] };

export interface MissionPlanValidationContext {
  /** Capability ids the runtime can currently resolve to implementations. */
  availableCapabilities: readonly string[];
  /** Capabilities explicitly forbidden by contract or global policy. */
  forbiddenCapabilities: ReadonlySet<string>;
  /** Approval action types the approval gate can grant. */
  grantableApprovalTypes: ReadonlySet<string>;
  maxNodes: number;
  contract: MissionContract;
}

export const MISSION_NODE_KINDS: ReadonlySet<MissionNodeKind> = new Set([
  "RESEARCH",
  "PLANNING",
  "EXECUTE",
  "VERIFY",
  "APPROVAL",
  "WAIT",
  "TRANSFORM"
]);

export function validateMissionPlan(
  proposal: unknown,
  context: MissionPlanValidationContext
): MissionPlanValidationResult {
  if (!isProposalShape(proposal)) {
    return invalid("INVALID_PROPOSAL", "Proposal must match the MissionPlanProposal schema.");
  }
  if (proposal.missionId !== context.contract.id) {
    return invalid("INVALID_PROPOSAL", "Proposal missionId does not match the mission contract.");
  }
  if (proposal.nodes.length === 0) {
    return invalid("EMPTY_PLAN", "Plan must include at least one node.");
  }
  if (proposal.nodes.length > context.maxNodes) {
    return invalid("EXCESSIVE_PLAN_SIZE", `Plan exceeds the configured maxNodes (${context.maxNodes}).`);
  }

  const issues: MissionPlanValidationIssue[] = [];
  const ids = new Set<string>();

  for (const node of proposal.nodes) {
    if (ids.has(node.id)) {
      issues.push({ code: "DUPLICATE_NODE_ID", message: `Duplicate node id '${node.id}'.`, nodeId: node.id });
    }
    ids.add(node.id);

    if (!MISSION_NODE_KINDS.has(node.kind)) {
      issues.push({ code: "INVALID_NODE_KIND", message: `Unknown node kind '${node.kind}'.`, nodeId: node.id });
    }

    for (const capability of node.requiredCapabilities ?? []) {
      if (context.forbiddenCapabilities.has(capability)) {
        issues.push({ code: "FORBIDDEN_CAPABILITY", message: `Capability '${capability}' is forbidden.`, nodeId: node.id });
      } else if (!context.availableCapabilities.includes(capability)) {
        issues.push({ code: "UNKNOWN_CAPABILITY", message: `Capability '${capability}' is not available.`, nodeId: node.id });
      }
    }

    if (node.action?.kind === "EXTERNAL_ACTION" || node.action?.kind === "CAPABILITY") {
      const capabilityId = node.action.capabilityId;
      if (context.forbiddenCapabilities.has(capabilityId)) {
        issues.push({ code: "FORBIDDEN_CAPABILITY", message: `Capability '${capabilityId}' is forbidden.`, nodeId: node.id });
      } else if (!context.availableCapabilities.includes(capabilityId)) {
        issues.push({ code: "UNKNOWN_CAPABILITY", message: `Capability '${capabilityId}' is not available.`, nodeId: node.id });
      }
    }

    if (node.action?.kind === "EXTERNAL_ACTION" && !hasApprovalNode(node, proposal.nodes)) {
      issues.push({
        code: "MISSING_APPROVAL_FOR_SIDE_EFFECT",
        message: "External action node requires an approval gate dependency.",
        nodeId: node.id
      });
    }

    if (node.action?.kind === "GATE" && !context.grantableApprovalTypes.has(node.action.approvalActionType)) {
      issues.push({
        code: "UNSUPPORTED_NODE_ACTION",
        message: `Approval type '${node.action.approvalActionType}' is not grantable.`,
        nodeId: node.id
      });
    }
  }

  for (const node of proposal.nodes) {
    for (const dependency of node.dependsOn) {
      if (!ids.has(dependency)) {
        issues.push({
          code: "UNKNOWN_DEPENDENCY",
          message: `Node '${node.id}' depends on missing node '${dependency}'.`,
          nodeId: node.id
        });
      }
    }
  }

  const cycles = findCycles(proposal.nodes);
  for (const cycle of cycles) {
    issues.push({ code: "CYCLE_DETECTED", message: `Dependency cycle: ${cycle.join(" -> ")}.` });
  }

  return issues.length ? { valid: false, issues } : { valid: true, proposal };
}

function hasApprovalNode(node: MissionNodeSpec, all: readonly MissionNodeSpec[]): boolean {
  // An external action is safe if it transitively depends on an APPROVAL node,
  // or if the mission autonomy level makes approvals optional — handled by the
  // policy engine. Here we require a direct or transitive APPROVAL dependency.
  const visited = new Set<string>();
  const queue = [...node.dependsOn];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    const spec = all.find((candidate) => candidate.id === current);
    if (!spec) continue;
    if (spec.kind === "APPROVAL") return true;
    queue.push(...spec.dependsOn);
  }
  return false;
}

/** Kahn's algorithm — returns lists of node ids forming cycles, if any. */
export function findCycles(nodes: readonly MissionNodeSpec[]): string[][] {
  const inDegree = new Map<string, number>();
  const edges = new Map<string, string[]>();
  for (const node of nodes) {
    if (!inDegree.has(node.id)) inDegree.set(node.id, 0);
    for (const dependency of node.dependsOn) {
      edges.set(dependency, [...(edges.get(dependency) ?? []), node.id]);
      inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
    }
  }

  const queue = [...inDegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  const removed = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    removed.add(current);
    for (const dependent of edges.get(current) ?? []) {
      const degree = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, degree);
      if (degree === 0) queue.push(dependent);
    }
  }

  const cyclic = [...inDegree.keys()].filter((id) => !removed.has(id));
  if (cyclic.length === 0) return [];
  // Report the remaining strongly-approxy cycle set as one group.
  return [cyclic];
}

function invalid(code: MissionPlanValidationCode, message: string): MissionPlanValidationResult {
  return { valid: false, issues: [{ code, message }] };
}

function isProposalShape(value: unknown): value is MissionPlanProposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<MissionPlanProposal>;
  return typeof candidate.missionId === "string" &&
    typeof candidate.revision === "number" &&
    typeof candidate.objective === "string" &&
    typeof candidate.proposedAt === "string" &&
    Array.isArray(candidate.nodes) &&
    candidate.nodes.every(isNodeShape);
}

function isNodeShape(value: unknown): value is MissionNodeSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<MissionNodeSpec>;
  return typeof candidate.id === "string" &&
    typeof candidate.description === "string" &&
    Array.isArray(candidate.dependsOn) &&
    candidate.dependsOn.every((item) => typeof item === "string") &&
    typeof candidate.maxAttempts === "number" &&
    candidate.maxAttempts >= 1;
}
