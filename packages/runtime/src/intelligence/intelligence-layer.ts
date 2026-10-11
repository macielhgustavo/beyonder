import { nanoid } from "nanoid";
import type { MemoryEngine, RetrievedMemory } from "../memory/memory-engine.js";
import type { IntelligenceResult, IntelligenceTask } from "./contracts.js";
import { ComplexityEstimator } from "./complexity-estimator.js";
import { TaskClassifier } from "./task-classifier.js";
import { analyzeGoalContract } from "./goal-contract.js";

export interface IntelligenceInspection extends IntelligenceResult {
  relevantMemories: RetrievedMemory[];
}

export class IntelligenceLayer {
  constructor(
    private readonly memory: MemoryEngine,
    private readonly classifier = new TaskClassifier(),
    private readonly complexity = new ComplexityEstimator()
  ) {}

  async inspect(input: string, limit = 6): Promise<IntelligenceInspection> {
    const type = this.classifier.classify(input);
    const goalContract = analyzeGoalContract(input, type);
    const estimate = this.complexity.estimate(input, type, goalContract);
    const task: IntelligenceTask = {
      id: `task_${nanoid()}`,
      input,
      type,
      complexity: estimate.complexity,
      risk: estimate.risk,
      estimatedTokens: estimate.estimatedTokens,
      requirements: estimate.requirements,
      goalContract
    };

    const relevantMemories = await this.memory.retrieve({ query: input, taskType: type, limit });
    const summary = relevantMemories.length === 0
      ? "No relevant prior memory."
      : relevantMemories.map((memory) => `${memory.kind}: ${memory.content}`).join("\n");

    return {
      task,
      relevantMemories,
      context: {
        memoryIds: relevantMemories.map((memory) => memory.id),
        summary: compact(summary, 1200)
      }
    };
  }
}

function compact(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  const head = input.slice(0, Math.floor(maxChars * 0.7)).trim();
  const tail = input.slice(-Math.floor(maxChars * 0.25)).trim();
  return `${head}\n...\n${tail}`;
}
