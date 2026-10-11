import type { MissionNode, MissionNodeState, MissionSnapshot } from "../contracts/mission.js";
import { isTerminalMissionState } from "../state-machine/mission-state-machine.js";

/**
 * Basic scheduler: picks READY nodes whose dependencies are satisfied.
 * Sequential for v0.7 Foundation; parallelism enabled later via DAG.
 */
export interface MissionSchedulerOptions {
  /** Maximum concurrent nodes — 1 for Foundation. */
  maxConcurrency: number;
}

export interface ReadyNode extends MissionNode {
  /** Node is READY: dependencies COMPLETED, not terminal, policy allows. */
}

export class MissionScheduler {
  private readonly maxConcurrency: number;

  constructor(options: MissionSchedulerOptions = { maxConcurrency: 1 }) {
    this.maxConcurrency = Math.max(1, options.maxConcurrency);
  }

  /** Returns up to maxConcurrency nodes that are READY to run. */
  pickReadyNodes(snapshot: MissionSnapshot): ReadyNode[] {
    if (isTerminalMissionState(snapshot.state)) return [];
    // Waiting and paused missions run nothing until resumed.
    if (snapshot.state.startsWith("WAITING") || snapshot.state === "PAUSED") return [];

    const completed = new Set(
      snapshot.nodes.filter((n) => n.state === "COMPLETED").map((n) => n.id)
    );
    const running = snapshot.nodes.filter((n) => n.state === "RUNNING");

    if (running.length >= this.maxConcurrency) return [];

    const ready: ReadyNode[] = [];
    for (const node of snapshot.nodes) {
      if (node.state !== "PENDING") continue;
      const depsMet = node.spec.dependsOn.every((dep) => completed.has(dep));
      if (!depsMet) continue;

      // Check for optional failed dependencies — optional nodes may skip failed deps.
      const hasOptionalFailedDep = node.spec.dependsOn.some((dep) => {
        const depNode = snapshot.nodes.find((n) => n.id === dep);
        return depNode?.spec.optional === true && depNode.state === "FAILED";
      });
      if (!depsMet && !hasOptionalFailedDep) continue;

      ready.push(node as ReadyNode);
      if (ready.length >= this.maxConcurrency) break;
    }
    return ready;
  }

  /** Node finished — mark it and check for dependent nodes becoming ready. */
  markNodeCompleted(snapshot: MissionSnapshot, nodeId: string, outcome: MissionSnapshot["nodes"][0]["outcome"]): void {
    const node = snapshot.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    node.state = "COMPLETED";
    node.outcome = outcome;
  }

  markNodeFailed(snapshot: MissionSnapshot, nodeId: string, error: string): void {
    const node = snapshot.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    node.state = "FAILED";
    node.outcome = { status: "FAILED", observationSummary: error, error, completedAt: new Date().toISOString() };
  }

  markNodeSkipped(snapshot: MissionSnapshot, nodeId: string): void {
    const node = snapshot.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    node.state = "SKIPPED";
    node.outcome = { status: "SKIPPED", observationSummary: "Skipped due to optional failed dependency.", completedAt: new Date().toISOString() };
  }
}