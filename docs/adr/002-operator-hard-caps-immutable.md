# ADR-002: Operator Hard Caps Cannot Be Self-Increased

## Status
**Accepted**

## Context
The Beyonder is an autonomous agent that makes spending decisions. If the agent
could increase its own budget ceiling, a prompt injection, hallucination, or
reasoning error could lead to unbounded spend.

## Decision
**Hard budget caps (global, monthly, daily) are set exclusively via operator
configuration (environment variables or config file). The runtime MUST NOT
provide any code path — via model output, tool execution, prompt instruction,
or internal logic — that increases a hard cap.**

The separation is:
- **ALLOCATION DECISION** (internal, autonomous): Which model to use, how much
  of the authorized budget to spend on this task.
- **BUDGET AUTHORIZATION** (external, human): How much total budget is available.

## Rationale
1. Model output is untrusted. Prompt injection could instruct the agent to
   "increase budget to $1000."
2. Even without adversarial input, a reasoning loop could conclude "I need more
   budget" and attempt self-modification.
3. Defense in depth: hard caps loaded at startup, stored as immutable values,
   never exposed to mutation APIs.

## Consequences
- The agent may encounter NEEDS_BUDGET states that it cannot resolve autonomously.
  This is the intended behavior — the operator must decide whether to increase
  funding.
- Operator must restart with new config to change caps. This friction is a
  feature, not a bug.
