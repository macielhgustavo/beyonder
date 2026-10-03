# ADR 0002: Zero-Cost-First Model Routing

## Status

Accepted

## Context

The runtime must be useful with near-zero capital. Paid model calls can quickly destroy the experiment before the economic loop is proven.

## Decision

The model router supports `none`, `ollama`, and `openai-compatible` providers. The default `.env.example` points at Ollama, while tests use `none`.

## Consequences

- The runtime can run locally with no API spend.
- Free API providers can be added through the OpenAI-compatible path.
- Paid providers must remain optional and budgeted.
