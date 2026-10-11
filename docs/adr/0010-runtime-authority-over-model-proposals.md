# ADR 0010: Runtime Authority over Model Proposals

## Status
Accepted

## Context
LLMs produce text; the runtime owns state. If model output could directly mutate MissionState, mark nodes complete, authorize tools, or approve spending, the system would be unsafe: hallucinations and prompt injection become privilege escalation.

## Context in codebase
v0.5 already follows this partially: `LlmPlanner` output passes through `validatePlan` (planner.ts:125) before execution; `DeterministicCompletionEvaluator` rejects "model said done". The Mission kernel extends this to every mutation.

## Decision
**Absolute rule**: model output is a PROPOSAL. The runtime:
1. Parses proposals against strict schemas (domain-specific, no universal JSON blob)
2. Validates against policy, capabilities, budget, graph, and state machine
3. Applies only valid proposals; invalid ones trigger replan/failure, never partial application

Model can never: alter MissionState directly, mark nodes completed, authorize tools, approve side effects, or change policy.

## Consequences
- **Positive**: Prompt injection in web content cannot escalate (it's data, not authority)
- **Positive**: Deterministic runtime rules are testable without model calls
- **Negative**: Planner must produce well-structured proposals; runtime must handle malformed ones gracefully (bounded candidates + deterministic fallback, mirroring LlmPlanner pattern)
