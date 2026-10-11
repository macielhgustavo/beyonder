# ADR-008: Live Paid Canary Execution & Two-Phase Spend-Commit

## Status
**Accepted**

## Context
Following Phase 1 (Economic Foundation) and Phase 2 (Shadow Paid Routing & Pricing Discovery), Beyonder v0.6 activates Phase 3: Live Paid Canary Execution. The autonomous agent must transition from evaluating paid models purely in shadow mode to executing live financial inference transactions under strict, deterministic safety guarantees.

Live paid compute introduces real financial liability. The runtime must enforce:
1. **Invariant I-1:** Actual spend MUST NEVER exceed an authorized hard budget at any level of the hierarchy.
2. **Invariant I-2:** Retries, crashes, and process restarts MUST NOT duplicate reserved or accounted spend.
3. **Invariant I-3:** Worst-case cost cannot exceed remaining applicable budget.
4. **Invariant I-4:** Unknown price on a potentially billable route MUST NOT silently execute.
5. **Invariant I-5:** Actual provider-reported cost overrides estimates when available.
6. **Invariant I-6:** Free compute routes MUST remain strictly at $0.00 actual monetary spend.

## Decision
**Implement the Two-Phase Spend-Commit pipeline in core inference dispatch (`runCandidates`) and enable bounded live canary execution with multi-layer canary guardrails.**

### 1. Two-Phase Spend-Commit Pipeline
Every billable inference dispatch adheres to a strict state machine lifecycle:
- **Phase 1 (Pre-Dispatch Reservation):** Before network transmission, `budgetAccountant.reserve` atomically checks hierarchical budgets (`global`, `monthly`, `daily`, `objective`, `phase`) and locks worst-case estimated cost (`worstCaseMicros`). If any budget level is insufficient, reservation fails (`null`), and the router falls over cleanly to alternative candidates (or free tier).
- **Phase 2 (In-Flight Marking):** Immediately before HTTP socket write / `input.complete`, the reservation is marked as `REQUEST_SENT` (`budgetAccountant.markSent`), recording timestamp and request correlation.
- **Phase 3 (Post-Dispatch Settlement):** Upon receiving the provider response:
  - Actual cost is extracted (provider-reported `usage.cost` or calculated via pricing snapshot and observed token counts).
  - `budgetAccountant.settle` records actual spent microdollars into `spent_micros` and releases the unspent difference (`worst_case - actual`) back to available budget across all hierarchy accounts.
  - Actual spend is persisted to the append-only `EconomicLedger` (`expense` entry).
- **Phase 4 (Failure Release / Settle):**
  - If dispatch is cancelled or fails before network send, or fails with a confirmed non-chargeable error (e.g. HTTP 400, 401, 404, 429, 500, pre-connection timeout), `budgetAccountant.release` releases 100% of reserved funds back to available budget.
  - If a gateway/provider reports partial charges (`reportedMonetaryCostUsd > 0`), the reservation is settled with that actual cost.

### 2. Multi-Layer Canary Guardrails
To prevent unbounded financial exposure during early rollout:
1. **Canary Hard Cap:** Single inference spend is strictly capped at $\le \$0.01$ (or operator-configured limit). Candidates exceeding this worst-case ceiling are blocked before reservation (`BUDGET_EXHAUSTED`).
2. **Single Provider Canary Route:** Live execution is restricted to the operator-designated canary provider (defaulting to `openrouter`). Billable candidates from non-canary providers remain blocked.
3. **Deterministic Idempotency Key:** Every attempt generates a unique key (`${taskId}:${stepId}:${phase}:${provider}:${model}:attempt_${attemptNumber}`). SQLite unique constraints prevent duplicate reservations across retries or restarts.
4. **Economic Circuit Breaker:** If a provider reports an anomalous cost exceeding $1.5\times$ worst-case estimate or exceeding the canary ceiling, the circuit breaker trips, settles the reported charge for accounting integrity, and halts execution with `ECONOMIC_POLICY_BLOCKED`.

### 3. Selector Live Mode Integration
In `AdaptiveModelSelector`:
- When `computeMode: "bounded"` and `shadowMode: false`, paid candidates are assigned tier `PAID_CLOUD` and can be chosen as `selected` if their net utility exceeds all free alternatives.
- When `computeMode: "zero_cost"` or `shadowMode: true`, paid candidates remain strictly in shadow mode, maintaining the $0.00 actual monetary spend invariant.

## Rationale
1. **Atomic Concurrency Protection:** Serialized SQLite transactions prevent race conditions from ever over-subscribing operator hard caps.
2. **Crash & Leak Resilience:** Unused reservations automatically return to the budget on failure or crash recovery (`recoverAfterRestart`).
3. **Zero-Cost Preservation:** Zero-cost mode behavior and tests remain 100% unaffected and backward-compatible.

## Consequences
- Live paid inference can execute autonomously within operator-configured boundaries.
- Every cent of spend is accounted for, settled, and audited in the `EconomicLedger`.
- Enables Phase 3 qualification (`V06_LIVE_CANARY_READY=true`).
