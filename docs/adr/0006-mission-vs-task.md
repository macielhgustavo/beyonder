# ADR 0006: Mission vs Task — Fundamental Separation

## Status
Accepted

## Context
Beyonder v0.5 operates on **Tasks** — single, bounded units of work with a plan, steps, and completion evaluation. The roadmap requires **Missions** — high-level, long-duration objectives that may span multiple tasks, tools, verification cycles, approval gates, and recovery events.

The distinction:
- **Task**: "Research X" → plan → execute → complete
- **Mission**: "Find best opportunity, evaluate, execute, verify delivery" → graph of N tasks + verification + approval + recovery

## Decision
Introduce **Mission** as a first-class runtime concept separate from Task. A Mission:
- Contains a MissionGraph (DAG of nodes)
- Each node may execute one or more Tasks (via existing TaskExecutor)
- Has explicit state machine with validated transitions
- Maintains append-only MissionEvent log
- Requires evidence-based completion verification
- Supports pause/resume/crash-recovery across process boundaries

Tasks remain the execution unit; Missions are the orchestration unit.

## Consequences
- **Positive**: Enables long-running autonomous work with proper state management, recovery, and auditability
- **Positive**: TaskExecutor remains unchanged — Missions compose Tasks
- **Positive**: v0.8 economic cycle maps naturally to Missions with origin=OPPORTUNITY
- **Negative**: Additional complexity in scheduling and state management
- **Migration**: Existing Task-based flows work via adapter (Mission with single Task node)

## Implementation Notes
- Mission domain in `packages/runtime/src/missions/`
- New SQLite tables: `missions`, `mission_nodes`, `mission_events`, `mission_edges`
- Runtime API: `createMission(contract)`, `inspectMission(id)`, `pauseMission(id)`, etc.
- TaskExecutor reused as node execution engine via adapter pattern