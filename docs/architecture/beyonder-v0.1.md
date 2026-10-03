# Beyonder v0.1 Architecture

## Monorepo Layout

- `apps/cli`: `beyonder` command surface.
- `packages/runtime`: agent loop, config, SQLite/Drizzle schema, audit log, economic runtime, model routing, memory integration, and safe default tool execution.
- `packages/compute`: Autonomous Compute Acquisition Layer imported from the provider bootstrapper.
- `packages/credentials`: CredentialBroker/vault boundary for local secret handling.
- `packages/economy`, `packages/memory`, `packages/models`, `packages/tools`, `packages/audit`: package boundaries prepared for further extraction while runtime behavior remains preserved.

## Runtime Flow

1. Load `BEYONDER_*` config.
2. Initialize SQLite state, ledger, audit log, memory engine, tool registry, and model router.
3. Compute economic state from capital, revenue, expenses, and fixed monthly burn.
4. Retrieve relevant memories and compact them into a bounded context summary.
5. Route model choice with `auto`, preferring `$0` providers that are `READY` or keyless.
6. Execute the safe default tool when shell/browser/filesystem are restricted.
7. Store working, episodic, procedural, economic, and decision memory.
8. Record audit and ledger effects. The milestone flow has zero spend.

## Memory Engine

The first memory engine is deliberately small:

- working memory: current objective and immediate context.
- episodic memory: completed task/tool outcomes.
- semantic facts: durable facts can be recorded through `MemoryEngine.remember`.
- procedural lessons: reusable operating lessons.
- economic memory: state, balance, and cost context.

Retrieval is lexical relevance plus importance and type boosts, followed by simple context compaction.

## Compute Routing

`BEYONDER_MODEL_PROVIDER=auto` reads provider autopilot state from `.providers-vault/autopilot-state.json` and builds an inventory. It chooses zero-cost `healthy`/`keyless` providers first. If none are available, it returns provider `none` and continues deterministic zero-spend behavior.
