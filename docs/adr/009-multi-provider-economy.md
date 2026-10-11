# ADR-009: Full Multi-Provider Economy, Phase Allocation & Value-Aware Routing

## Status
**Accepted**

## Context
Following Phase 3 (Live Paid Canary Execution, ADR-008), Beyonder v0.6 activates Phase 4: Full Multi-Provider Economy.
The system moves beyond the single canary provider route (`openrouter`) to support autonomous competition, value-aware selection, phase budget partitioning, and dynamic cost/quality learning across multiple cloud providers (OpenRouter, Gemini, Groq, Cerebras, Pollinations, and free tiers).

To operate a production compute economy safely and autonomously, the runtime must address key operational challenges:
1. **Multi-Provider Competition & Failover:** Models across distinct providers must compete on merit (quality, cost, latency, reliability). When an attempt on provider A fails (e.g. rate limit, outage, or transport timeout), the system must release the reserved budget and failover seamlessly to provider B or a free tier candidate without duplicating spend (Invariant I-2).
2. **Phase Budget Partitioning (Threat T-6 Mitigation):** Within an objective, a single execution phase (such as planning or producing code) must not be allowed to consume 100% of the objective's financial budget, leaving zero budget for objective verification or recovery replanning.
3. **Task Value-Aware Reference Scaling:** Different tasks carry vastly different economic stakes. Routing must dynamically calibrate cost sensitivity based on task complexity, domain requirements, and verification criticality.
4. **Closed-Loop Cost/Quality Learning:** Model performance priors must not remain static. Observed task outcomes and actual token costs must continuously update empirical quality and reliability metrics in memory.
5. **Zero-Cost Invariant (Invariant I-6):** In `zero_cost` mode, compute spend must strictly remain $0.00 regardless of the richness of the multi-provider candidate inventory.

---

## Decision

### 1. Multi-Provider Autonomous Dispatch & Failover
- **Candidate Pool Competition:** In `computeMode: "bounded"`, candidates from all configured and healthy providers (with valid credentials and fresh pricing snapshots) participate in live ranking and scoring.
- **Operator Whitelist (`allowedPaidProviders`):** Operators can optionally restrict billable execution to a designated subset of providers (e.g. `['openrouter', 'gemini']`). Candidates from non-whitelisted paid providers are rejected before reservation.
- **Failover Without Spend Duplication:** During `runCandidates` execution, if a candidate fails with a non-chargeable error or provider outage:
  1. The pre-dispatch reservation is immediately released via `budgetAccountant.release()`, restoring 100% of the unspent reserved funds to available balance.
  2. The dispatch loop advances to the next candidate in the selector's scored sequence (which may be from a different provider or free tier).
  3. A new reservation is atomically acquired for the fallback candidate.
  4. Upon successful completion, only the actual cost of the winning candidate is settled.

### 2. Hierarchical Phase Budget Allocation
Every objective budget account is partitioned into sub-accounts corresponding to execution phases, enforcing hard limits:
- **Producer Phase:** 60% of objective hard cap (`derivePhaseCap("producer", cap)`).
- **Verifier Phase:** 25% of objective hard cap (`derivePhaseCap("verifier", cap)`).
- **Recovery / Replanning Phase:** 15% of objective hard cap (`derivePhaseCap("recovery", cap)`).
- **Adjudication Phase:** 10% of objective hard cap (`derivePhaseCap("adjudication", cap)`).

In both live routing (`canAfford`) and shadow routing (`canAffordHypothetical`), worst-case costs are checked against the phase-specific budget account (`phase:${objectiveId}:${phase}`). A candidate whose worst-case cost exceeds its phase ceiling is rejected with `NEEDS_BUDGET`, preventing a runaway producer from starving subsequent verification or recovery phases.

### 3. Task Value-Aware Reference Scaling
In economic utility scoring, the hyperbolic cost normalization reference parameter (`monetaryReferenceUsd`) is dynamically scaled per task:
- **Routine Chat / Extraction (`complexity <= 0.4` or `type: "chat"`):** $\text{Reference} = \$0.05$. Cheap paid ($<\$0.001$) and free models outcompete expensive models, penalizing marginal gains heavily.
- **Standard Tasks (`0.4 < complexity < 0.8`):** $\text{Reference} = \$0.10$. Balanced cost/quality trade-off.
- **High-Complexity Tasks (`complexity >= 0.8`, coding, reasoning):** $\text{Reference} = \$0.25$. Elevated reference permits frontier models (e.g., Claude 3.5 Sonnet, DeepSeek R1) with material capability advantages ($+30\%$) to legitimately win.
- **Objective Verification (`inferencePhase: "OBJECTIVE_VERIFICATION"`):** $\text{Reference} = \$0.50$. Maximizes verifier accuracy and safety evidence.

### 4. Closed-Loop Cost/Quality Learning
- Task completion records structured outcomes via `memoryEngine.recordOutcome()` and `modelRouter.recordOutcome()`, appending an economic memory entry containing `provider`, `model`, `taskType`, `success`, `evaluationScore`, `latencyMs`, and `monetaryCostUsd`.
- `MemoryPerformanceRepository.get(provider, model, taskType)` dynamically aggregates these empirical observations into `HistoricalPerformance`.
- `predictCapability()` blends benchmark priors with real-world observed success rates and evaluation scores.
- Models with consistent high-quality execution gain positive ranking reinforcement; models exhibiting failures, invalid outputs, or high latency receive increased failure risk and lower utility.

---

## Invariants & Guardrails

| Invariant | Enforcement Mechanism |
|-----------|------------------------|
| **I-1 (Hard Budget Cap)** | Atomic SQLite transactions check all hierarchy levels (`global`, `monthly`, `daily`, `objective`, `phase`). |
| **I-2 (No Spend Duplication)** | Automatic pre-send release on failover; idempotent keys per attempt prevent double booking. |
| **I-4 (Price Verification)** | Invariant I-4 blocks any billable candidate without a verified fresh pricing snapshot. |
| **I-6 (Free Compute First-Class)** | Zero-cost mode strictly filters out paid routes; free tier candidates compete freely in bounded mode. |
| **I-9 (Authority Separation)** | Phase caps prevent producers from authorizing or monopolizing objective budgets. |

---

## Consequences
- Beyonder achieves full multi-provider compute economy maturity (`V06_FULL_ECONOMY_READY=true`).
- The agent autonomously buys compute from competing providers (OpenRouter, Gemini, Groq, Cerebras) strictly within human-authorized economic bounds.
- System transitions to Phase 4 Complete, unblocking autonomous operation and v0.7 autonomy kernel integration.
