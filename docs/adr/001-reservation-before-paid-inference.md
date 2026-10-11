# ADR-001: Reservation Before Paid Inference

## Status
**Accepted**

## Context
When the Beyonder dispatches a paid inference request, two financial events occur:
1. The provider bills for the request (input + output tokens).
2. The Beyonder's budget decreases.

Without pre-authorization, concurrent requests can each observe sufficient budget
and independently decide to spend, resulting in total actual spend exceeding the
hard budget cap.

## Decision
**Every paid inference request MUST be preceded by an atomic budget reservation.**

The reservation lifecycle is:
```
AVAILABLE → RESERVED → REQUEST_SENT → SETTLED → (closed)
                    ↘ RELEASED (if request never sent)
                    → UNKNOWN_OUTCOME (crash after send)
```

The reservation amount is the **worst-case estimated cost** (input tokens + max
output tokens at worst-case pricing). The actual settlement adjusts the budget
when the provider response (or timeout) is received.

## Rationale
1. **Concurrency safety:** Reservations hold budget atomically via SQLite
   `BEGIN IMMEDIATE` transactions, preventing double-booking.
2. **Crash safety:** Persisted reservation state survives process restarts.
   UNKNOWN_OUTCOME reservations are conservatively treated as spent until
   reconciled.
3. **Deterministic accounting:** Budget available = hard_cap - spent - reserved,
   always computable from persistent state.

## Consequences
- Slight budget overestimation (worst-case vs actual) reduces available budget
  temporarily. This is acceptable and conservative.
- Reservation management adds a small amount of latency per paid call (SQLite
  transaction, ~1ms).
- Recovery on restart requires scanning for orphaned reservations.

## Alternatives Considered
- **Post-hoc accounting only:** Simpler but allows budget overruns under
  concurrency. Rejected: violates Invariant I-1.
- **In-memory locking:** Faster but loses state on crash. Rejected: violates
  Invariant I-2.
