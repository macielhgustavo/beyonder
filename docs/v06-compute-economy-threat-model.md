# Beyonder v0.6 — Compute Economy Threat Model

## Scope
Threats specific to the autonomous compute spending capability introduced in v0.6.

## Threat Categories

### T-1: Prompt Injection Budget Manipulation
**Scenario:** Adversarial prompt instructs the agent to increase budget, spend
more, or change compute mode.

**Impact:** Unbounded spend if caps can be modified.

**Mitigations:**
- Hard caps loaded from config at startup, stored in immutable runtime variables.
- `BudgetAccountant` provides no mutation API for cap values.
- Model output never flows through budget configuration paths.
- `ComputeMode` cannot be changed at runtime.
- **Invariant I-10** enforced structurally.

**Residual Risk:** None — architectural elimination, not behavioral guard.

---

### T-2: Malicious Tool Triggers Expensive Inference
**Scenario:** A tool call produces output that triggers the agent to invoke
many expensive inference requests.

**Impact:** Budget consumed faster than expected.

**Mitigations:**
- Per-objective hard cap limits total spend per objective.
- Per-inference max cost limits any single request.
- Phase budget reserves prevent producer from consuming verifier budget.
- Budget exhaustion transitions to NEEDS_BUDGET, not unbounded retry.
- `DEFAULT_TASK_BUDGET.maxRetries` and `maxReplans` bound execution attempts.

**Residual Risk:** Low — bounded by hard caps.

---

### T-3: Provider Reports Misleading Usage
**Scenario:** Provider API returns usage data that underreports actual billing,
or overreports to inflate cost records.

**Impact:** Budget accounting diverges from actual provider billing.

**Mitigations:**
- Reservation uses worst-case estimate (conservative).
- Actual cost from provider response settles the reservation.
- If actual > reserved → economic incident logged, provider paid route disabled.
- Provider billing API reconciliation planned for Phase 4+.

**Residual Risk:** Medium — depends on provider honesty. Mitigated by
per-provider and per-objective caps.

---

### T-4: Provider Price Changes Between Estimate and Execution
**Scenario:** Model pricing increases between when the pricing snapshot was
recorded and when the request is executed.

**Impact:** Actual cost exceeds estimate; reservation insufficient.

**Mitigations:**
- Pricing snapshots have `fetched_at` timestamps with freshness validation.
- Worst-case estimates include a configurable safety margin.
- If actual > reserved → economic incident (T-3 mitigation applies).
- Stale pricing beyond threshold blocks the billable route.

**Residual Risk:** Low — bounded by reservation + incident detection.

---

### T-5: Retry Storm
**Scenario:** Repeated failures cause rapid retry attempts, each consuming
budget through reservations.

**Impact:** Budget consumed on failed requests without useful output.

**Mitigations:**
- `TaskBudget.maxRetries` bounds retry count (default: 2).
- Each retry requires a new reservation, consuming budget atomically.
- Budget exhaustion → BUDGET_EXHAUSTED terminal state.
- `DefaultRecoveryPolicy` limits retries per step to 1.
- Circuit breaker on `maxConsecutiveFailures` (default: 3).

**Residual Risk:** Very low — multiple layers of circuit breaking.

---

### T-6: Concurrency Race Condition
**Scenario:** Multiple concurrent inference requests each check budget
independently and both proceed, exceeding total budget.

**Impact:** Over-spend beyond hard cap.

**Mitigations:**
- `BudgetAccountant.reserve()` uses `BEGIN IMMEDIATE` SQLite transactions.
- Budget check and reservation update are atomic within a single transaction.
- SQLite write lock serializes concurrent reservation attempts.
- **Invariant I-1** tested with concurrent reservation stress tests.

**Residual Risk:** None — structural prevention via transactional atomicity.

---

### T-7: Process Crash / Restart
**Scenario:** Process crashes between reservation and settlement.

**Impact:** Budget leak (orphaned reservations) or duplicate spend.

**Mitigations:**
- All reservation states persisted to SQLite before external calls.
- `recoverAfterRestart()` scans for orphaned reservations:
  - RESERVED (never sent) → RELEASED.
  - REQUEST_SENT (unknown outcome) → UNKNOWN_OUTCOME (conservatively charged).
- Idempotency keys prevent duplicate reservations on retry.
- **Invariant I-2** tested with crash simulation tests.

**Residual Risk:** Low — UNKNOWN_OUTCOME is conservative but may slightly
overcount. Reconciliation planned for Phase 4+.

---

### T-8: Compromised Model Tries to Change Budget
**Scenario:** A model's output includes instructions or data structures that
attempt to modify budget state.

**Impact:** Budget corruption if output can influence accounting.

**Mitigations:**
- `BudgetAccountant` is a typed API. Budget mutations only occur through
  `reserve()`, `settle()`, `release()` calls.
- Model output (string content) never touches budget tables.
- No `eval()`, `JSON.parse()` on model output flows into budget mutations.
- Budget tables are write-protected at the API level.

**Residual Risk:** None — no code path connects model output to budget state.

---

### T-9: Malformed Pricing Metadata
**Scenario:** Corrupted or adversarial pricing data causes incorrect cost
estimates (either too low or too high).

**Impact:** Too low → over-spend risk. Too high → unnecessary NEEDS_BUDGET.

**Mitigations:**
- Pricing snapshots validated on insertion (non-negative, finite, reasonable range).
- `confidence` field tracks data quality.
- Unknown pricing → route blocked (ADR-003).
- Pricing from `static_metadata` has lower confidence than `provider_api`.

**Residual Risk:** Low — validation and blocking prevent silent execution.

---

### T-10: Infinite Adjudication/Revision Loop
**Scenario:** Producer and verifier disagree repeatedly, each consuming budget
for inference.

**Impact:** Budget drained through infinite producer→verifier cycles.

**Mitigations:**
- `TaskBudget.maxReplans` bounds revision count (default: 2).
- Phase budget allocations reserve separate budgets for producer and verifier.
- Per-objective hard cap limits total spend regardless of phase.
- `maxNoProgressSteps` circuit breaker stops non-progressing execution.

**Residual Risk:** Very low — multiple bounds converge to termination.

---

### T-11: Provider Fallback to Expensive Model
**Scenario:** Provider silently routes a request to a more expensive model
than requested (e.g., OpenRouter fallback behavior).

**Impact:** Actual cost exceeds estimate for the requested model.

**Mitigations:**
- Request includes explicit `model` parameter.
- OpenRouter: use `:free` suffix for free routes explicitly.
- If provider supports `max_price` header, use it.
- If actual cost > reserved → economic incident, provider circuit break.
- Reservation covers worst-case for the *intended* model.

**Residual Risk:** Medium — depends on provider behavior. Defense in depth
through multiple cost barriers.

---

### T-12: No Auto Billing Enablement
**Scenario:** The agent autonomously adds a credit card, enables billing,
upgrades a plan, or increases an external spend limit.

**Impact:** Unbounded external billing exposure.

**Mitigations:**
- v0.6 explicitly prohibits auto billing enablement.
- `PROHIBITED_CAPABILITIES` in planner.ts already blocks `payment`, `purchase`,
  `account.create`.
- No tool exists for billing management.
- Documented as a hard constraint in architecture doc.

**Residual Risk:** None — no code path exists for these actions.
