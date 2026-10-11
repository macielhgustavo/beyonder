import { nanoid } from "nanoid";
import { ToolRisk, ToolSideEffect } from "@beyonder/tools";
import type { IntelligenceTask } from "../../intelligence/contracts.js";
import type {
  MissionContract,
  MissionPlanProposal,
  MissionNodeSpec,
  MissionOrigin,
  MissionAutonomyLevel
} from "../contracts/mission.js";
import { validateMissionPlan } from "../contracts/plan-validation.js";

/**
 * Task → Mission adaptation layer (ADR 0006).
 *
 * v0.5 Tasks keep working unchanged: each Task can be lifted into a
 * single-node Mission with a VERIFY stage so its output still goes
 * through the kernel's evidence and completion semantics. Legacy callers
 * that never see Missions are unaffected; new runtime code can treat
 * everything uniformly.
 *
 * The produced contract is deliberately conservative:
 * - READ_ONLY autonomy unless the task declares tool use
 * - approval gates stay with the task layer (autonomy level does not
 *   silently upgrade a task into committing external actions)
 * - max attempts mirror the runtime's existing bounded retry policy
 */
export interface TaskMissionAdapterOptions {
  /** Override the derived autonomy level (never loosens below READ_ONLY unless explicitly set). */
  autonomyLevel?: MissionAutonomyLevel;
  /** Origin metadata attached to the derived mission. */
  origin?: MissionOrigin;
  maxNodeAttempts?: number;
  maxMissionReplans?: number;
  now?: () => Date;
}

/** Derive a MissionContract from a v0.5 IntelligenceTask. */
export function taskToMissionContract(
  task: IntelligenceTask,
  options: TaskMissionAdapterOptions = {}
): MissionContract {
  const now = (options.now ?? (() => new Date))();
  const usesTools = Boolean(task.requirements.toolUse) || Boolean(task.requirements.browser);

  return {
    schemaVersion: 1,
    id: `mission-from-task-${task.id}-${nanoid(8)}`,
    objective: task.input,
    successCriteria: [
      {
        id: "task-output-produced",
        description: "The task produced a primary output artifact.",
        check: { kind: "ARTIFACT_PRESENT", artifactType: "TASK_OUTPUT" }
      }
    ],
    requiredEvidence: [
      { evidenceKind: "TASK_OUTPUT", description: "Primary task output.", required: true }
    ],
    constraints: {
      maxNodeAttempts: options.maxNodeAttempts ?? 3,
      maxMissionReplans: options.maxMissionReplans ?? 1,
      maxRecoveryAttempts: 1,
      maxSideEffectLevel: usesTools ? ToolSideEffect.READ : ToolSideEffect.NONE,
      maxRiskLevel: ToolRisk.LOW
    },
    autonomyLevel: options.autonomyLevel ?? (usesTools ? "READ_ONLY" : "PREPARE_ONLY"),
    expectedArtifacts: [
      { artifactType: "TASK_OUTPUT", description: "The task's primary output." }
    ],
    origin: options.origin ?? { kind: "INTERNAL" },
    createdAt: now.toISOString()
  };
}

/** Derive a two-node plan (EXECUTE then VERIFY) from a task. */
export function taskToMissionPlan(
  contract: MissionContract,
  task: IntelligenceTask
): MissionPlanProposal {
  const nodes: MissionNodeSpec[] = [
    {
      id: `${contract.id}-execute`,
      kind: "EXECUTE",
      description: task.input,
      action: { kind: "TASK", taskInput: task.input, taskType: task.type },
      dependsOn: [],
      maxAttempts: contract.constraints.maxNodeAttempts,
      expectedArtifactType: "TASK_OUTPUT"
    },
    {
      id: `${contract.id}-verify`,
      kind: "VERIFY",
      description: "Verify the task output against the contract's success criteria.",
      dependsOn: [`${contract.id}-execute`],
      maxAttempts: 1
    }
  ];

  return {
    schemaVersion: 1,
    missionId: contract.id,
    revision: 1,
    objective: contract.objective,
    nodes,
    assumptions: ["Task input is already normalized by the IntelligenceLayer."],
    proposedAt: new Date().toISOString()
  };
}

/**
 * Full lift: contract + validated plan proposal.
 * Throws if the derived plan fails kernel validation — a sign the
 * adapter itself is buggy, since it generates the plan.
 */
export function liftTaskToMission(
  task: IntelligenceTask,
  options: TaskMissionAdapterOptions & { validateAgainst?: { capabilities: string[] } } = {}
): { contract: MissionContract; plan: MissionPlanProposal } {
  const contract = taskToMissionContract(task, options);
  const plan = taskToMissionPlan(contract, task);

  const validation = validateMissionPlan(plan, {
    contract,
    availableCapabilities: options.validateAgainst?.capabilities ?? [],
    forbiddenCapabilities: new Set(contract.constraints.forbiddenCapabilities ?? []),
    grantableApprovalTypes: new Set(contract.requiredApprovals ?? []),
    maxNodes: 64
  });

  if (!validation.valid) {
    throw new Error(
      `Task→Mission adapter produced an invalid plan: ${validation.issues
        .map((i) => `${i.code}: ${i.message}`)
        .join("; ")}`
    );
  }

  return { contract, plan };
}
