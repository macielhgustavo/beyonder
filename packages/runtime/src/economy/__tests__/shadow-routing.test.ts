import { describe, expect, it, beforeEach } from "vitest";
import { openDatabase } from "../../db/client.js";
import { AdaptiveModelSelector } from "../../models/adaptive-selector.js";
import { SqlitePricingRegistry } from "../pricing-registry.js";
import { seedCatalogPricing } from "../catalog-pricing.js";
import { DefaultCostEstimator } from "../cost-estimator.js";
import { BudgetAccountant } from "../budget-accountant.js";
import { resolveComputeEconomy } from "../compute-economy-config.js";
import { usdToMicros, ZERO_MICROS } from "../money.js";
import type { IntelligenceTask } from "../../intelligence/contracts.js";
import { createSpendDecisionRecord, formatSpendExplanation } from "../spend-decision.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("Compute Economy — Shadow Routing Integration", () => {
  let sqlite: ReturnType<typeof openDatabase>["sqlite"];
  let pricingRegistry: SqlitePricingRegistry;
  let costEstimator: DefaultCostEstimator;
  let budgetAccountant: BudgetAccountant;
  let tempDir: string;
  let providerStatePath: string;

  beforeEach(() => {
    sqlite = openDatabase(":memory:").sqlite;
    pricingRegistry = new SqlitePricingRegistry(sqlite);
    seedCatalogPricing(pricingRegistry);
    costEstimator = new DefaultCostEstimator();

    const economyConfig = resolveComputeEconomy({
      BEYONDER_COMPUTE_MODE: "zero_cost",
      BEYONDER_OBJECTIVE_HARD_CAP_USD: "0.25",
      BEYONDER_MONTHLY_HARD_CAP_USD: "0"
    });
    budgetAccountant = new BudgetAccountant(sqlite, economyConfig);

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "beyonder-shadow-test-"));
    providerStatePath = path.join(tempDir, "autopilot.json");
    fs.writeFileSync(
      providerStatePath,
      JSON.stringify({
        providers: {
          groq: {
            state: "READY",
            validation: {
              status: "validated",
              models: ["llama-3.3-70b-versatile"],
              latencyMs: 350
            }
          },
          openrouter: {
            state: "READY",
            validation: {
              status: "validated",
              models: ["meta-llama/llama-3.3-70b-instruct:free"],
              latencyMs: 500
            }
          }
        }
      })
    );
  });

  const sampleCodingTask: IntelligenceTask = {
    id: "task-code-audit",
    type: "coding",
    complexity: 0.85,
    requirements: { coding: true, reasoning: true }
  };

  it("evaluates paid candidates in shadow mode while executing free candidate at $0 monetary cost", async () => {
    const selector = new AdaptiveModelSelector(providerStatePath, {
      pricingRegistry,
      costEstimator,
      budgetAccountant,
      shadowMode: true,
      computeMode: "zero_cost",
      // Model capability priors
      capabilitySource: {
        getCapability: async ({ model }) => {
          if (model === "anthropic/claude-3.5-sonnet") {
            return { provider: "openrouter", model, taskType: "coding", score: 0.95, samples: 20, updatedAt: "2026-10-10" };
          }
          if (model === "llama-3.3-70b-versatile") {
            return { provider: "groq", model, taskType: "coding", score: 0.72, samples: 15, updatedAt: "2026-10-10" };
          }
          return null;
        }
      } as any
    });

    const decision = await selector.route(sampleCodingTask, "normal");

    // The live selected model MUST have monetaryCostUsd === 0 (Zero Cost Invariant)
    expect(decision.selected).toBeDefined();
    expect(decision.selected?.monetaryCostUsd).toBe(0);

    // Shadow decision MUST capture the superior paid candidate
    expect(decision.shadowDecision).toBeDefined();
    expect(decision.shadowDecision?.shadowMode).toBe(true);
    expect(decision.shadowDecision?.shadowCandidate).toBeDefined();
    expect(decision.shadowDecision?.shadowCandidate?.model).toBe("anthropic/claude-3.5-sonnet");
    expect(decision.shadowDecision?.shadowCandidate?.monetaryCostUsd).toBeGreaterThan(0);
    expect(decision.shadowDecision?.utilityDifference).toBeGreaterThan(0);

    // Structured explainability record
    const spendRecord = createSpendDecisionRecord(decision);
    expect(spendRecord.mode).toBe("shadow");
    expect(spendRecord.actualCostMicros).toBe(0);
    expect(spendRecord.estimatedCostMicros).toBeGreaterThan(0);

    const explanation = formatSpendExplanation(spendRecord, decision);
    expect(explanation).toContain("Spend Decision (SHADOW MODE)");
    expect(explanation).toContain("anthropic/claude-3.5-sonnet");
    expect(explanation).toContain("Actual Live Execution");
  });

  it("enforces Invariant I-4: rejects billable route when price snapshot is unknown", async () => {
    // Record a paid model in state that is NOT in the pricing registry
    fs.writeFileSync(
      providerStatePath,
      JSON.stringify({
        providers: {
          openrouter: {
            state: "READY",
            validation: {
              status: "validated",
              models: ["unregistered/unknown-paid-chat-model"],
              latencyMs: 500
            }
          }
        }
      })
    );

    const emptyPricingRegistry = new SqlitePricingRegistry(openDatabase(":memory:").sqlite);
    const selector = new AdaptiveModelSelector(providerStatePath, {
      pricingRegistry: emptyPricingRegistry,
      costEstimator,
      budgetAccountant,
      shadowMode: true
    });

    const decision = await selector.route(sampleCodingTask, "normal");

    // Candidate should be rejected due to unknown price (Invariant I-4)
    const rejected = decision.rejectedCandidates?.find(r => r.model === "unregistered/unknown-paid-chat-model");
    expect(rejected).toBeDefined();
    expect(rejected?.reasons.some(r => r.includes("Invariant I-4"))).toBe(true);
  });

  it("enforces Invariant I-3: blocks candidate when worst-case cost exceeds remaining budget", async () => {
    // Set a tiny objective cap of $0.001 (1,000 micros)
    const tinyEconomyConfig = resolveComputeEconomy({
      BEYONDER_COMPUTE_MODE: "zero_cost",
      BEYONDER_OBJECTIVE_HARD_CAP_USD: "0.001"
    });
    const tinyAccountant = new BudgetAccountant(sqlite, tinyEconomyConfig);

    const selector = new AdaptiveModelSelector(providerStatePath, {
      pricingRegistry,
      costEstimator,
      budgetAccountant: tinyAccountant,
      shadowMode: true
    });

    const decision = await selector.route(sampleCodingTask, "normal");

    // Claude 3.5 Sonnet worst-case cost is around $0.03-$0.04, exceeding $0.001
    const rejected = decision.rejectedCandidates?.find(r => r.model === "anthropic/claude-3.5-sonnet");
    expect(rejected).toBeDefined();
    expect(rejected?.reasons.some(r => r.includes("NEEDS_BUDGET"))).toBe(true);
  });
});
