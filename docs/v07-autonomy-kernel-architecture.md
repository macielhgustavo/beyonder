# Beyonder v0.7 Autonomy Kernel Architecture

## Domain Model Overview

The Autonomy Kernel introduces **Mission** as the primary unit of long-term, goal-directed work, superseding the task-centric model of v0.5/v0.6 while preserving full backward compatibility. A Mission encapsulates objective, success criteria, required evidence, constraints, and the runtime state needed for autonomous execution over extended periods.

### Core Entities

1. **MissionContract** - Declarative specification of what must be achieved
   - `objective`: High-level goal statement
   - `successCriteria`: Machine-verifiable conditions for completion
   - `failureConditions`: Conditions that terminate mission as failed
   - `requiredEvidence`: Evidence artifacts that must be collected
   - `constraints`: Time, budget, resource, and policy limits
   - `completionSemantics`: How success is determined (evidence+verification+state)

2. **MissionState** - Explicit runtime state machine
   - `CREATED` → `READY` → `RUNNING` → `WAITING_*` → `VERIFYING` → `SUCCEEDED`/`FAILED`/`CANCELLED`
   - Terminal states: `SUCCEEDED`, `FAILED`, `CANCELLED` (no transitions out)
   - Valid transitions enforced by runtime policy engine

3. **MissionEvent** - Append-only audit trail
   - Events: `MISSION_CREATED`, `PLAN_ACCEPTED`, `NODE_STARTED`, `TOOL_CALLED`, 
     `OBSERVATION_RECORDED`, `EVIDENCE_ATTACHED`, `NODE_COMPLETED`, 
     `NODE_FAILED`, `REPLAN_REQUESTED`, `APPROVAL_REQUIRED`, `APPROVAL_GRANTED`,
     `ACTION_COMMITTED`, `VERIFICATION_COMPLETED`, `MISSION_COMPLETED`
   - Enables replay, recovery, audit, and explainability

4. **MissionGraph** - Directed acyclic graph of mission nodes
   - Nodes represent units of work with semantic types:
     - `RESEARCH`: Information gathering
     - `PLANNING`: Strategy formulation
     - `EXECUTE`: Tool/browser/model actions
     - `VERIFY`: Local verification checks
     - `APPROVAL`: Human/gate approvals
     - `WAIT`: External condition monitoring
     - `TRANSFORM`: Data processing/synthesis
   - Dependencies expressed via DAG edges
   - Enables parallelism where dependencies allow

5. **Capability** - Unified semantic ability abstraction
   - Declarative interface: inputs, outputs, sideEffectLevel, risk, idempotency
   - Examples: `WEB_READ`, `FILE_WRITE`, `CODE_EXECUTE`, `FORM_SUBMIT`, `EMAIL_SEND`
   - Runtime resolves to concrete implementations (tools, browser actions, model calls)
   - Separates *what* can be done from *how* it's implemented

6. **Evidence** - First-class runtime entity
   - Immutable record of observation with provenance
   - Fields: `source`, `timestamp`, `contentHash`, `confidence`, `artifactRef`
   - Related to claims via `SUPPORTED`, `CONTRADICTED`, `PARTIALLY_SUPPORTED` relations
   - Persisted independently of prompts/context

7. **ActionIntent/Receipt** - External action protocol
   - **ActionIntent** (pre-side-effect): `what`, `why`, `target`, `parameters`, `risk`, `approvalReq`
   - **ActionReceipt** (post-side-effect): `provider`, `timestamp`, `externalId`, `result`, `observedEffect`
   - Enables idempotency, reconciliation, and UNKNOWN_OUTCOME handling

### Key Architectural Decisions

1. **Runtime Authority Principle**: Model outputs are proposals; runtime validates and enforces
   - Model cannot directly mutate MissionState, authorize tools, or approve spending
   - All mutations flow through validated transitions and policy checks

2. **Event Sourcing for Missions**: MissionEvent log + materialized MissionState
   - Provides crash recovery, replay capability, and audit trail
   - Snapshots/materialized views used for performance where beneficial

3. **Capability-First Planning**: Planner works with capabilities, not specific tools
   - Reduces prompt size and increases robustness to tool availability changes
   - Runtime maps capabilities to available implementations via resolver

4. **Bounded Autonomy**: All recovery, replanning, and retries have explicit limits
   - Mission/node max attempts, replans, deadlines, resource budgets
   - Integrates with v0.6 economic authority via abstract ResourceEnvelope interface

5. **Side Effect Classification**: Irreversible actions require explicit ActionIntent protocol
   - READ operations ≠ WRITE/EXTERNAL_ACTION/FINANCIAL
   - Prevents accidental side effects through policy enforcement

### Integration Seams

- **v0.6 Economic Integration**: Abstract `ResourceAuthority` interface for time/compute/money
  - Future implementation will plug in SpendGovernor without changing kernel
- **v0.8 Opportunity Integration**: Mission can have origin: INTERNAL|USER|OPPORTUNITY
  - Opportunity-derived missions carry economic metadata but don't require it
- **v0.9 Chaos Testing**: Designed for deterministic replay and fault injection seams
- **v1 Explainability**: Full event trace + evidence graph supports reconstruction

### Data Persistence

SQLite tables added:
- `missions`: MissionContract + current state + timestamps
- `mission_nodes`: Graph nodes with dependencies, state, attempts
- `mission_events`: Append-only event log (idempotent inserts)
- `mission_edges`: DAG dependencies between nodes
- `evidence`: Evidence records with content hashes
- `action_intents`: Pre-action intentions for external effects
- `action_receipts`: Post-action results for reconciliation

All changes use existing Drizzle + better-sqlite3 infrastructure with WAL mode.

## Mission Lifecycle

1. **Creation**: MissionContract submitted → validated → persisted as CREATED
2. **Planning**: Planner generates MissionGraph proposal → runtime validates → PLAN_ACCEPTED
3. **Execution**: Scheduler picks READY nodes → executes with leases → NODE_STARTED/COMPLETED
4. **Waiting**: Nodes wait for input/approval/resources → WAITING_* state
5. **Verification**: Nodes produce evidence → VERIFYING → success/failure
6. **Replanning**: Failures trigger localized/graph/global replan based on policy
7. **Completion**: All success criteria met + evidence verified → MISSION_COMPLETED
8. **Failure/Cancellation**: Terminal states recorded with reasons

## Scheduler & Concurrency

- Chooses READY nodes (dependencies satisfied, resources available, policy allows)
- Respects mission-level deadlines and budgets
- Avoids race conditions via atomic state transitions + event logging
- Future priority support: high-priority missions can preempt background work

## Security Boundaries

- All external content treated as DATA, never authority
- Prompt injection defended by runtime policy validation of model proposals
- Evidence provenance tracking prevents trust spoofing
- Credentials never flow to model/planner layer (handled by tool adapters)

## Compatibility Guarantees

- v0.5 Tasks continue to work via Mission adaptation layer
- v0.6 Economic systems plug into ResourceAuthority seam
- v0.8 Economic cycle integrates via mission origin metadata
- v0.9 Chaos testing supported by deterministic event replay
- v1 Explainability built on event log + evidence graph
