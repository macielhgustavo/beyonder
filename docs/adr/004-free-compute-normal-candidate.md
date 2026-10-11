# ADR-004: Free Compute Remains Normal Candidate

## Status
**Accepted**

## Context
With paid compute available, there is a risk that routing logic could develop
a bias toward paid models (because they are often higher quality or more
reliable) and stop using free resources that were working perfectly well.

## Decision
**Free compute participates in the normal routing competition alongside paid
candidates. A free model with good performance data will naturally rank highly
because its monetary cost component is $0, giving it a permanent cost advantage
in the utility function.**

Specifically:
- Free models are NOT relegated to a "try free first, then paid" fallback chain.
- Free and paid candidates are scored by the same utility function.
- The monetary cost penalty applies equally — it just happens to be 0 for free models.
- A free model can outcompete a paid model if its predicted quality, reliability,
  and historical success are comparable.

## Rationale
1. The v0.5 architecture proved that free compute works for many tasks.
2. $0 cost is a genuine and enormous competitive advantage in utility scoring.
3. Treating free as "fallback" would create a second routing path, increasing
   complexity without benefit.
4. Market dynamics: free tiers change. A free model that performs well today
   should be used today, regardless of paid alternatives existing.

## Consequences
- The utility function must correctly handle the 0→positive cost range without
  introducing discontinuities.
- Free models may win even when paid models are available and affordable.
  This is correct behavior.
- Cost normalization must not divide by zero when all candidates are free.
