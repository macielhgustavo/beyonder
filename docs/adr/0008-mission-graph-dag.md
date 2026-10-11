# ADR 0008: Mission Graph — DAG over Linear Plans

## Status
Accepted

## Context
v0.5 plans are linear step lists with dependency checks (planner.ts). Real missions need branching: independent research paths, verification gates, optional fallback branches. Parallelism is a v0.7+ requirement, but concurrency must start conservative.

## Decision
Mission plans are represented as a **Directed Acyclic Graph (DAG)** of typed nodes:
- Node types: RESEARCH, PLANNING, EXECUTE, VERIFY, APPROVAL, WAIT, TRANSFORM
- Edges express dependencies; scheduler only picks nodes whose dependencies are COMPLETED
- Cycles rejected at validation time
- Replanning may replace subgraphs (local repair) rather than the whole graph
- v0.7 Foundation executes nodes sequentially (scheduler picks one READY node); the DAG structure guarantees parallelism is safe to add later without schema changes

## Consequences
- **Positive**: Local repair — failed subgraph replaced without losing completed work
- **Positive**: Parallelism enabled later without re-architecture
- **Positive**: Verification is a graph node, not hidden final step
- **Negative**: Graph validation complexity (cycle detection, missing deps, unknown capabilities)
- **Mitigation**: Deterministic validation with typed issues (mirrors existing PlanValidationIssue pattern)
