# ADR-003: Unknown Price Blocks Billable Request

## Status
**Accepted**

## Context
Some models on some providers may cost money but the Beyonder has no pricing
data for them. Executing such a request blind could result in arbitrary charges.

## Decision
**If a route is potentially billable (not confirmed free) and no trusted pricing
snapshot exists for the specific provider+model combination, the request MUST NOT
execute.**

"Potentially billable" means:
- Provider is not classified as `KEYLESS`.
- Provider classification is not `$0`.
- Model is not on the confirmed free model list with a fresh validation.

## Rationale
1. Worst-case cost estimation requires pricing data. Without it, we cannot
   compute the reservation amount.
2. A provider might list a model as available but charge for it (e.g., OpenRouter
   non-`:free` routes, Groq paid models).
3. Invariant I-4 demands this behavior explicitly.

## Consequences
- Some potentially useful models will be blocked until pricing data is obtained.
- The PricingRegistry must be populated before a provider can participate in
  paid routing.
- Free/keyless providers are unaffected — they bypass pricing requirements.

## Alternatives Considered
- **Use a maximum possible price as fallback:** Too conservative (could reserve
  $1+ per request) and prone to incorrect assumptions. Rejected.
- **Ask the operator for each unknown:** Better but introduces synchronous
  blocking. Deferred to `manual_approval` mode for later phases.
