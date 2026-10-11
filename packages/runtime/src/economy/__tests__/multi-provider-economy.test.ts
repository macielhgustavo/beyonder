import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDatabase } from "../../db/client.js";
import { BudgetAccountant, derivePhaseCap } from "../budget-accountant.js";
import type { ResolvedComputeEconomy } from "../compute-economy-config.js";
import { Microdollars, ZERO_MICROS, usdToMicros, microsToUsd } from "../money.js";
import { EconomicLedger } from "../ledger.js";
import { runCandidates, InferenceError, type InferenceAttempt } from "../../models/inference.js";
import type { ModelCandidate } from "../../models/adaptive-types.js";
import type { ModelMessage, ModelResponse } from "../../types.js";
import { DefaultCostEstimator } from "../cost-estimator.js";
import type { PricingSnapshot } from "../pricing-registry.js";
import { SqlitePricingRegistry } from "../pricing-registry.js";
import { seedCatalogPricing } from "../catalog-pricing.js";
import { fixtureZeroCost } from "../../models/testing/zero-cost-fixture.js";
import { AdaptiveModelSelector } from "../../models/adaptive-selector.js";
import { MemoryStore } from "../../memory/memory-store.js";
import { MemoryEngine } from "../../memory/memory-engine.js";
import { MemoryPerformanceRepository } from "../../models/performance-repository.js";
import type { IntelligenceTask } from "../../intelligence/contracts.js";
import { resolveMonetaryReference, calculateUtility } from "../../models/utility.js";

