# Adaptive Economic Router foundation

This stage evolves Beyonder from first-available routing to task-aware economic utility routing without adding benchmark persistence, paid-model automation, unrestricted tools, payments, wallets, or dashboard behavior.

## Runtime flow

```text
objective
  -> IntelligenceTask
  -> memory retrieval
  -> candidate generation
  -> capability + real-outcome history
  -> quota snapshot + shadow cost
  -> utility scoring under economic-state policy
  -> bounded exploration/selection
  -> deterministic evaluation
  -> accept / retry / escalate within limits
  -> outcome persistence
  -> real-world performance aggregation
```

The existing economic states remain unchanged: `growth`, `normal`, `defensive`, `survival`, and `halted`. Their routing behavior is centralized in `models/router-config.ts`; `halted` disables normal inference and `survival` uses one attempt, zero automatic monetary budget, and near-zero exploration.

## Shadow economy

`QuotaSnapshot` keeps exact values when they are known and the literal `unknown` when they are not. `AutopilotQuotaSource` reads catalog limits and provider rate-limit headers without inventing remaining quota. `ShadowCostCalculator` converts known scarcity, or a configurable conservative unknown-quota penalty, into an internal USD-equivalent resource cost. Monetary cost remains a separate metric.

`effectiveResourceCost` keeps monetary cost, shadow cost, retry penalty, and latency penalty as visible components. Intelligence efficiency may be derived from quality divided by effective resource cost, but the router does not use that ratio as its sole decision rule.

## Real-world performance

`MemoryPerformanceRepository` aggregates existing economic memories by provider/model/task type. It does not create a benchmark table or duplicate outcome persistence. It exposes samples, success/failure counts, evaluation score, latency, monetary cost, shadow cost, and attempts.

## BIB integration contract

The benchmark branch should implement the provider-agnostic interface in `models/capability-source.ts`:

```text
Beyonder Intelligence Benchmark
        |
        v
ModelCapabilitySource
        |
        +-----------------------+
                                v
real outcomes -> PerformanceRepository -> predicted capability -> AdaptiveModelSelector
```

A future BIB adapter only needs to implement:

```ts
interface ModelCapabilitySource {
  getCapabilityScore(input: {
    provider: string;
    model: string;
    taskType: IntelligenceTaskType;
  }): Promise<number | null>;
}
```

`predictCapability` treats that source as a prior and blends it with real-world outcomes as samples accumulate. If no benchmark prior exists, routing falls back to real outcomes, then existing provider metadata, then a conservative default. `packages/runtime` never imports `packages/benchmark`, so the benchmark package can depend on shared contracts or provide an adapter without introducing a circular dependency.

This stage intentionally does not modify or own `packages/benchmark` and does not add benchmark persistence.
