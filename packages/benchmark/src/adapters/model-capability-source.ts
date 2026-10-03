import type { IntelligenceTaskType, ModelCapabilityEvidence, ModelCapabilityRequest, ModelCapabilitySource } from "@beyonder/runtime";
import { BenchmarkStore } from "../persistence/store.js";
import type { BenchmarkCategory } from "../types.js";

const TASK_TO_BENCHMARK_CATEGORY: Partial<Record<IntelligenceTaskType, BenchmarkCategory>> = {
  reasoning: "reasoning",
  coding: "coding",
  planning: "planning",
  "tool-use": "tool-use",
  extraction: "extraction",
  compression: "compression",
  classification: "structured-output"
};

export class BibModelCapabilitySource implements ModelCapabilitySource {
  constructor(private readonly benchmarkStore: BenchmarkStore) {}

  async getCapability(input: ModelCapabilityRequest): Promise<ModelCapabilityEvidence | null> {
    const category = TASK_TO_BENCHMARK_CATEGORY[input.taskType];
    if (!category) return null;
    const summary = this.benchmarkStore.getModelCapability({
      provider: input.provider,
      model: input.model,
      category
    });
    if (!summary || summary.avgQuality == null || summary.evaluatedSamples === 0) return null;
    return {
      score: summary.avgQuality,
      samples: summary.evaluatedSamples,
      source: "BIB",
      updatedAt: summary.lastTestedAt.toISOString()
    };
  }

  async getCapabilityScore(input: ModelCapabilityRequest): Promise<number | null> {
    return (await this.getCapability(input))?.score ?? null;
  }
}
