# ADR 0003: Keep Tools Disabled by Default

## Status

Accepted

## Context

Shell, browser, and filesystem tools are powerful enough to cause damage or spend money if exposed too early.

## Decision

v0.1 defines tool interfaces but returns disabled responses unless explicit environment flags enable them. Real implementations should add sandboxing, allowlists, and audit events before execution.

## Consequences

- The architecture can plan around tools without granting power prematurely.
- Future work can add controlled capabilities one at a time.
