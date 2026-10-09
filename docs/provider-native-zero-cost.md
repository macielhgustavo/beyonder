# Provider-native zero-cost declarations

The runtime never infers an account plan from a valid API key or a model catalog. Confirm the account plan in the provider console, then bind that confirmation to the current credential. A rotated key needs a new declaration. The declaration is stable; quota observations and cooldowns are short lived.

Use `pnpm build` and then `pnpm exec tsx scripts/zero-cost-cli.ts plan-fingerprint --provider <id>` to print a SHA-256 fingerprint without printing the secret. Set only the matching environment variable:

| Provider | Confirm in provider console | Environment variable |
| --- | --- | --- |
| `gemini` | The API key's project is on **Free Tier**, with billing not linked | `BEYONDER_GEMINI_FREE_TIER_CREDENTIAL_SHA256` |
| `groq` | The organization is on **Free Plan**, not Developer | `BEYONDER_GROQ_FREE_PLAN_CREDENTIAL_SHA256` |
| `cloudflare-workers-ai` | The account uses **Workers Free** | `BEYONDER_CLOUDFLARE_WORKERS_FREE_CREDENTIAL_SHA256` |
| `nvidia-nim` | Developer Program access for development/evaluation only | `BEYONDER_NVIDIA_DEVELOPER_CREDENTIAL_SHA256` |

Cloudflare's fingerprint also includes the account ID. Unknown, Paid, or mismatched declarations do not authorize an inference. A declaration is an explicit operator assertion, not automated verification of a provider account. Current provider APIs used here do not expose reliable account-plan metadata to this code path.

Only listed models enter each provider policy. Gemini and Groq use current Free Tier/Free Plan text model lists; Cloudflare uses a conservative free text list and excludes paid-billing-required models. Refresh these lists against official provider documentation when models or billing terms change. The runtime still applies cooldowns, observed quota, response cost checks, and a global economic stop on any reported positive cost. NVIDIA Developer remains excluded from product objectives; it can be used by benchmark and smoke workflows under the developer declaration.

Sources: [Gemini billing](https://ai.google.dev/gemini-api/docs/billing), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Groq rate limits](https://console.groq.com/docs/rate-limits), [Groq billing](https://console.groq.com/docs/billing-faqs), [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [NVIDIA NIM usage terms](https://docs.api.nvidia.com/nim/docs/product).
