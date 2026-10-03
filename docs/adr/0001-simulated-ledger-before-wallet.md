# ADR 0001: Use a Simulated Ledger Before Wallet Integration

## Status

Accepted

## Context

The project goal is an economically autonomous agent, but the initial capital is extremely limited and real wallet actions introduce security, legal, and operational risk.

## Decision

v0.1 uses a SQLite economic ledger with configurable starting capital. No private keys, wallets, or live payment rails are included.

## Consequences

- The agent can develop survival behavior before touching real money.
- Tests can validate economics deterministically.
- AgentKit and x402 remain research targets for later dry-run adapters.
