import { describe, expect, it } from "vitest";
import { ComplexityEstimator } from "../intelligence/complexity-estimator.js";
import type { IntelligenceTask, IntelligenceTaskType, ObjectiveIntent } from "../intelligence/contracts.js";
import { analyzeGoalContract } from "../intelligence/goal-contract.js";
import { TaskClassifier } from "../intelligence/task-classifier.js";
import { resolveQualityFloor } from "./compute-policy.js";

function inspect(input: string): IntelligenceTask {
  const classifier = new TaskClassifier();
  const estimator = new ComplexityEstimator();
  const type = classifier.classify(input);
  const goalContract = analyzeGoalContract(input, type);
  const estimate = estimator.estimate(input, type, goalContract);
  return {
    id: `journey-${type}`,
    input,
    type,
    complexity: estimate.complexity,
    risk: estimate.risk,
    estimatedTokens: estimate.estimatedTokens,
    requirements: estimate.requirements,
    goalContract
  };
}

const journeys: Array<{
  name: string;
  prompt: string;
  expectedType?: IntelligenceTaskType;
  expectedIntent?: ObjectiveIntent;
}> = [
  { name: "trivial response", prompt: "Answer briefly: what does immutable mean in programming?", expectedType: "chat" },
  { name: "calculation", prompt: "Calculate exactly 17 * 23.", expectedType: "tool-use" },
  { name: "current factual", prompt: "What is the current stable Python version? Use current official evidence.", expectedIntent: "FACTUAL" },
  { name: "multi-source research", prompt: "Research and compare the current leading TypeScript runtimes using at least three independent sources and cite evidence.", expectedIntent: "COMPARISON" },
  { name: "simple coding", prompt: "Implement a small TypeScript slugify function with tests.", expectedType: "coding" },
  { name: "hard coding", prompt: "Refactor a production TypeScript distributed job runner, reason about concurrency, retries, idempotency, durable state, failure recovery, architecture trade-offs, and implement tests.", expectedType: "coding" },
  { name: "planning", prompt: "Plan a migration strategy with milestones, dependencies, rollback steps and success criteria.", expectedType: "planning" },
  { name: "reasoning", prompt: "Analyze and derive the trade-offs between optimistic and pessimistic concurrency control and explain why each can fail.", expectedType: "reasoning" }
];

describe("requested cloud-first mission matrix", () => {
  for (const journey of journeys) {
    it(`${journey.name} produces a mission-aware quality floor`, () => {
      const task = inspect(journey.prompt);
      const floor = resolveQualityFloor(task);
      if (journey.expectedType) expect(task.type).toBe(journey.expectedType);
      if (journey.expectedIntent) expect(task.goalContract?.primaryIntent).toBe(journey.expectedIntent);
      expect(floor.minimumOverall).toBeGreaterThan(0);
      expect(floor.reasons.length).toBeGreaterThan(0);
      expect(Object.keys(floor.dimensions).length).toBeGreaterThan(0);
    });
  }

  it("current factual truth is gated by freshness and external evidence even if metadata classification is incidental", () => {
    const task = inspect(journeys.find((journey) => journey.name === "current factual")!.prompt);
    const floor = resolveQualityFloor(task);
    expect(task.goalContract).toMatchObject({ primaryIntent: "FACTUAL", freshness: "CURRENT", evidenceRequirement: "REQUIRED" });
    expect(task.goalContract?.requiredCapabilities).toEqual(expect.arrayContaining(["web-research", "browser-read"]));
    expect(floor.dimensions.research).toBeDefined();
    expect(floor.dimensions.freshnessEvidence).toBeDefined();
  });

  it("multi-source comparison raises a HIGH research, synthesis and freshness floor", () => {
    const task = inspect(journeys.find((journey) => journey.name === "multi-source research")!.prompt);
    const floor = resolveQualityFloor(task);
    expect(task.goalContract?.primaryIntent).toBe("COMPARISON");
    expect(task.goalContract?.evidenceRequirement).toBe("REQUIRED");
    expect(task.goalContract?.minimumEvidenceSources).toBeGreaterThanOrEqual(2);
    expect(floor.level).toBe("HIGH");
    expect(floor.dimensions.research).toBeDefined();
    expect(floor.dimensions.freshnessEvidence).toBeDefined();
    expect(floor.dimensions.synthesis).toBeDefined();
  });

  it("increases the floor monotonically when the same coding mission becomes more complex", () => {
    const simpleTask = inspect(journeys.find((journey) => journey.name === "simple coding")!.prompt);
    const simple = resolveQualityFloor(simpleTask);
    const harder = resolveQualityFloor({ ...simpleTask, id: "same-mission-harder", complexity: 0.95 });
    expect(harder.minimumOverall).toBeGreaterThanOrEqual(simple.minimumOverall);
    expect(harder.dimensions.coding).toBeDefined();
  });
});
