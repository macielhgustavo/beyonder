import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDatabase } from "../../db/client.js";
import { BudgetAccountant, derivePhaseCap, SIBLING_PHASE_ALLOCATION_RATIOS, SUBPHASE_ALLOCATION_RATIOS } from "../budget-accountant.js";
import { EconomicLedger } from "../ledger.js";
import { DefaultCostEstimator } from "../cost-estimator.js";
import { InMemoryPricingRegistry, type PricingSnapshot } from "../pricing-registry.js";
import { Microdollars, usdToMicros, microsToUsd, ZERO_MICROS } from "../money.js";
import {
  runCandidates,
  InferenceError,
  classifyDispatchBillingStatus,
  MAX_CONCURRENT_BILLABLE_DISPATCHES_PER_DECISION
} from "../../models/inference.js";
import { InvalidReservationTransitionError } from "../spend-reservation.js";
import { MemoryStore } from "../../memory/memory-store.js";
import { MemoryEngine, classifyTaskOutcome, resolveOutcomeRole } from "../../memory/memory-engine.js";
import { MemoryPerformanceRepository } from "../../models/performance-repository.js";
import {
  resolveMonetaryReference,
  DEFAULT_MONETARY_REFERENCE_PRIORS,
  type MonetaryReferencePriors,
  type MonetaryReferenceContext
} from "../../models/utility.js";
import { PAID_EXECUTION_ENABLED, ResolvedComputeEconomy } from "../compute-economy-config.js";
import { ModelRouter } from "../../models/model-router.js";
import type { ModelCandidate } from "../../models/adaptive-types.js";
import type { ModelResponse } from "../../types.js";
import type { TaskOutcome } from "../../intelligence/contracts.js";

