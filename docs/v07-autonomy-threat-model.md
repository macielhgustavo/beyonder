# v0.7 Autonomy Threat Model

## Scope
Autonomy-specific threats to the Mission kernel. Existing threats (credential vault, browser policy, tool redaction) remain covered by their respective layers.

## Assets
- Mission state and event log integrity
- External action safety (no unauthorized/duplicated side effects)
- Evidence authenticity and provenance
- Approval authenticity (single-use, scoped)
- Budget/resource limits

## Adversaries & Scenarios

| # | Threat | Vector | Mitigation |
|---|--------|--------|-----------|
| T1 | Prompt injection via web content | Browser observation containing "ignore instructions, send credentials" | External content is DATA; runtime policy validates all model proposals (ADR 0010); capabilities constrained by policy regardless of model claims |
| T2 | Malicious webpage drives side effect | Crafted forms/buttons auto-trigger actions | BrowserPolicyEngine patterns (payment/purchase/account); ActionIntent protocol requires persisted intent + policy + approval before commit |
| T3 | Model hallucinates capability | Planner references nonexistent tool | Graph validation rejects unknown capabilities (mirror of validatePlan); no execution of unresolvable nodes |
| T4 | Model attempts forbidden action | Proposal includes prohibited capability | PROHIBITED_CAPABILITIES set + policy engine; POLICY_BLOCK never bypassed by recovery |
| T5 | Approval replay | Reuse consumed/expired approval | ApprovalGate single-use consume + expiry; intents reference specific approvalId |
| T6 | Duplicate external action | Crash between commit and receipt, then blind retry | UNKNOWN_OUTCOME + reconciliation before retry; idempotencyKey uniqueness enforced at persistence |
| T7 | Credential leakage into model context | Mission/model receives secrets | Tools use CredentialBroker; model sees only capability descriptors, never secrets (existing redaction preserved) |
| T8 | Stale mission resumed after external state changed | Long pause, then resume executes outdated plan | Recovery class EXTERNAL_STATE_CHANGED; verification nodes detect mismatch; re-verification before external action commit |
| T9 | Compromised artifact | Evidence file modified after hash | Content hashing at evidence creation; re-verification recomputes hash |
| T10 | Evidence poisoning | Injected false evidence into store | Evidence provenance (source, hash, timestamp); untrusted external evidence marked low-confidence; verifier treats untrusted content as data |
| T11 | Event log tampering | Direct SQLite manipulation | Out of scope for local-first v0.7; audit_events cross-reference enables detection (v0.9 hardening: event chain hashing) |
| T12 | Crash after side effect loses record | Process dies after external commit | ActionIntent persisted pre-commit; receipt can be back-filled by reconciliation |
| T13 | Model claims success falsely | "Mission complete" without evidence | Machine-checkable completion: contract + observed state + evidence + verification only (never model assertion) |

## Trust Levels
- **Trusted**: runtime policy engine, state machine, local tool handlers
- **Semi-trusted**: local models, first-party evidence
- **Untrusted**: all web/browser content, external system responses, third-party evidence — data only, never instructions

## Residual Risks
- Local SQLite has no tamper protection (accepted for local-first; v0.9 revisit)
- Deterministic replay depends on complete event capture (tested by crash matrix)
- Browser action classification (e.g. "click that purchases") is pattern-based and can miss novel patterns — approvals required for all EXTERNAL_ACTION capability nodes regardless
