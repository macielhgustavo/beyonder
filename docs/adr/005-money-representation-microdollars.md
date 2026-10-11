# ADR-005: Money Representation — Integer Microdollars

## Status
**Accepted**

## Context
Financial accounting requires deterministic arithmetic. IEEE 754 floating-point
numbers (JavaScript `number`) introduce rounding errors that can accumulate
over many transactions.

Current system uses `real` (float64) in SQLite for `amount_usd`. This is
acceptable for the v0.5 zero-cost ledger but inadequate for real money tracking.

## Decision
**All internal monetary values are represented as integer microdollars
(1 USD = 1,000,000 micros). Type alias: `Microdollars`.**

```typescript
export type Microdollars = number & { readonly __brand: 'Microdollars' };
```

- SQLite column type: `INTEGER` (64-bit, supports values up to ~9.2 trillion
  microdollars = ~$9.2 million, far exceeding operational needs).
- USD float values exist only at external boundaries:
  - Config input: `dailyHardCapUsd: 1.00` → stored as `1_000_000` micros.
  - Display output: `1_000_000` micros → displayed as `$1.00`.

## Rationale
1. **Deterministic:** Integer addition is exact. No rounding drift.
2. **Sufficient precision:** $0.000001 (1 micro) is fine-grained enough for
   per-token cost accounting.
3. **Simple:** No dependency on decimal arithmetic libraries.
4. **Safe range:** JavaScript `Number.MAX_SAFE_INTEGER` = 9,007,199,254,740,991,
   which represents ~$9 billion in microdollars. Adequate.
5. **Standard practice:** Stripe, financial systems, and blockchain use integer
   minor units (cents, micros, satoshis).

## Consequences
- All code must use conversion functions at boundaries: `usdToMicros()`,
  `microsToUsd()`.
- The existing `LedgerSummary.balanceUsd: number` fields remain as display
  values but internal accounting uses microdollars.
- Comparison operators work naturally on integers.
- Division (for averages) must use `Math.round()` to stay in integer domain.

## Alternatives Considered
- **`Decimal.js` library:** More precise for arbitrary decimal but adds a
  dependency and serialization complexity. Rejected: microdollars are simpler
  and sufficient.
- **Integer cents (1 USD = 100):** Insufficient precision for per-token costs
  (e.g., $0.00015 per 1K tokens). Rejected.
- **Integer millicents (1 USD = 100,000):** Close but 1 micro = $0.00001 is
  still coarser than some per-token prices. Microdollars (6 decimals) are safer.