describe("Adversarial Economic Safety Qualification Suite (v0.6 Freeze)", () => {
  let sqlite: ReturnType<typeof openDatabase>["sqlite"];
  let db: ReturnType<typeof openDatabase>["db"];
  let ledger: EconomicLedger;
  let accountant: BudgetAccountant;
  let pricingRegistry: InMemoryPricingRegistry;
  const costEstimator = new DefaultCostEstimator();

  const testConfig: ResolvedComputeEconomy = {
    mode: "bounded",
    monthlyHardCapMicros: Microdollars.fromNumber(10_000_000), // $10.00
    dailyHardCapMicros: Microdollars.fromNumber(2_000_000), // $2.00
    defaultObjectiveHardCapMicros: Microdollars.fromNumber(500_000), // $0.50
    defaultObjectiveSoftTargetMicros: Microdollars.fromNumber(100_000), // $0.10
    maxSingleInferenceMicros: Microdollars.fromNumber(100_000), // $0.10
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

  beforeEach(() => {
    const client = openDatabase(":memory:");
    sqlite = client.sqlite;
    db = client.db;
    ledger = new EconomicLedger(db);
    accountant = new BudgetAccountant(sqlite, testConfig, ledger);
    pricingRegistry = new InMemoryPricingRegistry();
    pricingRegistry.recordPrice(openrouterPricing);
    pricingRegistry.recordPrice(geminiPricing);
  });

  function createPaidCandidate(provider: string, model: string): ModelCandidate {
    const pricing = pricingRegistry.getPrice(provider, model)!;
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
      }
    };
  }

  // ==========================================================================
  // Test A: Phase caps can never overcommit parent (Property / Invariant Test)
  // ==========================================================================
  describe("Test A: Phase caps can never overcommit parent", () => {
    it("property test: sum(siblingCaps) <= objectiveHardCap for all integer budgets", () => {
      const testObjectiveCaps = [
        0, 1, 2, 3, 7, 10, 13, 99, 100, 101, 1000, 1001, 10000, 10001, 10003,
        50000, 99999, 100000, 500000, 1000000, 9999999
      ];

      for (const cap of testObjectiveCaps) {
        const parentCap = Microdollars.fromNumber(cap);
        const producerCap = derivePhaseCap("producer", parentCap);
        const verifierCap = derivePhaseCap("verifier", parentCap);
        const recoveryCap = derivePhaseCap("recovery", parentCap);

        // Sibling hard commitments can NEVER sum to > parent objective hard cap
        const siblingSum = producerCap + verifierCap + recoveryCap;
        expect(siblingSum).toBeLessThanOrEqual(parentCap);

        // Adjudication is explicitly a subbudget of verifier (capped at 40% of verifier)
        const adjudicationCap = derivePhaseCap("adjudication", verifierCap);
        expect(adjudicationCap).toBeLessThanOrEqual(verifierCap);
        // And adjudication never exceeds 10% of total objective cap
        expect(adjudicationCap).toBeLessThanOrEqual(Math.floor(parentCap * 0.10));
      }
    });

    it("verifies hierarchical budget account creation strictly respects subbudget structure", () => {
      const objectiveId = "obj-hierarchy-test";
      const objCap = Microdollars.fromNumber(10_000); // 10,000 micros
      accountant.setObjectiveHardCap(objectiveId, objCap);

      // Producer gets 60% = 6,000 micros
      const producerAccount = (accountant as any).getOrCreateAccount(`phase:${objectiveId}:producer`, { objectiveId, phase: "producer" });
      expect(producerAccount.hardCapMicros).toBe(6000);

      // Verifier gets 25% = 2,500 micros
      const verifierAccount = (accountant as any).getOrCreateAccount(`phase:${objectiveId}:verifier`, { objectiveId, phase: "verifier" });
      expect(verifierAccount.hardCapMicros).toBe(2500);

      // Recovery gets 15% = 1,500 micros
      const recoveryAccount = (accountant as any).getOrCreateAccount(`phase:${objectiveId}:recovery`, { objectiveId, phase: "recovery" });
      expect(recoveryAccount.hardCapMicros).toBe(1500);

      // Adjudication is child of verifier: 40% of 2,500 = 1,000 micros (exactly 10% of objective)
      const adjudicationAccount = (accountant as any).getOrCreateAccount(`phase:${objectiveId}:adjudication`, { objectiveId, phase: "adjudication" });
      expect(adjudicationAccount.parentId).toBe(verifierAccount.id);
      expect(adjudicationAccount.hardCapMicros).toBe(1000);

      // Sibling hard commitments: 6000 + 2500 + 1500 = 10000 <= 10000
      expect(producerAccount.hardCapMicros + verifierAccount.hardCapMicros + recoveryAccount.hardCapMicros).toBeLessThanOrEqual(objCap);
    });
  });

  // ==========================================================================
  // Test B: REQUEST_SENT timeout retains conservative commitment
  // ==========================================================================
  describe("Test B & Fault Injection: Dispatch uncertainty transitions to UNKNOWN_OUTCOME", () => {
    it("REQUEST_SENT timeout retains conservative commitment and does NOT release", async () => {
      const candidate = createPaidCandidate("openrouter", "deepseek/deepseek-chat");
      const taskId = "task-timeout-test";

      const complete = vi.fn(async (): Promise<ModelResponse> => {
        throw new InferenceError("Request timed out waiting for gateway response", "TIMEOUT");
      });

      await expect(runCandidates({
        taskId,
        phase: "DIRECT_RESPONSE",
        taskType: "coding",
        messages: [{ role: "user", content: "test" }],
        candidates: [candidate],
        maxCandidates: 1,
        maxMonetaryCostUsd: 0.05,
        maxShadowCostUsd: 0.01,
        maxDurationMs: 5000,
        budgetAccountant: accountant,
        costEstimator,
        computeMode: "bounded",
        validate: (r) => r.content,
        complete
      })).rejects.toThrow("Request timed out waiting for gateway response");

      // Verify reservation state in DB is UNKNOWN_OUTCOME, NEVER RELEASED
      const reservations = accountant.listReservations({ taskId });
      expect(reservations).toHaveLength(1);
      expect(reservations[0].state).toBe("UNKNOWN_OUTCOME");
      expect(reservations[0].settledAt).toBeDefined();

      // Conservative commitment is still locked on accounts!
      const summary = accountant.summary();
      expect(summary.monthlyReservedMicros).toBeGreaterThan(ZERO_MICROS);
    });

    it("Fault Injection: socket reset (ECONNRESET) transitions to UNKNOWN_OUTCOME", async () => {
      const candidate = createPaidCandidate("openrouter", "deepseek/deepseek-chat");
      const taskId = "task-socket-reset-test";

      const complete = vi.fn(async (): Promise<ModelResponse> => {
        const error = new Error("read ECONNRESET");
        (error as any).code = "ECONNRESET";
        throw error;
      });

      await expect(runCandidates({
        taskId,
        phase: "DIRECT_RESPONSE",
        taskType: "coding",
        messages: [{ role: "user", content: "test" }],
        candidates: [candidate],
        maxCandidates: 1,
        maxMonetaryCostUsd: 0.05,
        maxShadowCostUsd: 0.01,
        maxDurationMs: 5000,
        budgetAccountant: accountant,
        costEstimator,
        computeMode: "bounded",
        validate: (r) => r.content,
        complete
      })).rejects.toThrow("ECONNRESET");

      const reservations = accountant.listReservations({ taskId });
      expect(reservations).toHaveLength(1);
      expect(reservations[0].state).toBe("UNKNOWN_OUTCOME");
    });

    it("Fault Injection: provider 500 Internal Server Error transitions to UNKNOWN_OUTCOME", async () => {
      const candidate = createPaidCandidate("openrouter", "deepseek/deepseek-chat");
      const taskId = "task-500-test";

      const complete = vi.fn(async (): Promise<ModelResponse> => {
        throw new InferenceError("Provider 500 Internal Server Error", "PROVIDER_UNAVAILABLE", 500);
      });

      await expect(runCandidates({
        taskId,
        phase: "DIRECT_RESPONSE",
        taskType: "coding",
        messages: [{ role: "user", content: "test" }],
        candidates: [candidate],
        maxCandidates: 1,
        maxMonetaryCostUsd: 0.05,
        maxShadowCostUsd: 0.01,
        maxDurationMs: 5000,
        budgetAccountant: accountant,
        costEstimator,
        computeMode: "bounded",
        validate: (r) => r.content,
        complete
      })).rejects.toThrow("Provider 500");

      const reservations = accountant.listReservations({ taskId });
      expect(reservations).toHaveLength(1);
      expect(reservations[0].state).toBe("UNKNOWN_OUTCOME");
    });

    it("Fault Injection: malformed / corrupted JSON after dispatch transitions to UNKNOWN_OUTCOME", async () => {
      const candidate = createPaidCandidate("openrouter", "deepseek/deepseek-chat");
      const taskId = "task-malformed-test";

      const complete = vi.fn(async (): Promise<ModelResponse> => {
        throw new SyntaxError("Unexpected end of JSON input");
      });

      await expect(runCandidates({
        taskId,
        phase: "DIRECT_RESPONSE",
        taskType: "coding",
        messages: [{ role: "user", content: "test" }],
        candidates: [candidate],
        maxCandidates: 1,
        maxMonetaryCostUsd: 0.05,
        maxShadowCostUsd: 0.01,
        maxDurationMs: 5000,
        budgetAccountant: accountant,
        costEstimator,
        computeMode: "bounded",
        validate: (r) => r.content,
        complete
      })).rejects.toThrow("Unexpected end of JSON input");

      const reservations = accountant.listReservations({ taskId });
      expect(reservations).toHaveLength(1);
      expect(reservations[0].state).toBe("UNKNOWN_OUTCOME");
    });

    it("Fault Injection: process crash recovery marks pending REQUEST_SENT as UNKNOWN_OUTCOME", () => {
      // Create a reservation and mark sent
      const res = accountant.reserve({
        objectiveId: "obj-crash",
        taskId: "task-crash",
        provider: "openrouter",
        model: "deepseek/deepseek-chat",
        estimatedInputTokens: 500,
        maxOutputTokens: 1000,
        worstCaseMicros: usdToMicros(0.01),
        idempotencyKey: "crash-test-key"
      });
      expect(res).not.toBeNull();
      accountant.markSent(res!.id);

      // Simulate process reboot: create new BudgetAccountant on same DB and call recoverAfterRestart
      const recoveredAccountant = new BudgetAccountant(sqlite, testConfig, ledger);
      recoveredAccountant.recoverAfterRestart();

      const reservationRow = sqlite.prepare("SELECT state FROM spend_reservations WHERE id = ?").get(res!.id) as { state: string };
      expect(reservationRow.state).toBe("UNKNOWN_OUTCOME");
    });
  });

  // ==========================================================================
  // Test C: Pre-dispatch failure releases
  // ==========================================================================
  describe("Test C: Pre-dispatch failure releases", () => {
    it("releases reservation when pre-dispatch check (canAttempt) fails", async () => {
      const candidate = createPaidCandidate("openrouter", "deepseek/deepseek-chat");
      const taskId = "task-pre-dispatch-reject";

      const complete = vi.fn();
      await expect(runCandidates({
        taskId,
        phase: "DIRECT_RESPONSE",
        taskType: "coding",
        messages: [{ role: "user", content: "test" }],
        candidates: [candidate],
        maxCandidates: 1,
        maxMonetaryCostUsd: 0.05,
        maxShadowCostUsd: 0.01,
        maxDurationMs: 5000,
        budgetAccountant: accountant,
        costEstimator,
        computeMode: "bounded",
        canAttempt: async () => false, // rejects before dispatch
        validate: (r) => r.content,
        complete
      })).rejects.toThrow();

      expect(complete).not.toHaveBeenCalled();
      const reservations = accountant.listReservations({ taskId });
      expect(reservations).toHaveLength(1);
      expect(reservations[0].state).toBe("RELEASED");

      const summary = accountant.summary();
      expect(summary.monthlyReservedMicros).toBe(ZERO_MICROS);
    });

    it("releases reservation when gateway confirms rejection before execution (HTTP 401)", async () => {
      const candidate = createPaidCandidate("openrouter", "deepseek/deepseek-chat");
      const taskId = "task-confirmed-not-billed";

      const complete = vi.fn(async (): Promise<ModelResponse> => {
        throw new InferenceError("Invalid API key", "AUTH_REQUIRED", 401);
      });

      await expect(runCandidates({
        taskId,
        phase: "DIRECT_RESPONSE",
        taskType: "coding",
        messages: [{ role: "user", content: "test" }],
        candidates: [candidate],
        maxCandidates: 1,
        maxMonetaryCostUsd: 0.05,
        maxShadowCostUsd: 0.01,
        maxDurationMs: 5000,
        budgetAccountant: accountant,
        costEstimator,
        computeMode: "bounded",
        validate: (r) => r.content,
        complete
      })).rejects.toThrow("Invalid API key");

      const reservations = accountant.listReservations({ taskId });
      expect(reservations).toHaveLength(1);
      expect(reservations[0].state).toBe("RELEASED");
    });
  });

  // ==========================================================================
  // Test D: Settled reservation cannot release
  // ==========================================================================
  describe("Test D: Settled reservation cannot release", () => {
    it("asserts state machine rejects releasing a SETTLED reservation", () => {
      const res = accountant.reserve({
        objectiveId: "obj-settle-test",
        taskId: "task-settle-test",
        provider: "gemini",
        model: "gemini-1.5-pro",
        estimatedInputTokens: 500,
        maxOutputTokens: 1000,
        worstCaseMicros: usdToMicros(0.01),
        idempotencyKey: "settle-release-key"
      });
      expect(res).not.toBeNull();
      accountant.markSent(res!.id);
      accountant.settle({
        reservationId: res!.id,
        actualCostMicros: usdToMicros(0.005),
        providerReportedCostUsd: 0.005
      });

      // Attempting to release a settled reservation must throw InvalidReservationTransitionError
      expect(() => {
        accountant.release(res!.id, "illegal release attempt");
      }).toThrow(InvalidReservationTransitionError);
    });
  });

  // ==========================================================================
  // Test E: Unknown outcome cannot be reused as available capital
  // ==========================================================================
  describe("Test E: Unknown outcome capital is locked and cannot be reused", () => {
    it("unknown outcome reservation keeps reserved capital locked, blocking subsequent allocations", () => {
      const objId = "obj-locked-capital-test";
      // Objective cap: $0.01 = 10,000 micros. Producer cap: 60% = 6,000 micros.
      accountant.setObjectiveHardCap(objId, usdToMicros(0.01));

      // Reservation 1 reserves the entire 6,000 micros producer cap
      const res1 = accountant.reserve({
        objectiveId: objId,
        taskId: "task-unknown-lock",
        phase: "producer",
        provider: "openrouter",
        model: "deepseek/deepseek-chat",
        estimatedInputTokens: 500,
        maxOutputTokens: 1000,
        worstCaseMicros: usdToMicros(0.006),
        idempotencyKey: "lock-key-1"
      });
      expect(res1).not.toBeNull();
      accountant.markSent(res1!.id);
      accountant.markUnknown(res1!.id, "Gateway timeout");

      // Verify res1 is in UNKNOWN_OUTCOME
      const row = sqlite.prepare("SELECT state FROM spend_reservations WHERE id = ?").get(res1!.id) as { state: string };
      expect(row.state).toBe("UNKNOWN_OUTCOME");

      // Verify producer phase available budget is 0
      const canAffordNew = accountant.canAfford(
        { objectiveId: objId, phase: "producer" },
        usdToMicros(0.001)
      );
      expect(canAffordNew).toBe(false);

      // Attempting to reserve even $0.001 returns null (budget exhausted, capital locked)
      const res2 = accountant.reserve({
        objectiveId: objId,
        taskId: "task-attempt-reuse",
        phase: "producer",
        provider: "gemini",
        model: "gemini-1.5-pro",
        estimatedInputTokens: 100,
        maxOutputTokens: 200,
        worstCaseMicros: usdToMicros(0.001),
        idempotencyKey: "lock-key-2"
      });
      expect(res2).toBeNull();
    });
  });

  // ==========================================================================
  // Test F: Sequential provider failover never duplicates reservation
  // ==========================================================================
  describe("Test F: Sequential provider failover never duplicates reservation", () => {
    it("sequential failover releases first provider reserve before reserving second provider", async () => {
      const candidateOR = createPaidCandidate("openrouter", "deepseek/deepseek-chat");
      const candidateGemini = createPaidCandidate("gemini", "gemini-1.5-pro");
      const taskId = "task-failover-audit";

      let attemptsCount = 0;
      const complete = vi.fn(async (_msgs, candidate: ModelCandidate): Promise<ModelResponse> => {
        attemptsCount++;
        if (candidate.provider === "openrouter") {
          throw new InferenceError("OpenRouter 401 Unauthorized", "AUTH_REQUIRED", 401);
        }
        return {
          content: "Gemini recovered cleanly",
          provider: candidate.provider,
          model: candidate.model,
          estimatedCostUsd: 0.002,
          attribution: { requestedModel: candidate.model, reportedModel: candidate.model },
          raw: { usage: { prompt_tokens: 500, completion_tokens: 500, cost: 0.002 } }
        };
      });

      const result = await runCandidates({
        taskId,
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
        validate: (r) => r.content,
        complete
      });

      expect(attemptsCount).toBe(2);
      expect(result.candidate.provider).toBe("gemini");

      // Verify reservations
      const reservations = accountant.listReservations({ taskId });
      expect(reservations).toHaveLength(2);

      const orRes = reservations.find((r) => r.provider === "openrouter")!;
      const geminiRes = reservations.find((r) => r.provider === "gemini")!;

      expect(orRes.state).toBe("RELEASED");
      expect(geminiRes.state).toBe("SETTLED");
      expect(geminiRes.actualCostMicros).toBe(usdToMicros(0.002));

      // Monthly reserved must be zero (settled + released = 0 remaining reserved)
      const summary = accountant.summary();
      expect(summary.monthlyReservedMicros).toBe(ZERO_MICROS);
      expect(summary.monthlySpentMicros).toBe(usdToMicros(0.002));
    });
  });

  // ==========================================================================
  // Test G: Billable speculative parallelism blocked
  // ==========================================================================
  describe("Test G: Billable speculative parallelism blocked", () => {
    it("enforces MAX_CONCURRENT_BILLABLE_DISPATCHES_PER_DECISION <= 1", () => {
      expect(MAX_CONCURRENT_BILLABLE_DISPATCHES_PER_DECISION).toBe(1);
    });

    it("billing status classification accurately detects dispatch states", () => {
      expect(classifyDispatchBillingStatus(new Error("pre"), false)).toBe("PRE_DISPATCH");
      expect(classifyDispatchBillingStatus(new InferenceError("401", "AUTH_REQUIRED", 401), true)).toBe("CONFIRMED_NOT_BILLED");
      expect(classifyDispatchBillingStatus(new InferenceError("400", "BAD_REQUEST", 400), true)).toBe("CONFIRMED_NOT_BILLED");
      expect(classifyDispatchBillingStatus(new InferenceError("timeout", "TIMEOUT"), true)).toBe("UNKNOWN_AFTER_DISPATCH");
      expect(classifyDispatchBillingStatus(new InferenceError("500", "PROVIDER_UNAVAILABLE", 500), true)).toBe("UNKNOWN_AFTER_DISPATCH");
      expect(classifyDispatchBillingStatus(new InferenceError("billed", "BAD_REQUEST", 400, undefined, undefined, undefined, undefined, 0.01), true)).toBe("CONFIRMED_BILLED");
    });
  });

  // ==========================================================================
  // Test H: False-success label cannot reinforce capability predictor
  // ==========================================================================
  describe("Test H: False-success label cannot reinforce capability predictor", () => {
    it("identifies FALSE_SUCCESS and counts it as a failure, NEVER a success", async () => {
      const memoryStore = new MemoryStore(db);
      const memoryEngine = new MemoryEngine(memoryStore);
      const repo = new MemoryPerformanceRepository(memoryStore);

      const falseSuccessOutcome: TaskOutcome = {
        task: {
          id: "task-false-success-1",
          input: "Write code",
          type: "coding",
          complexity: 0.7,
          risk: 0.1,
          estimatedTokens: 1000,
          requirements: {}
        },
        attempts: [],
        success: true, // Candidate claimed success
        evaluation: {
          score: 0.0,
          passed: false, // BUT verifier rejected the output!
          criteria: { objectiveStatus: "FAILED", falseSuccess: true }
        },
        provider: "openrouter",
        model: "deepseek/deepseek-chat",
        tokens: 500,
        monetaryCostUsd: 0.001,
        shadowCostUsd: 0.001,
        latencyMs: 300,
        tools: [],
        completedAt: new Date().toISOString()
      };

      // Classification check
      const category = classifyTaskOutcome(falseSuccessOutcome);
      expect(category).toBe("FALSE_SUCCESS");

      // Record in memory engine
      await memoryEngine.recordOutcome(falseSuccessOutcome);

      // Query performance repository
      const perf = await repo.get("openrouter", "deepseek/deepseek-chat", "coding", "producer");
      expect(perf.samples).toBe(1);
      expect(perf.successes).toBe(0); // STRICTLY 0: positive reinforcement is blocked!
      expect(perf.failures).toBe(1);
      expect(perf.successRate).toBe(0.0);
    });
  });

  // ==========================================================================
  // Test I: Producer performance does not pollute verifier performance
  // ==========================================================================
  describe("Test I: Producer performance does not pollute verifier performance", () => {
    it("segregates producer and verifier performance strictly by role", async () => {
      const memoryStore = new MemoryStore(db);
      const memoryEngine = new MemoryEngine(memoryStore);
      const repo = new MemoryPerformanceRepository(memoryStore);

      const provider = "test-provider";
      const model = "test-model";

      // Record 3 producer successes
      for (let i = 0; i < 3; i++) {
        await memoryEngine.recordOutcome({
          phase: "DIRECT_RESPONSE",
          task: {
            id: `task-prod-${i}`,
            input: "Generate code",
            type: "coding",
            complexity: 0.5,
            risk: 0.1,
            estimatedTokens: 500,
            requirements: {}
          },
          attempts: [],
          success: true,
          evaluation: { score: 1.0, passed: true, confidence: 1.0 },
          provider,
          model,
          tokens: 500,
          monetaryCostUsd: 0,
          shadowCostUsd: 0,
          latencyMs: 200,
          tools: [],
          completedAt: new Date().toISOString()
        });
      }

      // Record 2 verifier failures
      for (let i = 0; i < 2; i++) {
        await memoryEngine.recordOutcome({
          phase: "OBJECTIVE_VERIFICATION",
          task: {
            id: `task-verif-${i}`,
            input: "Verify output",
            type: "coding",
            complexity: 0.8,
            risk: 0.2,
            estimatedTokens: 800,
            requirements: {},
            inferencePhase: "OBJECTIVE_VERIFICATION"
          },
          attempts: [],
          success: false,
          failureClass: "INVALID_OUTPUT",
          evaluation: { score: 0.0, passed: false },
          provider,
          model,
          tokens: 800,
          monetaryCostUsd: 0,
          shadowCostUsd: 0,
          latencyMs: 400,
          tools: [],
          completedAt: new Date().toISOString()
        });
      }

      // Query producer performance
      const producerPerf = await repo.get(provider, model, "coding", "producer");
      expect(producerPerf.samples).toBe(3);
      expect(producerPerf.successes).toBe(3);
      expect(producerPerf.failures).toBe(0);
      expect(producerPerf.successRate).toBe(1.0);

      // Query verifier performance
      const verifierPerf = await repo.get(provider, model, "coding", "verifier");
      expect(verifierPerf.samples).toBe(2);
      expect(verifierPerf.successes).toBe(0);
      expect(verifierPerf.failures).toBe(2);
      expect(verifierPerf.successRate).toBe(0.0);
    });
  });

  // ==========================================================================
  // Test J: Paid execution remains forbidden under current development policy
  // ==========================================================================
  describe("Test J: Paid execution remains forbidden under current development policy", () => {
    it("confirms PAID_EXECUTION_ENABLED is strictly false", () => {
      expect(PAID_EXECUTION_ENABLED).toBe(false);
    });

    it("ModelRouter blocks live paid candidate execution with ECONOMIC_POLICY_BLOCKED", async () => {
      const router = new ModelRouter({
        provider: "auto",
        name: "test",
        endpoint: "",
        ollamaBaseUrl: "",
        providerStatePath: ""
      } as any);
      const paidCandidate = createPaidCandidate("openrouter", "deepseek/deepseek-chat");

      await expect((router as any).completeAutoCandidate(
        [{ role: "user", content: "hello" }],
        paidCandidate
      )).rejects.toThrow("Live paid execution is disabled under current development policy");
    });
  });

  // ==========================================================================
  // Monetary Reference Decoupling & Seam Validation
  // ==========================================================================
  describe("Monetary Reference Decoupling & Priors", () => {
    it("uses default priors when no custom priors are provided", () => {
      expect(resolveMonetaryReference({ type: "chat" })).toBe(0.05);
      expect(resolveMonetaryReference({ type: "coding" })).toBe(0.25);
      expect(resolveMonetaryReference({ inferencePhase: "OBJECTIVE_VERIFICATION" })).toBe(0.50);
      expect(resolveMonetaryReference({ complexity: 0.5 })).toBe(0.10);
    });

    it("supports configurable cold-start priors", () => {
      const customPriors: MonetaryReferencePriors = {
        chatOrSimpleUsd: 0.01,
        standardUsd: 0.02,
        complexOrCodingUsd: 0.05,
        verificationUsd: 0.10
      };

      expect(resolveMonetaryReference({ type: "chat" }, customPriors)).toBe(0.01);
      expect(resolveMonetaryReference({ type: "coding" }, customPriors)).toBe(0.05);
      expect(resolveMonetaryReference({ inferencePhase: "OBJECTIVE_VERIFICATION" }, customPriors)).toBe(0.10);
      expect(resolveMonetaryReference({ complexity: 0.5 }, customPriors)).toBe(0.02);
    });

    it("supports extensible contextual resolver seam", () => {
      const customResolver = (context: MonetaryReferenceContext, priors: MonetaryReferencePriors) => {
        if (context.remainingBudgetUsd !== undefined && context.remainingBudgetUsd < 0.05) {
          return 0.005; // Emergency frugal reference
        }
        return priors.standardUsd;
      };

      const frugal = resolveMonetaryReference(
        { remainingBudgetUsd: 0.02 },
        DEFAULT_MONETARY_REFERENCE_PRIORS,
        customResolver
      );
      expect(frugal).toBe(0.005);

      const normal = resolveMonetaryReference(
        { remainingBudgetUsd: 1.00 },
        DEFAULT_MONETARY_REFERENCE_PRIORS,
        customResolver
      );
      expect(normal).toBe(0.10);
    });
  });
});
