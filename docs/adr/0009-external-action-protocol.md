# ADR 0009: External Action Protocol — Intent, Receipt, and Unknown Outcomes

## Status
Accepted

## Context
External side effects (browser submissions, API calls, file writes, payments) are the riskiest operations. Once a request leaves the process, we cannot promise exactly-once semantics: connections drop after the server accepted the request. Blind retries can duplicate irreversible actions.

## Decision
All irreversible/external actions follow a protocol:

```
PREPARE (persist ActionIntent) → VALIDATE (policy + capability) →
APPROVE (if required, single-use scoped approval) → COMMIT (execute) →
RECEIPT (persist ActionReceipt) → VERIFY (observe result)
```

- **ActionIntent** is persisted *before* execution: what, why, target, parameters, idempotencyKey, risk, approval requirement
- **ActionReceipt** persisted after: provider, externalId, result, observedEffect
- **UNKNOWN_OUTCOME** state when commit result is lost (e.g. connection drop): no blind retry; reconcile first (query external state via read capability); retry only if provably safe
- Duplicate commits with the same idempotencyKey are rejected without reconciliation
- Compensation defined where reversal is genuinely possible (e.g. delete draft); never faked for irreversible actions

## Consequences
- **Positive**: Crash after side effect never loses record (intent persisted pre-commit)
- **Positive**: UNKNOWN_OUTCOME prevents duplicate irreversible actions
- **Positive**: v0.8 settlement evidence chains naturally to receipts
- **Negative**: Every external action requires two persistence steps
- **Integration**: Approvals reuse existing ApprovalGate (scoped, single-use, time-bounded)