describe("Phase 4: Full Multi-Provider Economy (V06_FULL_ECONOMY_READY)", () => {
  let sqlite: ReturnType<typeof openDatabase>["sqlite"];
  let db: ReturnType<typeof openDatabase>["db"];
  let ledger: EconomicLedger;
  let accountant: BudgetAccountant;
  let pricingRegistry: SqlitePricingRegistry;
  let memoryStore: MemoryStore;
  let memoryEngine: MemoryEngine;
  let performanceRepo: MemoryPerformanceRepository;
  const costEstimator = new DefaultCostEstimator();

  const boundedConfig: ResolvedComputeEconomy = {
    mode: "bounded",
    monthlyHardCapMicros: Microdollars.fromNumber(10_000_000), // $10.00
    dailyHardCapMicros: Microdollars.fromNumber(1_000_000), // $1.00
    defaultObjectiveHardCapMicros: Microdollars.fromNumber(100_000), // $0.10
    defaultObjectiveSoftTargetMicros: Microdollars.fromNumber(20_000), // $0.02
    maxSingleInferenceMicros: Microdollars.fromNumber(50_000), // $0.05
  };

  const openrouterPricing: PricingSnapshot = {
    id: "pricing_or_deepseek",
    provider: "openrouter",
    model: "deepseek/deepseek-chat",
    currency: "USD",
    inputPerMillion: usdToMicros(0.14),
    outputPerMillion: usdToMicros(0.28),
    cacheReadPerMillion: ZERO_MICROS,
    cacheWritePerMillion: ZERO_MICROS,
    requestFee: ZERO_MICROS,
    source: "openrouter_api",
    confidence: "high",
    effectiveAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString()
  };

  const geminiPricing: PricingSnapshot = {
    id: "pricing_gemini_pro",
    provider: "gemini",
    model: "gemini-1.5-pro",
    currency: "USD",
    inputPerMillion: usdToMicros(1.25),
    outputPerMillion: usdToMicros(5.00),
    cacheReadPerMillion: ZERO_MICROS,
    cacheWritePerMillion: ZERO_MICROS,
    requestFee: ZERO_MICROS,
    source: "provider_api",
    confidence: "high",
    effectiveAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString()
  };

  const groqPaidPricing: PricingSnapshot = {
    id: "pricing_groq_paid",
    provider: "groq",
    model: "llama-3.3-70b-versatile-paid",
    currency: "USD",
    inputPerMillion: usdToMicros(0.59),
    outputPerMillion: usdToMicros(0.79),
    cacheReadPerMillion: ZERO_MICROS,
    cacheWritePerMillion: ZERO_MICROS,
    requestFee: ZERO_MICROS,
    source: "provider_api",
    confidence: "high",
    effectiveAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString()
  };

  function createPaidCandidate(
    provider: string,
    model: string,
    pricing: PricingSnapshot,
    overrides: Partial<ModelCandidate> = {}
  ): ModelCandidate {
    const costEstimate = costEstimator.estimate({
      pricing,
      estimatedInputTokens: 500,
      maxOutputTokens: 1000
    });
    return {
      provider,
      model,
      costClass: "PAID",
      monetaryCostUsd: microsToUsd(costEstimate.estimatedCostMicros),
      worstCaseCostUsd: microsToUsd(costEstimate.worstCaseCostMicros),
      costEstimate,
      pricingSnapshot: pricing,
      capabilities: ["text", "coding"],
      contextWindow: 64_000,
      toolCalling: "yes",
      predictedQuality: 0.85,
      historicalSuccess: 0.9,
      reliability: 0.95,
      shadowCostUsd: 0.001,
      latencyPenalty: 0.2,
      failureRisk: 0.05,
      effectiveResourceCost: 0.002,
      utility: 0.88,
      quota: {
        provider,
        requestsPerMinute: 60,
        requestsPerDay: 1000,
        tokensPerMinute: 100_000,
        tokensPerDay: 1_000_000,
        requestQuotaTotal: 1000,
        requestQuotaRemaining: 950,
        tokenQuotaTotal: 1_000_000,
        tokenQuotaRemaining: 950_000,
        resetAt: "unknown",
        health: "healthy",
        lastUpdatedAt: new Date().toISOString()
      },
      performance: {
        provider,
        model,
        taskType: "coding",
        samples: 20,
        successes: 19,
        failures: 1,
        successRate: 0.95,
        avgEvaluationScore: 0.88,
        avgLatencyMs: 650,
        avgMonetaryCostUsd: 0.0004,
        avgShadowCostUsd: 0.001,
        avgAttempts: 1
      },
      benchmarkCapability: null,
      capabilityEvidence: {
        bibScore: null,
        bibSamples: 0,
        realScore: 0.88,
        realSamples: 20,
        predictedScore: 0.88,
        source: "outcomes"
      },
      explanation: {
        positives: [],
        penalties: [],
        constraints: []
      },
      ...overrides
    };
  }

  function createFreeCandidate(provider = "groq", model = "llama-3.3-70b-versatile"): ModelCandidate {
    return {
      provider,
      model,
      costClass: "FREE_TIER_ELIGIBLE",
      economics: fixtureZeroCost(provider, model),
      monetaryCostUsd: 0,
      worstCaseCostUsd: 0,
      capabilities: ["text", "coding"],
      contextWindow: 32_000,
      toolCalling: "yes",
      predictedQuality: 0.80,
      historicalSuccess: 0.85,
      reliability: 0.92,
      shadowCostUsd: 0.002,
      latencyPenalty: 0.25,
      failureRisk: 0.08,
      effectiveResourceCost: 0.002,
      utility: 0.82,
      quota: {
        provider,
        requestsPerMinute: 30,
        requestsPerDay: 1000,
        tokensPerMinute: 6000,
        tokensPerDay: 100_000,
        requestQuotaTotal: 1000,
        requestQuotaRemaining: 800,
        tokenQuotaTotal: 100_000,
        tokenQuotaRemaining: 80_000,
        resetAt: "unknown",
        health: "healthy",
        lastUpdatedAt: new Date().toISOString()
      },
      performance: {
        provider,
        model,
        taskType: "coding",
        samples: 25,
        successes: 21,
        failures: 4,
        successRate: 0.84,
        avgEvaluationScore: 0.80,
        avgLatencyMs: 400,
        avgMonetaryCostUsd: 0,
        avgShadowCostUsd: 0.002,
        avgAttempts: 1
      },
      benchmarkCapability: null,
      capabilityEvidence: {
        bibScore: null,
        bibSamples: 0,
        realScore: 0.80,
        realSamples: 25,
        predictedScore: 0.80,
        source: "outcomes"
      },
      explanation: {
        positives: [],
        penalties: [],
        constraints: []
      }
    };
  }

  beforeEach(() => {
    const opened = openDatabase(":memory:");
    sqlite = opened.sqlite;
    db = opened.db;
    ledger = new EconomicLedger(db);
    accountant = new BudgetAccountant(sqlite, boundedConfig, ledger);
    pricingRegistry = new SqlitePricingRegistry(sqlite);
    seedCatalogPricing(pricingRegistry);
    memoryStore = new MemoryStore(db);
    memoryEngine = new MemoryEngine(memoryStore);
    performanceRepo = new MemoryPerformanceRepository(memoryStore);
  });

  // --------------------------------------------------------------------------
  // Scenario 1: Multi-Provider Live Competition in Bounded Mode
  // --------------------------------------------------------------------------
  it("Scenario 1: Evaluates and dispatches across multiple paid cloud providers in bounded mode", async () => {
    const candidateOR = createPaidCandidate("openrouter", "deepseek/deepseek-chat", openrouterPricing, {
      utility: 0.88,
      predictedQuality: 0.85
    });
    const candidateGemini = createPaidCandidate("gemini", "gemini-1.5-pro", geminiPricing, {
      utility: 0.82,
      predictedQuality: 0.90
    });
    const candidateGroq = createPaidCandidate("groq", "llama-3.3-70b-versatile-paid", groqPaidPricing, {
      utility: 0.80,
      predictedQuality: 0.82
    });

    const messages: ModelMessage[] = [{ role: "user", content: "Solve optimization" }];
    const complete = vi.fn(async (_msgs, candidate: ModelCandidate): Promise<ModelResponse> => {
      return {
        content: `Solved by ${candidate.provider}`,
        provider: candidate.provider,
        model: candidate.model,
        estimatedCostUsd: 0.00035, // 350 micros
        attribution: { requestedModel: candidate.model, reportedModel: candidate.model },
        raw: {
          usage: { prompt_tokens: 500, completion_tokens: 1000, cost: 0.00035 }
        }
      };
    });

    const result = await runCandidates({
      taskId: "task-multi-1",
      stepId: "step-1",
      phase: "DIRECT_RESPONSE",
      taskType: "coding",
      messages,
      candidates: [candidateOR, candidateGemini, candidateGroq],
      maxCandidates: 3,
      maxMonetaryCostUsd: 0.05,
      maxShadowCostUsd: 0.01,
      maxDurationMs: 10_000,
      budgetAccountant: accountant,
      costEstimator,
      computeMode: "bounded",
      validate: (resp) => resp.content,
      complete
    });

    expect(result.value).toBe("Solved by openrouter");
    expect(result.candidate.provider).toBe("openrouter");
    expect(result.monetaryCostUsd).toBe(0.00035);

    const summary = accountant.summary();
    expect(summary.monthlySpentMicros).toBe(usdToMicros(0.00035));
    expect(summary.activeReservationsCount).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Scenario 2: Value-Aware Routine Task ($0.05 Reference Scaling)
  // --------------------------------------------------------------------------
  it("Scenario 2: Value-Aware Routing: Routine chat task ($0.05 reference) selects cost-effective model over expensive frontier", () => {
    const routineTask: Partial<IntelligenceTask> = {
      id: "task-routine-chat",
      type: "chat",
      complexity: 0.3
    };

    const ref = resolveMonetaryReference(routineTask);
    expect(ref).toBe(0.05);

    // Cheap paid model ($0.0003 cost, 0.78 quality)
    const utilityCheap = calculateUtility(
      {
        predictedQuality: 0.78,
        historicalSuccess: 1,
        reliability: 1,
        monetaryCostUsd: 0.0003,
        shadowCostUsd: 0.001,
        latencyPenalty: 0.1,
        failureRisk: 0.05
      },
      "normal",
      { monetaryReferenceUsd: ref }
    );

    // Expensive frontier model ($0.015 cost, 0.81 quality -> +3% marginal gain at 50x cost)
    const utilityExpensive = calculateUtility(
      {
        predictedQuality: 0.81,
        historicalSuccess: 1,
        reliability: 1,
        monetaryCostUsd: 0.015,
        shadowCostUsd: 0.001,
        latencyPenalty: 0.1,
        failureRisk: 0.05
      },
      "normal",
      { monetaryReferenceUsd: ref }
    );

    // Cheap model wins due to value-aware reference scaling
    expect(utilityCheap).toBeGreaterThan(utilityExpensive);
  });

  // --------------------------------------------------------------------------
  // Scenario 3: Value-Aware High-Complexity Task ($0.25 Reference Scaling)
  // --------------------------------------------------------------------------
  it("Scenario 3: Value-Aware Routing: High-complexity coding task ($0.25 reference) justifies premium frontier model", () => {
    const complexTask: Partial<IntelligenceTask> = {
      id: "task-complex-arch",
      type: "coding",
      complexity: 0.9,
      requirements: { coding: true, reasoning: true }
    };

    const ref = resolveMonetaryReference(complexTask);
    expect(ref).toBe(0.25);

    // Free/cheap model (quality 0.65 on this difficult challenge)
    const utilityStandard = calculateUtility(
      {
        predictedQuality: 0.65,
        historicalSuccess: 0.8,
        reliability: 0.9,
        monetaryCostUsd: 0,
        shadowCostUsd: 0.002,
        latencyPenalty: 0.2,
        failureRisk: 0.15
      },
      "normal",
      { monetaryReferenceUsd: ref }
    );

    // Premium model (Claude 3.5 Sonnet / GPT-4o with quality 0.95, cost $0.012)
    const utilityPremium = calculateUtility(
      {
        predictedQuality: 0.95,
        historicalSuccess: 0.95,
        reliability: 0.98,
        monetaryCostUsd: 0.012,
        shadowCostUsd: 0.001,
        latencyPenalty: 0.15,
        failureRisk: 0.03
      },
      "normal",
      { monetaryReferenceUsd: ref }
    );

    // Premium frontier model legitimately wins utility on high-complexity task
    expect(utilityPremium).toBeGreaterThan(utilityStandard);
  });

  // --------------------------------------------------------------------------
  // Scenario 4: Value-Aware Verification Task ($0.50 Reference Scaling)
  // --------------------------------------------------------------------------
  it("Scenario 4: Value-Aware Routing: Verification phase ($0.50 reference) prioritizes verifier confidence", () => {
    const verifierTask: Partial<IntelligenceTask> = {
      id: "task-verification",
      type: "reasoning",
      inferencePhase: "OBJECTIVE_VERIFICATION"
    };

    const ref = resolveMonetaryReference(verifierTask);
    expect(ref).toBe(0.50);

    const utilityVerifier = calculateUtility(
      {
        predictedQuality: 0.96,
        historicalSuccess: 0.98,
        reliability: 0.99,
        monetaryCostUsd: 0.015,
        shadowCostUsd: 0.001,
        latencyPenalty: 0.1,
        failureRisk: 0.02
      },
      "normal",
      { monetaryReferenceUsd: ref }
    );

    const utilityBudget = calculateUtility(
      {
        predictedQuality: 0.70,
        historicalSuccess: 0.75,
        reliability: 0.85,
        monetaryCostUsd: 0,
        shadowCostUsd: 0.001,
        latencyPenalty: 0.1,
        failureRisk: 0.12
      },
      "normal",
      { monetaryReferenceUsd: ref }
    );

    expect(utilityVerifier).toBeGreaterThan(utilityBudget);
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Multi-Provider Failover with Zero Spend Duplication (Invariant I-2)
  // --------------------------------------------------------------------------
  it("Scenario 5: Multi-Provider Failover: OpenRouter fails -> releases reserve -> Gemini succeeds -> no spend duplication", async () => {
    const candidateOR = createPaidCandidate("openrouter", "deepseek/deepseek-chat", openrouterPricing);
    const candidateGemini = createPaidCandidate("gemini", "gemini-1.5-pro", geminiPricing);

    let attemptsCount = 0;
    const complete = vi.fn(async (_msgs, candidate: ModelCandidate): Promise<ModelResponse> => {
      attemptsCount++;
      if (candidate.provider === "openrouter") {
        throw new InferenceError("OpenRouter 401 Unauthorized", "AUTH_REQUIRED", 401);
      }
      return {
        content: "Gemini recovered successfully",
        provider: candidate.provider,
        model: candidate.model,
        estimatedCostUsd: 0.0012, // 1200 micros
        attribution: { requestedModel: candidate.model, reportedModel: candidate.model },
        raw: {
          usage: { prompt_tokens: 500, completion_tokens: 1000, cost: 0.0012 }
        }
      };
    });

    const result = await runCandidates({
      taskId: "task-failover-1",
      stepId: "step-1",
      phase: "DIRECT_RESPONSE",
      taskType: "coding",
      messages: [{ role: "user", content: "test" }],
      candidates: [candidateOR, candidateGemini],
      maxCandidates: 2,
      maxMonetaryCostUsd: 0.05,
      maxShadowCostUsd: 0.01,
      maxDurationMs: 10_000,
      budgetAccountant: accountant,
      costEstimator,
      computeMode: "bounded",
      validate: (resp) => resp.content,
      complete
    });

    expect(attemptsCount).toBe(2);
    expect(result.candidate.provider).toBe("gemini");
    expect(result.value).toBe("Gemini recovered successfully");

    // Check reservations in database:
    // Reservation 1 (openrouter) -> RELEASED
    // Reservation 2 (gemini) -> SETTLED
    const reservations = accountant.listReservations({ taskId: "task-failover-1" });
    expect(reservations).toHaveLength(2);

    const orRes = reservations.find(r => r.provider === "openrouter");
    const geminiRes = reservations.find(r => r.provider === "gemini");

    expect(orRes?.state).toBe("RELEASED");
    expect(geminiRes?.state).toBe("SETTLED");
    expect(geminiRes?.actualCostMicros).toBe(usdToMicros(0.0012));

    // Summary reflects ONLY Gemini's actual cost
    const summary = accountant.summary();
    expect(summary.monthlySpentMicros).toBe(usdToMicros(0.0012));
    expect(summary.monthlyReservedMicros).toBe(ZERO_MICROS);
  });

  // --------------------------------------------------------------------------
  // Scenario 6: Producer Phase Budget Enforcement (60% Cap)
  // --------------------------------------------------------------------------
  it("Scenario 6: Phase Budget: Producer exceeding 60% of objective cap is rejected (Threat T-6)", async () => {
    // Objective cap: $0.01 (10,000 micros).
    // Producer cap = 60% = 6,000 micros ($0.006).
    accountant.setObjectiveHardCap("obj-producer-test", usdToMicros(0.01));

    expect(derivePhaseCap("producer", usdToMicros(0.01))).toBe(usdToMicros(0.006));

    // Request for 7,000 micros ($0.007) exceeds producer cap of 6,000 micros
    const canAffordExcess = accountant.canAfford(
      { objectiveId: "obj-producer-test", phase: "producer" },
      usdToMicros(0.007)
    );
    expect(canAffordExcess).toBe(false);

    // Request for 5,000 micros ($0.005) fits within producer cap
    const canAffordWithin = accountant.canAfford(
      { objectiveId: "obj-producer-test", phase: "producer" },
      usdToMicros(0.005)
    );
    expect(canAffordWithin).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Scenario 7: Verifier Phase Budget Enforcement (25% Cap)
  // --------------------------------------------------------------------------
  it("Scenario 7: Phase Budget: Verifier exceeding 25% of objective cap is rejected", () => {
    // Objective cap: $0.02 (20,000 micros).
    // Verifier cap = 25% = 5,000 micros ($0.005).
    accountant.setObjectiveHardCap("obj-verifier-test", usdToMicros(0.02));

    expect(derivePhaseCap("verifier", usdToMicros(0.02))).toBe(usdToMicros(0.005));

    // Request for 6,000 micros exceeds verifier cap
    expect(
      accountant.canAfford(
        { objectiveId: "obj-verifier-test", phase: "verifier" },
        usdToMicros(0.006)
      )
    ).toBe(false);

    // Request for 4,000 micros fits
    expect(
      accountant.canAfford(
        { objectiveId: "obj-verifier-test", phase: "verifier" },
        usdToMicros(0.004)
      )
    ).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Scenario 8: Recovery Phase Budget Enforcement (15% Cap)
  // --------------------------------------------------------------------------
  it("Scenario 8: Phase Budget: Replanning recovery exceeding 15% of objective cap is rejected", () => {
    // Objective cap: $0.02 (20,000 micros).
    // Recovery cap = 15% = 3,000 micros ($0.003).
    accountant.setObjectiveHardCap("obj-recovery-test", usdToMicros(0.02));

    expect(derivePhaseCap("recovery", usdToMicros(0.02))).toBe(usdToMicros(0.003));

    // Request for 4,000 micros exceeds recovery cap
    expect(
      accountant.canAfford(
        { objectiveId: "obj-recovery-test", phase: "recovery" },
        usdToMicros(0.004)
      )
    ).toBe(false);

    // Request for 2,500 micros fits
    expect(
      accountant.canAfford(
        { objectiveId: "obj-recovery-test", phase: "recovery" },
        usdToMicros(0.0025)
      )
    ).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Scenario 9: Operator-Configured Allowed Paid Providers Filter
  // --------------------------------------------------------------------------
  it("Scenario 9: Allowed Paid Providers: Blocks candidates from unapproved paid providers", async () => {
    const candidateOR = createPaidCandidate("openrouter", "deepseek/deepseek-chat", openrouterPricing);
    const candidateGemini = createPaidCandidate("gemini", "gemini-1.5-pro", geminiPricing);

    const complete = vi.fn(async (_msgs, candidate: ModelCandidate): Promise<ModelResponse> => {
      return {
        content: `Selected ${candidate.provider}`,
        provider: candidate.provider,
        model: candidate.model,
        estimatedCostUsd: 0.001,
        attribution: { requestedModel: candidate.model, reportedModel: candidate.model }
      };
    });

    // Whitelist only gemini
    const result = await runCandidates({
      taskId: "task-filter-1",
      stepId: "step-1",
      phase: "DIRECT_RESPONSE",
      taskType: "coding",
      messages: [{ role: "user", content: "test" }],
      candidates: [candidateOR, candidateGemini],
      maxCandidates: 2,
      maxMonetaryCostUsd: 0.05,
      maxShadowCostUsd: 0.01,
      maxDurationMs: 10_000,
      budgetAccountant: accountant,
      costEstimator,
      computeMode: "bounded",
      allowedPaidProviders: ["gemini"],
      validate: (resp) => resp.content,
      complete
    });

    // openrouter was blocked by whitelist; gemini was selected
    expect(result.candidate.provider).toBe("gemini");
    expect(result.value).toBe("Selected gemini");
  });

  // --------------------------------------------------------------------------
  // Scenario 10: Cost/Quality Learning — Positive Reinforcement
  // --------------------------------------------------------------------------
  it("Scenario 10: Cost/Quality Learning: Successful task outcomes update performance priors and improve ranking", async () => {
    // Record 3 successful high-score outcomes for groq llama-3.3-70b-versatile
    for (let i = 0; i < 3; i++) {
      await memoryStore.remember({
        kind: "economic",
        content: JSON.stringify({
          provider: "groq",
          model: "llama-3.3-70b-versatile",
          taskType: "coding",
          success: true,
          evaluationScore: 0.98
        }),
        importance: 3,
        confidence: 1,
        utility: 0.8,
        source: "agent-loop",
        taskId: `prior-task-${i}`,
        keywords: ["coding", "groq", "llama-3.3-70b-versatile"],
        metadata: {
          provider: "groq",
          model: "llama-3.3-70b-versatile",
          taskType: "coding",
          success: true,
          evaluationScore: 0.98,
          latencyMs: 350,
          monetaryCostUsd: 0,
          shadowCostUsd: 0.001,
          qualityEvaluated: true
        }
      });
    }

    const performance = await performanceRepo.get("groq", "llama-3.3-70b-versatile", "coding");
    expect(performance.samples).toBe(3);
    expect(performance.successRate).toBe(1.0);
    expect(performance.avgEvaluationScore).toBeCloseTo(0.98);

    // Prior without performance
    const utilityBase = calculateUtility(
      {
        predictedQuality: 0.80,
        historicalSuccess: 0.5,
        reliability: 0.8,
        monetaryCostUsd: 0,
        shadowCostUsd: 0.001,
        latencyPenalty: 0.1,
        failureRisk: 0.1
      },
      "normal"
    );

    // Utility with positive learned performance
    const utilityLearned = calculateUtility(
      {
        predictedQuality: 0.88, // elevated by performance
        historicalSuccess: performance.successRate, // 1.0 vs 0.5
        reliability: 0.95,
        monetaryCostUsd: 0,
        shadowCostUsd: 0.001,
        latencyPenalty: 0.1,
        failureRisk: 0.02
      },
      "normal"
    );

    expect(utilityLearned).toBeGreaterThan(utilityBase);
  });

  // --------------------------------------------------------------------------
  // Scenario 11: Cost/Quality Learning — Failure Penalty
  // --------------------------------------------------------------------------
  it("Scenario 11: Cost/Quality Learning: Failures penalize performance priors and degrade ranking", async () => {
    // Record 2 failed outcomes for an unreliable model
    for (let i = 0; i < 2; i++) {
      await memoryStore.remember({
        kind: "economic",
        content: JSON.stringify({
          provider: "test-provider",
          model: "unreliable-model",
          taskType: "coding",
          success: false,
          evaluationScore: 0.2
        }),
        importance: 4,
        confidence: 1,
        utility: 0.6,
        source: "agent-loop",
        taskId: `fail-task-${i}`,
        keywords: ["coding", "test-provider", "unreliable-model"],
        metadata: {
          provider: "test-provider",
          model: "unreliable-model",
          taskType: "coding",
          success: false,
          evaluationScore: 0.2,
          failureClass: "INVALID_OUTPUT",
          latencyMs: 1200,
          qualityEvaluated: true
        }
      });
    }

    const performance = await performanceRepo.get("test-provider", "unreliable-model", "coding");
    expect(performance.samples).toBe(2);
    expect(performance.successRate).toBe(0.0);
    expect(performance.failures).toBe(2);

    const utilityDegraded = calculateUtility(
      {
        predictedQuality: 0.55,
        historicalSuccess: performance.successRate, // 0.0
        reliability: 0.60,
        monetaryCostUsd: 0,
        shadowCostUsd: 0.001,
        latencyPenalty: 0.4,
        failureRisk: 0.4
      },
      "normal"
    );

    const utilityHealthy = calculateUtility(
      {
        predictedQuality: 0.80,
        historicalSuccess: 0.9,
        reliability: 0.95,
        monetaryCostUsd: 0,
        shadowCostUsd: 0.001,
        latencyPenalty: 0.1,
        failureRisk: 0.05
      },
      "normal"
    );

    expect(utilityHealthy).toBeGreaterThan(utilityDegraded);
  });

  // --------------------------------------------------------------------------
  // Scenario 12: Zero-Cost Mode Invariant I-6 under Multi-Provider Inventory
  // --------------------------------------------------------------------------
  it("Scenario 12: Zero-Cost Invariant I-6: Paid candidates across all providers strictly blocked when computeMode is zero_cost", async () => {
    const candidateOR = createPaidCandidate("openrouter", "deepseek/deepseek-chat", openrouterPricing);
    const candidateGemini = createPaidCandidate("gemini", "gemini-1.5-pro", geminiPricing);
    const candidateFree = createFreeCandidate("groq", "llama-3.3-70b-versatile");

    const complete = vi.fn(async (_msgs, candidate: ModelCandidate): Promise<ModelResponse> => {
      return {
        content: `Ran ${candidate.provider}`,
        provider: candidate.provider,
        model: candidate.model,
        estimatedCostUsd: 0,
        attribution: { requestedModel: candidate.model, reportedModel: candidate.model }
      };
    });

    const result = await runCandidates({
      taskId: "task-zero-cost-multi",
      stepId: "step-1",
      phase: "DIRECT_RESPONSE",
      taskType: "coding",
      messages: [{ role: "user", content: "test" }],
      candidates: [candidateOR, candidateGemini, candidateFree],
      maxCandidates: 3,
      maxMonetaryCostUsd: 0.0,
      maxShadowCostUsd: 0.01,
      maxDurationMs: 10_000,
      budgetAccountant: accountant,
      costEstimator,
      computeMode: "zero_cost", // Zero-cost mode
      validate: (resp) => resp.content,
      complete
    });

    // Both paid candidates blocked; free candidate selected
    expect(result.candidate.provider).toBe("groq");
    expect(result.candidate.monetaryCostUsd).toBe(0);
    expect(result.monetaryCostUsd).toBe(0);

    const summary = accountant.summary();
    expect(summary.monthlySpentMicros).toBe(ZERO_MICROS);
  });
});
