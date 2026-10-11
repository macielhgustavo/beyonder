# ADR-007: Value-Aware Cost Normalization in Economic Utility Scoring

## Status
**Accepted**

## Context
When routing intelligence tasks, candidates span several orders of magnitude in financial cost:
- Confirmed free tier routes: $0.00
- Highly efficient open-weight models: ~$0.0002 – $0.001
- Frontier reasoning and coding models: ~$0.015 – $0.05+

A naive linear cost penalty either drowns out quality differences (if scaled too leniently) or completely excludes paid models even when free models produce unacceptable quality (if scaled too aggressively). Furthermore, when all available candidates are free, normalization must avoid divide-by-zero errors.

## Decision
**Adopt hyperbolic cost normalization with task value-aware reference scaling for economic utility calculation:**

$$\text{monetaryPenalty} = \frac{\text{monetaryCostUsd}}{\text{monetaryCostUsd} + \text{monetaryReferenceUsd}}$$

$$\text{Utility} = \text{PositiveSignals} - \text{costSensitivity} \times \left( w_{\text{cost}} \cdot \text{monetaryPenalty} + w_{\text{shadow}} \cdot \text{shadowPenalty} + \dots \right)$$

Key design properties:
1. **Zero-Cost Continuity:**
   When $\text{monetaryCostUsd} = 0$, $\text{monetaryPenalty} = 0$. Free compute retains its full quality score without penalty, satisfying ADR-004.
2. **Sub-Linear Penalty for Cheap Paid Compute:**
   For cost-effective models where cost is far below reference (e.g., $\$0.0003 \ll \$0.10$), the penalty is minimal ($0.003$), allowing cheap paid models to easily outcompete degraded free models.
3. **Hyperbolic Ceiling for Expensive Compute:**
   As cost scales up, penalty asymptotes toward $1.0$. A model costing 40x more for a marginal $+2\%$ gain is heavily penalized and loses to cheaper alternatives.
4. **Task-Aware Scaling ($\text{monetaryReferenceUsd}$):**
   The reference parameter adapts to the task complexity and value:
   - Routine chat / extraction: standard reference ($\$0.05 - \$0.10$).
   - High-complexity coding / objective verification: elevated reference ($\$0.25 - \$0.50+$), allowing premium models with $+30\%$ capability gains to legitimately win.

## Rationale
1. **Mathematical Robustness:**
   Bounded in $[0, 1)$ across all non-negative cost values; strictly monotonic; continuous everywhere.
2. **Rational Economic Behavior:**
   Prevents "penny-wise, pound-foolish" failures on mission-critical verification while eliminating wasteful spend on trivial tasks.
3. **No Special-Case Branching:**
   Evaluates free, cheap paid, and premium paid compute through the identical scoring pipeline.

## Consequences
- Routing decisions reflect true marginal return on compute expenditure.
- The `calculateUtility` helper receives optional `monetaryReferenceUsd` to modulate cost sensitivity per task value.
