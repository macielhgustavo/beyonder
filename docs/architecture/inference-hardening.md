# Control Center inference hardening

The classifier keeps the task type while independently describing tool use,
calculation, browser, direct response, planning, coding, reasoning, structured
output and vision requirements. Portuguese and English objectives are covered.

Model selection uses actual workloads rather than mapping every non-coding task
to chat. Catalog roles take precedence, with conservative role inference for
uncatalogued model IDs. Guard, embedding, reranking and specialized-only models
cannot win ordinary assistant workloads. Structured output distinguishes native,
prompted, unsupported and unknown; unsupported is excluded when required and
unknown receives a utility penalty. JSON action planning does not require native
function calling.

Costs belong to models: FREE_CONFIRMED, FREE_TIER_ELIGIBLE, UNKNOWN_COST or PAID.
Discovering a model does not prove that it is free. Current zero-money policies
exclude unknown and paid models. Catalog free-tier eligibility is not a live
billing/quota guarantee; the existing account's free-tier limits still apply.
Generic explicitly configured OpenAI-compatible endpoints without price evidence
are excluded from zero-money task routing.

Ollama discovery reads `/api/tags` and `/api/show` at the configured URL, with
bounded timeouts. It never pulls models. Completion-capable local models enter
auto routing with confirmed zero API monetary cost, local provenance and no
external quota shadow cost. Cloud-backed models are excluded. Eligible local
compute gets one slot in a multi-candidate fallback so a large stale remote
catalog cannot crowd it out. An unreachable Ollama is optional, not fatal.

`runCandidates` is shared by planning, replanning, action planning and direct
response. Candidate count respects economic policy (at most three), monetary and
resource budgets are cumulative, and an abortable deadline bounds each sequence.
The action parser accepts a single plain, fenced or safely extractable JSON
object, rejects ambiguity and unexpected fields, and validates arguments with
the actual tool schema before the normal ToolExecutor/ToolPolicy boundary.

DIRECT_RESPONSE is a first-class plan step in the existing TaskExecutor. It calls
a model and passes through completion evaluation with zero fake tool calls.
Explicit tool requirements cannot be satisfied by that path. Calculator output
comes from the deterministic calculator; number-only formatting reads its result.
Direct-response evaluation validates nonempty output plus caller-provided
completion criteria; it does not prove arbitrary factual correctness.

Every inference persists STARTED before contacting the provider, followed by its
result, in `task-attempts:<taskId>`. Records contain task/step/phase, provider/model,
attempt, timestamps, latency, status, monetary/resource costs and failure class.
Tool execution has the same phase trace. Provider error bodies are redacted and
bounded. Errors distinguish bad requests, authentication, forbidden access,
unavailable models, rate limits, provider failures, timeout, network, invalid
output/action, missing candidates, budget exhaustion and tool failures.

`model-health:<provider>:<model>` stores operational reliability/latency separately
from capability evidence. Rate limits, HTTP failures and tool errors do not lower
the quality samples in Economic Memory. Final task memory retains provider/model,
phase and failure class even when no tool was invoked. Existing historical records
are preserved, not retroactively rewritten.

`beyonder task inspect` reads execution, plan, steps, attempts, routes, tool calls,
checkpoints, failure, memory and audit events with redaction. The Control Center
uses the same persisted attempts, includes CLI checkpoints without duplicating
Control Center tasks, and shows human explanations plus collapsible diagnostics.
Cancelled task continuation checkpoints are preserved. An unfinished STARTED
attempt after process interruption is evidence of an interrupted operation, not
proof of success.

## Validation and observed limitations

45 added deterministic tests cover bilingual classification, eligibility, real
workloads, structured-output/cost filtering, fallback 400 → 429 → calculator,
direct response, pre-tool failure attribution, redaction, deadline/budget bounds,
invalid action schemas, optional local discovery and persistence across restart.

Real CLI tests on this machine completed `OK` with no tools and calculator
`27 × 14` with `{ value: 378 }`, returning `378` with one tool invocation. The
calculator trace includes execution, plan, attempts, routes, checkpoint and both
episodic/economic memories. Both installed Ollama models appeared in auto routing;
an additional forced qwen3:4b planning test timed out at its 30-second request
limit. Local discovery therefore does not imply local inference readiness.

The new trace also exposed retired remote models and a Cloudflare account-id
placeholder in the inference URL; the endpoint now resolves the configured
account ID and reports missing configuration as AUTH_REQUIRED. The old unrecorded
Groq HTTP 400 response body cannot be reconstructed retroactively.

Deterministic tests and smokes use zero monetary cost. No marketplace application,
message, payment, purchase or deliverable submission is performed by these tests.
No v0.6 functionality is added. This change stays on PR #18 without merging.
