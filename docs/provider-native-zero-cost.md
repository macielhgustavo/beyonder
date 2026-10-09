# Provider-native zero-cost inspection

The normal path is credential discovery → read-only billing-capability inspection → free model filtering → ranking. The runtime does not infer a free account from a valid API key, unknown quota, model price, or rate-limit headers. Account capability is stored separately from volatile quota in `.providers-vault/billing-capability.json`. Each process rechecks account state on its first use, then caches a confirmed no-billing result for one hour. A rotated credential gets a new fingerprint and cannot inherit the previous result. A provider response that contradicts zero cost stops further use of that credential.

## Automatic inspection

| Provider | Official read-only path | What can be concluded |
| --- | --- | --- |
| Gemini | With a Google Cloud OAuth read credential, `keys:lookupKey` identifies the API key's project; `projects.getBillingInfo` returns `billingEnabled` | `false` means no project billing capability; `true` blocks the zero-cost policy. The Gemini API key alone cannot authorize these reads. |
| Cloudflare Workers AI | Account subscriptions and, when no Workers subscription is present, account payment methods | An explicit Workers Free subscription or a complete empty subscription and payment-method result permits eligible free models. Workers Paid blocks. Billing Read permission is needed; an AI-only token may return 403. |
| Groq | Public key API exposes models and completion rate-limit headers, but no documented account billing endpoint | Account billing capability remains unknown. Free Plan limits or a 429 do not prove the account cannot charge. |

For Gemini, the inspector uses an existing `GOOGLE_CLOUD_ACCESS_TOKEN` with both required read scopes, or a service-account credential from `GOOGLE_APPLICATION_CREDENTIALS`. Its token requests `cloud-platform.read-only` for API key lookup and `cloud-billing.readonly` for project billing; the identity also needs `apikeys.keys.lookup` and `resourcemanager.projects.get` on the project. Cloudflare uses the current API token if it has Billing Read permission; an optional `CLOUDFLARE_BILLING_API_TOKEN` can supply that read scope separately. These are access credentials for official account APIs, not plan-name declarations.

An unavailable or incomplete inspection stays `BILLING_CAPABILITY_UNKNOWN` and blocks a potentially billable call. No inference is used as a billing probe. Unknown quota remains eligible once absence of billing capability is proven. Exhausted quota produces cooldown and failover. OpenRouter keeps its zero price ceiling and response-cost check; Ollama keeps its local endpoint proof. NVIDIA Developer remains limited to development and evaluation.

## Exceptional override

If the provider offers no usable account introspection, an operator may verify the account and bind a free-plan assertion to the current credential. This is a fallback, not a startup step. Run `pnpm exec tsx scripts/zero-cost-cli.ts plan-fingerprint --provider <id>` and set the matching variable only after independent verification:

| Provider | Exceptional variable |
| --- | --- |
| Gemini | `BEYONDER_GEMINI_FREE_TIER_CREDENTIAL_SHA256` |
| Groq | `BEYONDER_GROQ_FREE_PLAN_CREDENTIAL_SHA256` |
| Cloudflare | `BEYONDER_CLOUDFLARE_WORKERS_FREE_CREDENTIAL_SHA256` |
| NVIDIA Developer | `BEYONDER_NVIDIA_DEVELOPER_CREDENTIAL_SHA256` |

Machine-readable evidence that billing capability is present overrides a manual free declaration. A reported positive cost or billing contradiction stops new calls.

Sources: [Gemini billing](https://ai.google.dev/gemini-api/docs/billing), [Google API key lookup](https://docs.cloud.google.com/api-keys/docs/reference/rest/v2/keys/lookupKey), [Google project billing info](https://docs.cloud.google.com/billing/docs/reference/rest/v1/projects/getBillingInfo), [Groq API reference](https://console.groq.com/docs/api-reference), [Groq rate limits](https://console.groq.com/docs/rate-limits), [Cloudflare account subscriptions](https://developers.cloudflare.com/api/resources/accounts/subresources/subscriptions/methods/get/), [Cloudflare payment methods](https://developers.cloudflare.com/api/resources/accounts/subresources/payment_methods/methods/list/), [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).
