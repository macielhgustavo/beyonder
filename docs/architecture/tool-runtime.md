# Tool Runtime

The Tool Runtime is the single generic boundary for external or deterministic actions in Beyonder. Intelligence and higher-level runtime code discover and request tools through uniform contracts; individual tools do not bypass validation, policy, budgets, timeout handling, normalization, or audit.

## Package boundary

`@beyonder/tools` owns the generic contracts and execution machinery. It intentionally does not depend on `@beyonder/runtime` or on a concrete browser implementation.

`@beyonder/runtime` supplies runtime-specific adapters: the existing economic state is passed into `ToolContext`, the existing `AuditLog` receives tool telemetry, built-ins are registered centrally, and `BeyonderRuntime.getAvailableTools(context)` exposes policy-filtered descriptors to the Intelligence Layer/model.

This direction avoids the previous circular `tools -> runtime` dependency and lets independent tool implementations depend only on the generic tool package.

## Execution flow

```text
ToolCall
  -> registry lookup / availability
  -> input schema validation
  -> policy + budget evaluation
  -> authorized execution with AbortSignal + timeout
  -> result normalization
  -> redacted audit telemetry
  -> ToolExecutionResult
```

`ToolExecutor` performs one invocation only. It never creates an internal retry loop; retry, escalation, or replanning remain responsibilities of the higher-level runtime.

## Core contracts

- `ToolDefinition<TInput, TOutput>`: identity, description, schema, risk, side effects, capabilities, availability, timeout/cost metadata, and the handler.
- `ToolInputSchema<T>`: `safeParse`-compatible validation contract plus optional JSON Schema for model-facing discovery. The shape is compatible with adapters around Zod without coupling this package to Zod itself.
- `ToolCall`: structured `{ id, tool, arguments }` request produced by a model/runtime.
- `ToolContext`: task identity, economic state, environment metadata, and budget/usage snapshots.
- `ToolExecutionResult<T>`: normalized success/output or structured error, duration, declared side effects, and safe metadata.
- `ToolRegistry`: central registration, duplicate protection, lookup, capability discovery, availability, and model-facing descriptors.
- `ToolPolicy`: centralized authorization contract.
- `ToolAuditSink`: telemetry adapter for the required tool lifecycle events.

## Risk and side effects

Risk is centralized as `NONE`, `LOW`, `MEDIUM`, `HIGH`, and `CRITICAL`.

Side effects are centralized as `NONE`, `READ`, `WRITE`, `EXTERNAL_ACTION`, `FINANCIAL`, and `SYSTEM`.

The default policy auto-authorizes only `NONE`/`LOW` risk tools whose declared effects are `NONE` or `READ`. Mutating, external, financial, system-level, or higher-risk tools are denied unless a future explicit policy authorizes them. Permission logic therefore stays out of individual handlers.

## Economic state and budget

Tool policy consumes the economic state already classified by Beyonder. It does not introduce new economic thresholds.

- `halted`: normal tool execution is denied by default.
- `survival`: only safe, non-mutating tools remain eligible, even if a future broader policy is configured.

`ToolBudget` and `ToolBudgetUsage` already carry invocation count, time, monetary cost, and shadow-cost fields. The executor/policy can enforce supplied limits without implementing a second economic engine.

## Errors and timeouts

Tool failures exposed to callers use stable codes:

- `TOOL_NOT_FOUND`
- `INVALID_ARGUMENTS`
- `POLICY_DENIED`
- `TIMEOUT`
- `EXECUTION_ERROR`
- `UNAVAILABLE`

Every authorized invocation races against a finite timeout and receives an `AbortSignal`. Raw stack traces are never returned to the model. Error messages and audit payloads redact common secret-bearing keys, bearer tokens, and inline token/password/API-key values.

## Audit lifecycle

The runtime emits:

```text
tool.requested
tool.validated
tool.authorized
tool.denied
tool.started
tool.completed
tool.failed
```

Events include call/tool identity, task when available, economic state, risk, declared side effects, duration/status where applicable, and redacted arguments/error metadata. `RuntimeToolAuditSink` maps these events onto the existing runtime `AuditLog`.

## Built-in safe tools

The generic registry currently includes only useful deterministic examples:

- `calculator`: structured finite-number arithmetic.
- `json.parse`: deterministic JSON parsing.
- `safe-objective`: runtime adapter preserving the existing objective-normalization step.

Shell/filesystem/payment/message/account/destructive tools are not granted by the default policy and are not synthesized merely to increase tool count.

## Intelligence discovery

Callers can use:

```ts
await runtime.getAvailableTools({
  taskId,
  economicState,
  environment,
  budget,
  budgetUsage
});
```

The returned descriptors have already passed availability and policy filtering and include capabilities plus model-facing input-schema metadata when provided.

## BrowserAgent integration contract

The browser branch should implement the generic contract rather than introduce a parallel execution path:

```ts
import type { ToolDefinition } from "@beyonder/tools";

export type BrowserTool = ToolDefinition<BrowserAction, BrowserObservation>;
```

The concrete BrowserAgent/Playwright implementation is deliberately outside this branch. A read-only browser action should declare the appropriate low risk and `READ` side effect; mutating browser actions should declare `WRITE` and/or `EXTERNAL_ACTION` and will therefore be denied by the safe default policy unless explicitly authorized later.

Browser availability belongs on the tool definition/registration boundary (for example, based on environment support), not in scattered runtime imports or permission `if` statements.
