import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDatabase } from "../../db/client.js";
import { BudgetAccountant } from "../budget-accountant.js";
import type { ResolvedComputeEconomy } from "../compute-economy-config.js";
import { Microdollars, ZERO_MICROS, usdToMicros, microsToUsd } from "../money.js";
import { EconomicLedger } from "../ledger.js";
import { runCandidates, InferenceError, type InferenceAttempt } from "../../models/inference.js";
import type { ModelCandidate } from "../../models/adaptive-types.js";
import type { ModelMessage, ModelResponse } from "../../types.js";
import { DefaultCostEstimator } from "../cost-estimator.js";
import type { PricingSnapshot } from "../pricing-registry.js";
import { fixtureZeroCost } from "../../models/testing/zero-cost-fixture.js";

describe("Phase 3: Live Paid Canary Execution (V06_LIVE_CANARY_READY)", () => {
  let sqlite: ReturnType<typeof openDatabase>["sqlite"];
  let db: ReturnType<typeof openDatabase>["db"];
  let ledger: EconomicLedger;
  let accountant: BudgetAccountant;
  const costEstimator = new DefaultCostEstimator();

  const boundedConfig: ResolvedComputeEconomy = {
    mode: "bounded",
    monthlyHardCapMicros: Microdollars.fromNumber(1_000_000), // $1.00
    dailyHardCapMicros: Microdollars.fromNumber(100_000), // $0.10
    defaultObjectiveHardCapMicros: Microdollars.fromNumber(50_000), // $0.05
    defaultObjectiveSoftTargetMicros: Microdollars.fromNumber(10_000), // $0.01
    maxSingleInferenceMicros: Microdollars.fromNumber(10_000), // $0.01 max single inference
  };

  const openrouterDeepseekPricing: PricingSnapshot = {
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

  function createPaidCandidate(overrides: Partial<ModelCandidate> = {}): ModelCandidate {
    const costEstimate = costEstimator.estimate({
      pricing: openrouterDeepseekPricing,
      estimatedInputTokens: 500,
      maxOutputTokens: 1000
    });
    return {
      provider: "openrouter",
      model: "deepseek/deepseek-chat",
      costClass: "PAID",
      monetaryCostUsd: microsToUsd(costEstimate.estimatedCostMicros),
      worstCaseCostUsd: microsToUsd(costEstimate.worstCaseCostMicros),
      costEstimate,
      pricingSnapshot: openrouterDeepseekPricing,
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
        provider: "openrouter",
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
        provider: "openrouter",
        model: "deepseek/deepseek-chat",
        taskType: "reasoning",
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

  function createFreeCandidate(overrides: Partial<ModelCandidate> = {}): ModelCandidate {
    return {
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      costClass: "FREE_CONFIRMED",
      monetaryCostUsd: 0,
      worstCaseCostUsd: 0,
      economics: fixtureZeroCost("groq", "llama-3.3-70b-versatile"),
      capabilities: ["text", "coding"],
      contextWindow: 128_000,
      toolCalling: "yes",
      predictedQuality: 0.78,
      historicalSuccess: 0.88,
      reliability: 0.92,
      shadowCostUsd: 0.002,
      latencyPenalty: 0.15,
      failureRisk: 0.08,
      effectiveResourceCost: 0.002,
      utility: 0.75,
      quota: {
        provider: "groq",
        requestsPerMinute: 30,
        requestsPerDay: 1000,
        tokensPerMinute: 6000,
        tokensPerDay: 500_000,
        requestQuotaTotal: 1000,
        requestQuotaRemaining: 800,
        tokenQuotaTotal: 500_000,
        tokenQuotaRemaining: 400_000,
        resetAt: "unknown",
        health: "healthy",
        lastUpdatedAt: new Date().toISOString()
      },
      performance: {
        provider: "groq",
        model: "llama-3.3-70b-versatile",
        taskType: "reasoning",
        samples: 30,
        successes: 27,
        failures: 3,
        successRate: 0.9,
        avgEvaluationScore: 0.78,
        avgLatencyMs: 400,
        avgMonetaryCostUsd: 0,
        avgShadowCostUsd: 0.002,
        avgAttempts: 1
      },
      benchmarkCapability: null,
      capabilityEvidence: {
        bibScore: null,
        bibSamples: 0,
        realScore: 0.78,
        realSamples: 30,
        predictedScore: 0.78,
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

  beforeEach(() => {
    const client = openDatabase(":memory:");
    sqlite = client.sqlite;
    db = client.db;
    ledger = new EconomicLedger(db);
    accountant = new BudgetAccountant(sqlite, boundedConfig, ledger);
  });

  it("1. Happy path: paid canary candidate reserved -> dispatched -> settled with actual cost -> ledger recorded", async () => {
    const paidCandidate = createPaidCandidate();
    const complete = vi.fn().mockResolvedValue({
      provider: "openrouter",
      model: "deepseek/deepseek-chat",
      content: "Canary response completed.",
      estimatedCostUsd: 0.0003,
      attribution: { requestedModel: "deepseek/deepseek-chat", reportedModel: "deepseek/deepseek-chat" },
      raw: { usage: { prompt_tokens: 500, completion_tokens: 700 } }
    });
    const recordedAttempts: InferenceAttempt[] = [];

    const result = await runCandidates({
      taskId: "task-canary-happy",
      phase: "DIRECT_RESPONSE",
      candidates: [paidCandidate],
      messages: [{ role: "user", content: "Canary prompt" }],
      maxMonetaryCostUsd: 0.01,
      maxShadowCostUsd: 0.02,
      maxDurationMs: 5000,
      complete,
      validate: (r) => r.content,
      record: async (a) => { recordedAttempts.push(a); },
      budgetAccountant: accountant,
      costEstimator,
      canaryProvider: "openrouter",
      canaryMaxSingleInferenceUsd: 0.01
    });

    expect(result.value).toBe("Canary response completed.");
    expect(result.monetaryCostUsd).toBe(0.0003);
    expect(complete).toHaveBeenCalledOnce();
    expect(recordedAttempts.at(-1)?.status).toBe("SUCCEEDED");
    expect(recordedAttempts.at(-1)?.monetaryCostUsd).toBe(0.0003);

    // Verify budget accounts in SQLite:
    // Spent should be 300 microdollars (0.0003 USD)
    // Reserved should be 0 microdollars (released back)
    const summary = accountant.summary();
    expect(summary.monthlySpentMicros).toBe(300);
    expect(summary.monthlyReservedMicros).toBe(0);

    // Verify EconomicLedger has expense entry
    const entries = await ledger.latest();
    const expenseEntry = entries.find((e) => e.type === "expense");
    expect(expenseEntry).toBeDefined();
    expect(expenseEntry?.amountUsd).toBe(0.0003);
    expect(expenseEntry?.description).toContain("Inference compute: openrouter/deepseek/deepseek-chat");
  });

  it("2. Unused budget released when actual cost < worst-case cost", async () => {
    const paidCandidate = createPaidCandidate();
    const worstCaseMicros = paidCandidate.costEstimate!.worstCaseCostMicros;
    expect(worstCaseMicros).toBeGreaterThan(300); // 350 micros worst-case

    const complete = vi.fn().mockResolvedValue({
      provider: "openrouter",
      model: "deepseek/deepseek-chat",
      content: "Short answer.",
      estimatedCostUsd: 0.0001, // 100 micros actual
      attribution: { requestedModel: "deepseek/deepseek-chat" }
    });

    await runCandidates({
      taskId: "task-unused-release",
      phase: "DIRECT_RESPONSE",
      candidates: [paidCandidate],
      messages: [{ role: "user", content: "Short query" }],
      maxMonetaryCostUsd: 0.01,
      maxShadowCostUsd: 0.02,
      maxDurationMs: 5000,
      complete,
      validate: (r) => r.content,
      budgetAccountant: accountant,
      costEstimator,
      canaryProvider: "openrouter"
    });

    // Unspent difference (worstCase - actual) is fully returned to available budget
    const summary = accountant.summary();
    expect(summary.monthlySpentMicros).toBe(100);
    expect(summary.monthlyReservedMicros).toBe(0);
    expect(summary.monthlyAvailableMicros).toBe(1_000_000 - 100);
  });

  it("3. Failure before send -> reservation released entirely", async () => {
    const paidCandidate = createPaidCandidate();
    const complete = vi.fn();
    const canAttempt = vi.fn().mockResolvedValue(false); // Fails pre-dispatch check

    await expect(
      runCandidates({
        taskId: "task-fail-pre-dispatch",
        phase: "DIRECT_RESPONSE",
        candidates: [paidCandidate],
        messages: [{ role: "user", content: "Prompt" }],
        maxMonetaryCostUsd: 0.01,
        maxShadowCostUsd: 0.02,
        maxDurationMs: 5000,
        complete,
        validate: (r) => r.content,
        canAttempt,
        budgetAccountant: accountant,
        costEstimator,
        canaryProvider: "openrouter"
      })
    ).rejects.toMatchObject({ failureClass: "NEEDS_CAPABILITY" });

    expect(complete).not.toHaveBeenCalled();
    // Budget completely released
    const summary = accountant.summary();
    expect(summary.monthlySpentMicros).toBe(0);
    expect(summary.monthlyReservedMicros).toBe(0);
    expect(summary.monthlyAvailableMicros).toBe(1_000_000);
  });

  it("4. Non-chargeable failure after send -> reservation released; failover cleanly to free candidate", async () => {
    const paidCandidate = createPaidCandidate();
    const freeCandidate = createFreeCandidate();

    const complete = vi.fn()
      .mockRejectedValueOnce(new InferenceError("Provider returned HTTP 500.", "PROVIDER_UNAVAILABLE", 500))
      .mockResolvedValueOnce({
        provider: "groq",
        model: "llama-3.3-70b-versatile",
        content: "Free failover response.",
        estimatedCostUsd: 0
      });

    const result = await runCandidates({
      taskId: "task-failover-free",
      phase: "DIRECT_RESPONSE",
      candidates: [paidCandidate, freeCandidate],
      messages: [{ role: "user", content: "Prompt" }],
      maxMonetaryCostUsd: 0.01,
      maxShadowCostUsd: 0.02,
      maxDurationMs: 5000,
      complete,
      validate: (r) => r.content,
      budgetAccountant: accountant,
      costEstimator,
      canaryProvider: "openrouter"
    });

    expect(result.value).toBe("Free failover response.");
    expect(result.candidate.provider).toBe("groq");
    expect(result.monetaryCostUsd).toBe(0);

    // Paid reservation released on non-chargeable failure
    const summary = accountant.summary();
    expect(summary.monthlySpentMicros).toBe(0);
    expect(summary.monthlyReservedMicros).toBe(0);
  });

  it("5. Budget exhaustion -> reservation fails, clean failover to free candidate", async () => {
    // Configure accountant with zero remaining daily budget
    const tightConfig: ResolvedComputeEconomy = {
      ...boundedConfig,
      dailyHardCapMicros: Microdollars.fromNumber(100), // Only $0.0001
      defaultObjectiveHardCapMicros: Microdollars.fromNumber(100)
    };
    const tightAccountant = new BudgetAccountant(sqlite, tightConfig, ledger);

    const paidCandidate = createPaidCandidate(); // worst case is ~350 micros > 100 micros cap
    const freeCandidate = createFreeCandidate();

    const complete = vi.fn().mockResolvedValue({
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      content: "Free candidate succeeded.",
      estimatedCostUsd: 0
    });

    const result = await runCandidates({
      taskId: "task-budget-exhaustion",
      phase: "DIRECT_RESPONSE",
      candidates: [paidCandidate, freeCandidate],
      messages: [{ role: "user", content: "Prompt" }],
      maxMonetaryCostUsd: 0.01,
      maxShadowCostUsd: 0.02,
      maxDurationMs: 5000,
      complete,
      validate: (r) => r.content,
      budgetAccountant: tightAccountant,
      costEstimator,
      canaryProvider: "openrouter"
    });

    expect(result.value).toBe("Free candidate succeeded.");
    expect(result.candidate.provider).toBe("groq");
    expect(result.monetaryCostUsd).toBe(0);
    expect(complete).toHaveBeenCalledOnce();
  });

  it("6. Hard cap strictly stops further paid calls once reached (Invariant I-1)", async () => {
    // Tight cap of 700 micros (producer phase gets 60% = 420 micros; 350 micros fits once, second call fails)
    const freshClient = openDatabase(":memory:");
    const capConfig: ResolvedComputeEconomy = {
      ...boundedConfig,
      monthlyHardCapMicros: Microdollars.fromNumber(700),
      dailyHardCapMicros: Microdollars.fromNumber(700),
      defaultObjectiveHardCapMicros: Microdollars.fromNumber(700)
    };
    const capAccountant = new BudgetAccountant(freshClient.sqlite, capConfig, new EconomicLedger(freshClient.db));

    const paidCandidate = createPaidCandidate(); // ~350 micros worst case

    const complete = vi.fn().mockResolvedValue({
      provider: "openrouter",
      model: "deepseek/deepseek-chat",
      content: "Call 1 OK",
      estimatedCostUsd: 0.00035, // 350 micros spent
      attribution: { requestedModel: "deepseek/deepseek-chat" }
    });

    // Call 1: succeeds (420 - 350 = 70 micros remaining in producer phase)
    const res1 = await runCandidates({
      taskId: "task-cap-1",
      phase: "DIRECT_RESPONSE",
      candidates: [paidCandidate],
      messages: [{ role: "user", content: "Call 1" }],
      maxMonetaryCostUsd: 0.01,
      maxShadowCostUsd: 0.02,
      maxDurationMs: 5000,
      complete,
      validate: (r) => r.content,
      budgetAccountant: capAccountant,
      costEstimator,
      canaryProvider: "openrouter"
    });
    expect(res1.monetaryCostUsd).toBe(0.00035);

    // Call 2: same objective, worst case 350 micros > 70 micros remaining -> rejected!
    await expect(
      runCandidates({
        taskId: "task-cap-1",
        stepId: "step-2",
        phase: "DIRECT_RESPONSE",
        candidates: [paidCandidate],
        messages: [{ role: "user", content: "Call 2" }],
        maxMonetaryCostUsd: 0.01,
        maxShadowCostUsd: 0.02,
        maxDurationMs: 5000,
        complete,
        validate: (r) => r.content,
        budgetAccountant: capAccountant,
        costEstimator,
        canaryProvider: "openrouter"
      })
    ).rejects.toMatchObject({ failureClass: "BUDGET_EXHAUSTED" });

    // Total spend remains strictly <= hard cap (350 <= 700)
    const summary = capAccountant.summary();
    expect(summary.monthlySpentMicros).toBe(350);
    expect(summary.monthlySpentMicros).toBeLessThanOrEqual(700);
  });

  it("7. Canary circuit breaker trips on anomalous reported price", async () => {
    const paidCandidate = createPaidCandidate(); // worst case ~0.00035 USD
    const complete = vi.fn().mockResolvedValue({
      provider: "openrouter",
      model: "deepseek/deepseek-chat",
      content: "Unexpectedly expensive response",
      estimatedCostUsd: 0.0050, // > 1.5x of worst-case 0.00035
      attribution: { requestedModel: "deepseek/deepseek-chat" }
    });

    await expect(
      runCandidates({
        taskId: "task-anomaly-circuit-breaker",
        phase: "DIRECT_RESPONSE",
        candidates: [paidCandidate],
        messages: [{ role: "user", content: "Prompt" }],
        maxMonetaryCostUsd: 0.01,
        maxShadowCostUsd: 0.02,
        maxDurationMs: 5000,
        complete,
        validate: (r) => r.content,
        budgetAccountant: accountant,
        costEstimator,
        canaryProvider: "openrouter",
        canaryDiscrepancyMultiplier: 1.5
      })
    ).rejects.toMatchObject({ failureClass: "ECONOMIC_POLICY_BLOCKED" });

    // Actual cost settled so accounting remains truthful
    const summary = accountant.summary();
    expect(summary.monthlySpentMicros).toBe(5000);
    expect(summary.monthlyReservedMicros).toBe(0);
  });

  it("8. Canary hard cap guardrail strictly blocks candidate exceeding canary limit", async () => {
    const expensiveCandidate = createPaidCandidate({
      monetaryCostUsd: 0.02,
      worstCaseCostUsd: 0.03,
      costEstimate: {
        estimatedCostMicros: Microdollars.fromNumber(20_000),
        worstCaseCostMicros: Microdollars.fromNumber(30_000),
        breakdown: {
          inputCostMicros: Microdollars.fromNumber(10_000),
          outputCostMicros: Microdollars.fromNumber(20_000),
          cacheCostMicros: ZERO_MICROS,
          requestFeeMicros: ZERO_MICROS
        },
        pricingSnapshotId: "snap-expensive"
      }
    });

    const complete = vi.fn();

    await expect(
      runCandidates({
        taskId: "task-canary-limit",
        phase: "DIRECT_RESPONSE",
        candidates: [expensiveCandidate],
        messages: [{ role: "user", content: "Prompt" }],
        maxMonetaryCostUsd: 0.05,
        maxShadowCostUsd: 0.02,
        maxDurationMs: 5000,
        complete,
        validate: (r) => r.content,
        budgetAccountant: accountant,
        costEstimator,
        canaryProvider: "openrouter",
        canaryMaxSingleInferenceUsd: 0.01 // Canary limit: $0.01
      })
    ).rejects.toMatchObject({ failureClass: "BUDGET_EXHAUSTED" });

    expect(complete).not.toHaveBeenCalled();
  });

  it("9. Single provider canary route: non-canary paid provider is blocked", async () => {
    const nonCanaryCandidate = createPaidCandidate({
      provider: "anthropic",
      model: "claude-3.5-sonnet"
    });

    const complete = vi.fn();

    await expect(
      runCandidates({
        taskId: "task-non-canary-provider",
        phase: "DIRECT_RESPONSE",
        candidates: [nonCanaryCandidate],
        messages: [{ role: "user", content: "Prompt" }],
        maxMonetaryCostUsd: 0.01,
        maxShadowCostUsd: 0.02,
        maxDurationMs: 5000,
        complete,
        validate: (r) => r.content,
        budgetAccountant: accountant,
        costEstimator,
        canaryProvider: "openrouter" // Only openrouter authorized for canary
      })
    ).rejects.toMatchObject({ failureClass: "ECONOMIC_POLICY_BLOCKED" });

    expect(complete).not.toHaveBeenCalled();
  });

  it("10. Zero-cost mode continues strictly blocking paid execution (monetary spend = $0.00 invariant)", async () => {
    const zeroCostConfig: ResolvedComputeEconomy = {
      ...boundedConfig,
      mode: "zero_cost"
    };
    const zeroCostAccountant = new BudgetAccountant(sqlite, zeroCostConfig, ledger);
    const paidCandidate = createPaidCandidate();

    const complete = vi.fn();

    await expect(
      runCandidates({
        taskId: "task-zero-cost-block",
        phase: "DIRECT_RESPONSE",
        candidates: [paidCandidate],
        messages: [{ role: "user", content: "Prompt" }],
        maxMonetaryCostUsd: 0.01,
        maxShadowCostUsd: 0.02,
        maxDurationMs: 5000,
        complete,
        validate: (r) => r.content,
        budgetAccountant: zeroCostAccountant,
        computeMode: "zero_cost",
        costEstimator
      })
    ).rejects.toMatchObject({ failureClass: "ECONOMIC_POLICY_BLOCKED" });

    expect(complete).not.toHaveBeenCalled();
  });

  it("11. Unknown price on billable route blocks paid execution (Invariant I-4)", async () => {
    const unknownPriceCandidate = createPaidCandidate({
      pricingSnapshot: undefined,
      costEstimate: undefined,
      worstCaseCostUsd: undefined
    });

    const complete = vi.fn();

    await expect(
      runCandidates({
        taskId: "task-unknown-price-block",
        phase: "DIRECT_RESPONSE",
        candidates: [unknownPriceCandidate],
        messages: [{ role: "user", content: "Prompt" }],
        maxMonetaryCostUsd: 0.01,
        maxShadowCostUsd: 0.02,
        maxDurationMs: 5000,
        complete,
        validate: (r) => r.content,
        budgetAccountant: accountant,
        costEstimator,
        canaryProvider: "openrouter"
      })
    ).rejects.toMatchObject({ failureClass: "ECONOMIC_POLICY_BLOCKED" });

    expect(complete).not.toHaveBeenCalled();
  });

  it("12. Idempotency prevents duplicate reservations for the same attempt (Invariant I-2)", () => {
    const scope = {
      objectiveId: "obj-idempotent",
      phase: "producer" as const
    };
    const idempotencyKey = "unique-attempt-key-123";

    const res1 = accountant.reserve({
      objectiveId: scope.objectiveId,
      phase: scope.phase,
      provider: "openrouter",
      model: "deepseek/deepseek-chat",
      worstCaseMicros: Microdollars.fromNumber(500),
      estimatedInputTokens: 500,
      maxOutputTokens: 1000,
      idempotencyKey
    });

    expect(res1).not.toBeNull();
    const reservedAfterFirst = accountant.summary().monthlyReservedMicros;
    expect(reservedAfterFirst).toBe(500);

    // Second call with same idempotency key returns existing reservation without adding to reservedMicros
    const res2 = accountant.reserve({
      objectiveId: scope.objectiveId,
      phase: scope.phase,
      provider: "openrouter",
      model: "deepseek/deepseek-chat",
      worstCaseMicros: Microdollars.fromNumber(500),
      estimatedInputTokens: 500,
      maxOutputTokens: 1000,
      idempotencyKey
    });

    expect(res2?.id).toBe(res1?.id);
    const reservedAfterSecond = accountant.summary().monthlyReservedMicros;
    expect(reservedAfterSecond).toBe(500); // Not 1000!
  });
});
