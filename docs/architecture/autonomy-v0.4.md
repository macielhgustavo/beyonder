# Autonomous Task Execution v0.4

The v0.4 execution path is explicit and bounded:

```text
objective -> plan -> validated steps -> one tool call -> observation
          -> checkpoint -> completion/recovery/replan/terminal state
```

`AutonomousTaskExecutor` is the orchestration boundary. It never calls Playwright or a browser session directly. Every action is a `ToolCall` that passes through the existing registry, schema validation, policy, budgets, executor, audit and telemetry layers.

## Contracts

The runtime task contracts define `TaskExecutionState`, `Plan`, `PlanStep`, `TaskBudget`, `StepContext`, `StepExecution`, `ExecutionCheckpoint` and `AutonomousTaskOutcome`. Terminal states are `COMPLETED`, `FAILED`, `BLOCKED`, `BUDGET_EXHAUSTED` and `CANCELLED`.

Every executed step creates a checkpoint with completed/pending steps, tool count, cost, observation summary and timestamp. The checkpoint model is sufficient for a future process-restart resume flow.

## Planning and recovery

`Planner` produces structured plans. `validatePlan` rejects malformed plans, unsupported capabilities, prohibited capabilities, invalid tools and invalid dependencies. `RecoveryPolicy` distinguishes retryable failures from policy denial and replan-worthy argument/tool failures. `Planner.revisePlan` receives the original objective, completed steps, failed step, observations, memory context and remaining budget; revised plans must increment `revision` and pass validation before execution resumes.

`CompletionEvaluator` verifies terminal state and optional deterministic criteria such as exact text or a JSON field. A model saying “done” is not sufficient by itself.

## Budgets and safety

Tasks require finite limits for steps, tool calls, retries, replans, duration, monetary cost, shadow cost, consecutive failures and no-progress repetitions. The development defaults are zero monetary cost, 12 steps and 20 tool invocations. Policy denial is terminal `BLOCKED`; it is never retried as a bypass attempt. Repeated identical action/observation pairs terminate with `NO_PROGRESS`.

## Deterministic autonomy evals

`pnpm autonomy:smoke` runs local fixtures through the real BrowserAgent and ToolExecutor for:

- hidden build-number discovery;
- multi-step release-note navigation;
- temporary tool failure and retry;
- `file://` policy blocking;
- step-budget exhaustion;
- no-progress detection.

The eval report keeps task completion, step success, recovery success, policy compliance, retries, replans, tool calls, steps, latency and both cost dimensions separate. The dedicated workflow is `.github/workflows/validate-autonomy.yml`.
