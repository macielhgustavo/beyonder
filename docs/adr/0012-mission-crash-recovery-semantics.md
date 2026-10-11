# ADR 0012: Crash/Recovery Semantics for Missions

## Status
Accepted

## Context
Missions outlive processes. A crash can occur at any point: before node claim, after model call, before/after side effect, before receipt, before verification. Each boundary needs defined recovery behavior.

## Decision
**Recovery procedure on restart** (deterministic):
1. Rebuild materialized state from event log + snapshots
2. Acquire mission leases (single-owner execution)
3. Stale RUNNING nodes → re-queued via recovery policy (bounded by per-node attempt limits)
4. ActionIntents without receipts → reconcile via UNKNOWN_OUTCOME protocol (ADR 0009), never blind retry
5. READY nodes continue; terminal missions untouched

**Recovery taxonomy** (failure classes): TRANSIENT, CAPABILITY_LOSS, BAD_OUTPUT, VERIFICATION_FAILURE, EXTERNAL_STATE_CHANGED, AUTH_REQUIRED, APPROVAL_REQUIRED, INPUT_REQUIRED, DEADLINE, RESOURCE_EXHAUSTED, POLICY_BLOCK, UNKNOWN_OUTCOME — each with a bounded policy.

**Invariants enforced** (tested):
1. Terminal missions never return to RUNNING
2. Nodes never run before dependencies complete
3. Node completion requires persisted outcome
4. External actions never commit without persisted ActionIntent
5. Required approvals never bypassed
6. Same intent never duplicates irreversible effects without reconciliation
7. Mission success requires contract satisfaction + evidence
8. Model output alone never mutates runtime state
9. Crash/restart never loses committed external action state
10. Cancelled missions start no new actions

## Consequences
- **Positive**: Long-running missions (days) are safe against process death
- **Positive**: v0.9 chaos testing = replay events + injected faults at transaction boundaries
- **Negative**: Every state transition must be transactional (event + state in one SQLite transaction)
