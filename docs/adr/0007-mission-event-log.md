# ADR 0007: Append-only Mission Event Log with Materialized State

## Status
Accepted

## Context
Mission execution spans long durations (seconds to days) and must survive crashes, restarts, and operator inspection. The system must be able to reconstruct any mission's history for recovery, audit, replay (v0.9 chaos testing), and user-facing explainability (v1).

Alternatives considered:
1. Mutable state snapshots only (current v0.5 approach for TaskExecution) — loses history, hard to audit/replay
2. Full event sourcing for everything — overkill; tools/models already audit separately
3. **Event log + materialized state** — targeted application to Mission execution

## Decision
Mission execution uses an **append-only MissionEvent log** combined with **materialized MissionState**:
- Every state-relevant change emits an immutable event with versioned schema
- MissionState is derived/rebuilt from events on recovery
- Snapshots (materialized views) persisted for performance; events remain source of truth
- Existing `audit_events` table remains for operational telemetry; Mission events are a separate domain table with stronger schema

## Consequences
- **Positive**: Crash recovery = replay events + rebuild state
- **Positive**: Deterministic replay possible with event fixtures (v0.9)
- **Positive**: Full audit trail for explainability (v1)
- **Negative**: Storage growth — mitigated by per-mission retention policy (v0.9 concern)
- **Negative**: Dual-write consistency — events inserted in same SQLite transaction as state updates

## Event Schema
All events carry: `id`, `missionId`, `seq` (per-mission monotonic), `type`, `payload` (versioned JSON), `recordedAt`, plus `schemaVersion` on persisted objects.