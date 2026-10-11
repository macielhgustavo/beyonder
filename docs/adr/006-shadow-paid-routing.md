# ADR-006: Shadow Paid Routing & Zero-Spend Evaluation

## Status
**Accepted**

## Context
Beyonder v0.6 introduces paid compute candidates into the model routing ecosystem alongside existing zero-cost free tiers. Before activating live financial transactions in production (Phase 3 canary), the routing engine, pricing discovery, and economic utility models must be thoroughly tested against live provider conditions without incurring real monetary charges.

## Decision
**Implement Shadow Paid Routing as an explicit, verifiable routing mode where paid candidates compete in utility scoring and selection ranking, but live execution is strictly confined to free tiers with guaranteed $0.00 actual expenditure.**

Specifically:
1. **Candidate Ingestion:**
   When `shadowMode: true` (or `computeMode: "zero_cost"`), the `AdaptiveModelSelector` queries the `PricingRegistry` for registered paid models matching task workload requirements.
2. **Pre-Selection Enforcement:**
   Every paid candidate is validated against Invariant I-4 (unknown or stale price snapshot strictly blocks billable route) and Invariant I-3 (worst-case cost exceeding remaining applicable budget triggers `NEEDS_BUDGET` rejection).
3. **Shadow Ranking & Explainability:**
   Paid and free candidates compete under identical utility scoring. If a paid candidate wins on net utility, it is captured in `RouteDecision.shadowDecision` as `shadowCandidate`, accompanied by a structured `SpendDecisionRecord` answering "why spend / why not free".
4. **Zero-Spend Invariant Guarantee:**
   The `selected` model dispatched for actual network inference MUST have `monetaryCostUsd === 0`. If all free candidates are exhausted or unviable, `selected` is `undefined` (`NEEDS_CAPABILITY`) and no live paid inference is initiated.
5. **Shadow Run Reporting:**
   The `ShadowReportGenerator` aggregates routing outcomes across tasks into Markdown and JSON reports detailing would-win counts, hypothetical spend, and empirical utility gains.

## Rationale
1. **Zero Financial Risk:**
   Ensures complete safety during pricing discovery and model ranking calibration.
2. **Empirical Quality Proof:**
   Proves whether and where premium models (e.g. Claude 3.5 Sonnet, GPT-4o) materially outperform free models (Groq, OpenRouter free) on real user tasks before committing operator funds.
3. **Strict Verification:**
   Establishes comprehensive acceptance testing across all 15 specification failure and edge-case scenarios prior to live canary deployment.

## Consequences
- Requires dual candidate tracking in `RouteDecision` (`selected` vs `shadowDecision`).
- `ShadowReportGenerator` provides operator visibility into hypothetical compute ROI.
- Enables safe transition to Phase 3 canary with high confidence in routing decisions.
