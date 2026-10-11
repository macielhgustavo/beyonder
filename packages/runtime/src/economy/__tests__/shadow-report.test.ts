import { describe, expect, it } from "vitest";
import { ShadowReportGenerator } from "../shadow-report.js";
import type { ModelCandidate, RouteDecision } from "../../models/adaptive-types.js";
import type { IntelligenceTask } from "../../intelligence/contracts.js";

describe("Compute Economy — Shadow Report Generator", () => {
  const dummyTask: IntelligenceTask = {
    id: "task-test-1",
    type: "coding",
    complexity: 0.8,
    risk: 0.5,
    estimatedTokens: 2000,
    input: "test",
    requirements: { coding: true }
  };

  const dummyFreeCandidate: ModelCandidate = {
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    monetaryCostUsd: 0,
    shadowCostUsd: 0.001,
    latencyPenalty: 0.2,
    failureRisk: 0.05,
    predictedQuality: 0.75,
    historicalSuccess: 0.8,
    reliability: 0.9,
    effectiveResourceCost: 0.001,
    utility: 0.72,
    routingScore: 0.76,
    capabilities: ["text", "coding"],
    contextWindow: 128000,
    toolCalling: "yes",
    quota: {
      provider: "groq",
      health: "healthy",
      requestsPerMinute: 30,
      requestsPerDay: 14400,
      tokensPerMinute: 6000,
      tokensPerDay: 500000,
      requestQuotaTotal: "unknown",
      requestQuotaRemaining: "unknown",
      tokenQuotaTotal: "unknown",
      tokenQuotaRemaining: "unknown",
      resetAt: "unknown",
      lastUpdatedAt: "unknown"
    },
    performance: {
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      taskType: "coding",
      samples: 10,
      successes: 8,
      failures: 2,
      successRate: 0.8,
      avgEvaluationScore: 0.75,
      avgLatencyMs: 450,
      avgMonetaryCostUsd: 0,
      avgShadowCostUsd: 0.001,
      avgAttempts: 1
    },
    benchmarkCapability: null,
    capabilityEvidence: {
      bibScore: null,
      bibSamples: 0,
      realScore: 0.78,
      realSamples: 10,
      predictedScore: 0.75,
      source: "outcomes"
    },
    explanation: { positives: [], penalties: [], constraints: [] }
  };

  const dummyPaidCandidate: ModelCandidate = {
    ...dummyFreeCandidate,
    provider: "openrouter",
    model: "anthropic/claude-3.5-sonnet",
    monetaryCostUsd: 0.006,
    worstCaseCostUsd: 0.012,
    predictedQuality: 0.92,
    reliability: 0.96,
    utility: 0.85,
    routingScore: 0.89
  };

  it("records decisions and generates markdown and JSON summaries", () => {
    const generator = new ShadowReportGenerator();

    const decision: RouteDecision = {
      task: dummyTask,
      economicState: "normal",
      candidates: [dummyPaidCandidate, dummyFreeCandidate],
      selected: dummyFreeCandidate,
      explored: false,
      reason: "Shadow mode: executed best free candidate",
      shadowDecision: {
        shadowMode: true,
        shadowCandidate: dummyPaidCandidate,
        selectedCandidate: dummyFreeCandidate,
        estimatedPaidCostUsd: 0.006,
        worstCasePaidCostUsd: 0.012,
        utilityDifference: 0.13,
        whyPaidCandidateWon: "Higher quality and reliability justified estimated cost",
        whyNotSelectedForLive: "Shadow mode active: zero-cost invariant enforced"
      }
    };

    generator.record(decision);
    const summary = generator.generateSummary();

    expect(summary.totalDecisions).toBe(1);
    expect(summary.shadowPaidWonCount).toBe(1);
    expect(summary.hypotheticalSpendUsd).toBe(0.006);
    expect(summary.averageUtilityGain).toBe(0.13);
    expect(summary.providerBreakdown["openrouter"]?.count).toBe(1);

    const md = generator.generateMarkdownReport();
    expect(md).toContain("# Beyonder v0.6 — Shadow Paid Routing Report");
    expect(md).toContain("**Actual Monetary Spend:** **$0.0000**");
    expect(md).toContain("openrouter");
    expect(md).toContain("anthropic/claude-3.5-sonnet");
  });
});
