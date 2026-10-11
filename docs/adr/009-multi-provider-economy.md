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

### 2. Hierarchical Phase Budget Allocation (Overcommit-Proof)
Every objective budget account is partitioned into sibling accounts and subbudgets, guaranteeing `sum(reservableHardCommitments) <= objectiveHardCap`:
- **Producer Phase:** 60% of objective hard cap (`derivePhaseCap("producer", cap)`).
- **Verifier Phase:** 25% of objective hard cap (`derivePhaseCap("verifier", cap)`).
- **Recovery / Replanning Phase:** 15% of objective hard cap (`derivePhaseCap("recovery", cap)`).
- **Adjudication Phase (Subbudget):** Explicitly modeled as a child account of `verifier`, capped at 40% of the verifier cap (`derivePhaseCap("adjudication", verifierCap)` = 10% of total objective cap).

Because sibling hard caps ($60\% + 25\% + 15\% = 100\%$) and subbudgets use integer floor arithmetic, hard commitments across sibling phases can never exceed 100% of the parent objective hard cap.

### 3. Dispatch Failure Lifecycle & Speculative Concurrency Control
- **Speculative Billable Concurrency:** Speculative racing is disabled (`numberOfConcurrentBillableDispatchesPerDecision <= 1`).
- **Failure Classification:**
  - `PRE_DISPATCH`: Candidate rejected before transmission $\rightarrow$ `release()`.
  - `CONFIRMED_NOT_BILLED`: Upstream gateway explicitly rejects before model execution (HTTP 400, 401, 403, 404, 405, 422) $\rightarrow$ `release()`.
  - `CONFIRMED_BILLED`: Provider reports actual incurred charge $\rightarrow$ `settle()`.
  - `UNKNOWN_AFTER_DISPATCH`: Any uncertainty after socket write (timeout, socket reset, ECONNRESET, HTTP 500/502/503/504, response lost, malformed JSON, process crash) $\rightarrow$ `UNKNOWN_OUTCOME` via `budgetAccountant.markUnknown()`. The conservative commitment remains locked and can never be reused or spent as available capital.

### 4. Monetary Reference Decoupling (Bootstrap Priors & Context Seam)
Reference values ($0.05, $0.10, $0.25, $0.50) are treated as cold-start priors (`DEFAULT_MONETARY_REFERENCE_PRIORS`) rather than universal economic truths. An architectural seam (`MonetaryReferenceContext`, `MonetaryReferenceResolver`) allows dynamic resolution based on remaining budget, objective value, mission value, risk, and historical marginal utility.

### 5. Closed-Loop Learning & False-Success Protection
- Outome taxonomy: `VERIFIED_SUCCESS`, `UNVERIFIED_SUCCESS`, `FALSE_SUCCESS`, `REJECTED`, `SYSTEM_FAILURE`.
- **False-Success Poisoning Blocked:** When a candidate claims success but evaluation fails, it is classified as `FALSE_SUCCESS`. Positive reinforcement is strictly blocked; it is counted as a failure (`failures += 1`).
- **Role Segregation:** Performance records preserve role (`producer` vs `verifier`), provider, physical model, task class, verification confidence, and source. Producer and verifier performance are never merged blindly.

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
