import type { IntelligenceTaskType, ModelCapabilityEvidence, ModelCapabilityRequest, ModelCapabilitySource, CapabilityDimension } from "@beyonder/runtime";
import { physicalModelIdentity } from "@beyonder/runtime";
import { BenchmarkStore } from "../persistence/store.js";
import type { BenchmarkCategory, BenchmarkSummary } from "../types.js";

const TASK_TO_BENCHMARK_CATEGORY: Partial<Record<IntelligenceTaskType, BenchmarkCategory>> = {
  chat: "synthesis",
  research: "research",
  browser: "research",
  reasoning: "reasoning",
  coding: "coding",
  planning: "planning",
  "tool-use": "tool-use",
  extraction: "extraction",
  compression: "compression",
  classification: "structured-output"
};

const DIMENSION_CATEGORIES: Record<CapabilityDimension, BenchmarkCategory> = { reasoning: "reasoning", planning: "planning", coding: "coding", research: "research", synthesis: "synthesis", toolUse: "tool-use", structuredOutput: "structured-output", verification: "verification", freshnessEvidence: "evidence-grounding" };

export class BibModelCapabilitySource implements ModelCapabilitySource {
  private readonly summaries: BenchmarkSummary[];
  private readonly unsafeVerifiers = new Map<string, { falseApprovals: number; lastFalseApprovalAt: string }>();

  constructor(benchmarkStore: BenchmarkStore) {
    try {
      this.summaries = benchmarkStore.summaries();
      for (const result of benchmarkStore.listResults()) {
        // This explicit adjudication is distinct from a refusal, false
        // rejection, generic low score or an upstream failure. Neither a
        // provider alias nor a different sampling profile erases a known
        // unsafe physical judge. Original observations remain untouched.
        if (result.errorCode !== "VERIFIER_FALSE_APPROVAL" || result.status !== "FAIL" || result.quality !== 0 || result.success !== false || !["verification", "evidence-grounding"].includes(result.category)) continue;
        const identity = physicalModelIdentity(result.model);
        const previous = this.unsafeVerifiers.get(identity);
        const observedAt = result.timestamp.toISOString();
        this.unsafeVerifiers.set(identity, {
          falseApprovals: (previous?.falseApprovals ?? 0) + 1,
          lastFalseApprovalAt: previous && previous.lastFalseApprovalAt > observedAt ? previous.lastFalseApprovalAt : observedAt
        });
      }
    } finally {
      benchmarkStore.close();
    }
  }

  async getVerificationSafetyEvidence(model: string) {
    return this.unsafeVerifiers.get(physicalModelIdentity(model)) ?? null;
  }

  async listInferenceProfiles(input: Pick<ModelCapabilityRequest, "provider" | "model">): Promise<string[]> {
    // Only real evaluated profiles can be considered. A repeated easy case or
    // an operational failure alone never establishes an inference capability.
    return [...new Set(this.summaries.filter(entry => entry.provider === input.provider && entry.model === input.model && entry.avgQuality != null && (entry.distinctEvaluatedCases ?? 0) >= 2).flatMap(entry => entry.inferenceProfile ? [entry.inferenceProfile] : []))];
  }

  async getCapability(input: ModelCapabilityRequest): Promise<ModelCapabilityEvidence | null> {
    const category = TASK_TO_BENCHMARK_CATEGORY[input.taskType];
    const all = this.summaries.filter(entry => entry.provider === input.provider && entry.model === input.model && (!input.inferenceProfile || entry.inferenceProfile === input.inferenceProfile));
    const matching = all.filter(entry => entry.avgQuality != null && entry.evaluatedSamples > 0);
    const dimensions: NonNullable<ModelCapabilityEvidence["dimensions"]> = {};
    for (const [dimension, category] of Object.entries(DIMENSION_CATEGORIES) as Array<[CapabilityDimension, BenchmarkCategory]>) {
      const observed = matching.find(entry => entry.category === category);
      if (observed && observed.evaluatedSamples >= 2 && (observed.distinctEvaluatedCases ?? 0) >= 2) dimensions[dimension] = { score: observed.avgQuality!, samples: observed.evaluatedSamples, updatedAt: observed.lastTestedAt.toISOString() };
    }
    const summary = matching.find(entry => entry.category === category);
    if (!summary || summary.avgQuality == null || summary.evaluatedSamples === 0) return null;
    const required = (input.dimensions ?? []).flatMap(dimension => dimensions[dimension] ? [dimensions[dimension]!] : []);
    return {
      score: Math.min(summary.avgQuality, ...required.map(entry => entry.score)),
      samples: summary.evaluatedSamples,
      source: "BIB",
      updatedAt: summary.lastTestedAt.toISOString(),
      latencyMs: summary.medianLatency ?? undefined,
      inferenceProfile: summary.inferenceProfile,
      structuredOutputMode: dimensions.structuredOutput ? matching.find(entry => entry.category === "structured-output")?.structuredOutputMode : undefined,
      operational: { samples: all.reduce((total, entry) => total + entry.evaluatedSamples + entry.operationalFailures, 0), failures: all.reduce((total, entry) => total + entry.operationalFailures, 0), lastSuccessfulRequestAt: matching.length ? new Date(Math.max(...matching.map(entry => entry.lastEvaluatedAt!.getTime()))).toISOString() : undefined },
      dimensions
    };
  }

  async getCapabilityScore(input: ModelCapabilityRequest): Promise<number | null> {
    return (await this.getCapability(input))?.score ?? null;
  }

  async getLastSuccessfulRequest(provider: string): Promise<{ model: string; observedAt: string } | null> {
    const latest = this.summaries.filter(entry => entry.provider === provider && entry.lastEvaluatedAt && entry.avgCost === 0)
      .sort((a, b) => b.lastEvaluatedAt!.getTime() - a.lastEvaluatedAt!.getTime())[0];
    return latest ? { model: latest.model, observedAt: latest.lastEvaluatedAt!.toISOString() } : null;
  }

  async getOperationalEvidence(input: Pick<ModelCapabilityRequest, "provider" | "model" | "inferenceProfile">): Promise<NonNullable<ModelCapabilityEvidence["operational"]> | null> {
    const all = this.summaries.filter(entry => entry.provider === input.provider && entry.model === input.model && (!input.inferenceProfile || entry.inferenceProfile === input.inferenceProfile));
    if (!all.length) return null;
    const successful = all.filter(entry => entry.lastEvaluatedAt);
    return { samples: all.reduce((sum, entry) => sum + entry.evaluatedSamples + entry.operationalFailures, 0), failures: all.reduce((sum, entry) => sum + entry.operationalFailures, 0), lastSuccessfulRequestAt: successful.length ? new Date(Math.max(...successful.map(entry => entry.lastEvaluatedAt!.getTime()))).toISOString() : undefined };
  }
}
