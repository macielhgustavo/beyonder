# Beyonder Provider Pool v0.3

This document freezes the current provider pool before v0.4. Do not add new
providers in this phase.

## Active pool

| Provider | Credential env names | Type | Text/BIB eligible | Billing posture |
| --- | --- | --- | --- | --- |
| Gemini | `GEMINI_API_KEY`, `GOOGLE_API_KEY` | OpenAI-compatible Gemini endpoint | chat/reasoning models only | $0/free-tier only |
| Groq | `GROQ_API_KEY` | OpenAI-compatible | chat/reasoning/coding models only | $0/free-tier only |
| OpenRouter | `OPENROUTER_API_KEY` | OpenAI-compatible | explicit `:free` chat models only | no paid fallback |
| Cohere | `COHERE_API_KEY` | OpenAI-compatible | chat models only; embeddings/rerank excluded from BIB | trial/free only |
| Hugging Face | `HUGGINGFACE_API_TOKEN`, `HF_TOKEN` | OpenAI-compatible router | chat/instruct models only | included credits only |
| Kilo Gateway | none for keyless | OpenAI-compatible gateway | free chat models only | keyless/free routes only |
| OVH | none for keyless | OpenAI-compatible | chat/instruct models only | anonymous keyless only |
| AI Horde | optional `AI_HORDE_API_KEY` | OpenAI-compatible community pool | anonymous worker pool | keyless/community |
| Cloudflare Workers AI | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | OpenAI-compatible account endpoint | chat/instruct models only | current authorized access only |
| NVIDIA NIM | `NVIDIA_NIM_API_KEY`, optional legacy `NVIDIA_API_KEY` | OpenAI-compatible NIM endpoint | chat/reasoning/coding models only | current authorized access only |

Secrets must stay in local env or vault storage. They must never be committed,
logged, emitted in telemetry, or written into benchmark output.

Cloudflare model discovery uses the account model catalog. BIB execution uses
Workers AI `/ai/run/{model}` for Cloudflare targets because it is the execution
path validated by the local token; the OpenAI-compatible account endpoint may
require a different token scope on some accounts.

NVIDIA NIM model discovery uses `https://integrate.api.nvidia.com/v1/models`.
Model invocation is tracked per model: a valid `NVIDIA_NIM_API_KEY` means the
catalog is reachable, but individual model calls can still return
`MODEL_UNAVAILABLE`, `TIMEOUT`, or end-of-life responses without making the
whole credential invalid.

## Model capabilities

Provider model metadata uses these capability classes:

- `CHAT`
- `REASONING`
- `CODING`
- `EMBEDDING`
- `RERANK`
- `VISION`
- `AUDIO`
- `OTHER`

Explicit catalog metadata is preferred. Name heuristics are a fallback for
newly discovered model IDs.

The general BIB smoke and Adaptive Router text workloads require text input,
text output, and chat/instruct-compatible capability. They exclude embedding,
rerank, vision-only, audio-only, image generation, and unsupported models.

## Operational states

BIB and provider validation distinguish operational status from capability:

- `PASS` and `FAIL` are capability evidence.
- `RATE_LIMITED`, `AUTH_ERROR`, `QUOTA_EXHAUSTED`, `BILLING_REQUIRED`,
  `INVALID_ENDPOINT`, `MODEL_UNAVAILABLE`, `UNSUPPORTED`, `TIMEOUT`,
  `UNAVAILABLE`, and `PROVIDER_ERROR` are operational evidence.

Operational failures do not become capability score zero. They are used as
availability/reliability signals and can create router penalties or cooldown
behavior without corrupting model quality estimates.

## Inventory

`providers inventory` reports provider state from autopilot state and catalog
metadata:

- all discovered/listed models;
- model metadata;
- chat-eligible model subset;
- auth type;
- cost posture;
- free-tier quota metadata when known;
- latency and last check from validation state.

Billing-risk and paid-only providers may remain registered, but the inventory
keeps them separate and BIB/router filtering skips them automatically.

## Adaptive Router

The Adaptive Router considers a provider/model only when:

- provider state is healthy or keyless;
- monetary cost is zero;
- provider is not billing-risk or paid-only;
- model capability matches the task;
- economic policy permits the effective resource cost.

Ranking remains learned rather than manually boosted. It uses BIB prior,
real-world outcomes, reliability, quota/shadow cost, latency, failure risk, and
economic state.
