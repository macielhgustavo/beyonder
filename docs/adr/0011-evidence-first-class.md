# ADR 0011: Evidence as First-Class Runtime Entity

## Status
Accepted

## Context
v0.5 verification happens inside the verifier prompt; evidence exists only as prompt context. For v0.7 verification, v0.8 settlement, v0.9 audit, and v1 explainability, evidence must be a persistent, structured, queryable runtime entity with provenance.

## Decision
**Evidence** is a first-class domain object:
- Immutable record with `source`, `timestamp`, `contentHash`, `confidence`, `artifactRef`, `missionId`, `nodeId`
- Provenance categories: BROWSER (URL + excerpt + hash), TOOL (request/response IDs), FILE (path + hash + version)
- **Evidence Graph** relates evidence to claims: `SUPPORTED`, `CONTRADICTED`, `PARTIALLY_SUPPORTED`, `NOT_IN_EVIDENCE`
- Verifier reads persisted evidence (not prompt-passed); original artifacts remain for re-verification
- Compatible with existing verifier independence (model choice, provider)

## Consequences
- **Positive**: Settlement can reference immutable evidence chain
- **Positive**: v0.9 chaos testing can inject/poison evidence deterministically
- **Positive**: Explainability shows "why mission succeeded" with evidence trail
- **Negative**: Additional persistence and query complexity
- **Implementation**: `packages/runtime/src/missions/evidence/` — stores, graph relations, content hashing