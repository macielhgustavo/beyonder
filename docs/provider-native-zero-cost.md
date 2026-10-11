# Provider-native zero-cost inspection

The normal path is credential discovery → installation economic posture + provider contract + model eligibility → ranking → execution → cost observation. Billing introspection is additional evidence, never a prerequisite for a native free-tier candidate when the operator has declared that external billing is disabled for this installation. The runtime does not infer a free account from a valid API key, unknown quota, model price, or rate-limit headers alone.

Set `BEYONDER_EXTERNAL_BILLING_ENABLED=false` once in the installation `.env` only when **all configured AI provider accounts** have external billing disabled. An absent value means unknown; `true` means billable. This assertion applies to the installation, not to arbitrary models: Gemini, Groq, and Cloudflare still require a provider-native free-tier-eligible model. Paid-only models remain blocked. NVIDIA Developer remains dev/eval only. If external billing is later enabled, update this setting and restart Beyonder before another inference. An inspection that finds billing enabled or a provider response reporting nonzero cost overrides the declaration and stops the provider.

## Automatic inspection

| Provider | Official read-only path | What can be concluded |
| --- | --- | --- |
| Gemini | With optional Google Cloud OAuth read credentials, `keys:lookupKey` identifies the API key's project; `projects.getBillingInfo` returns `billingEnabled` | `false` independently qualifies an eligible model; `true` blocks, including when the installation declares no billing. Missing OAuth does not veto an installation-qualified free-tier model. |
| Cloudflare Workers AI | Optional account subscriptions and, when no Workers subscription is present, account payment methods | Workers Free independently qualifies eligible models; Workers Paid blocks. A 403 means introspection unavailable and does not veto the installation posture. |
| Groq | Public key API exposes models and completion rate-limit headers, but no documented account billing endpoint | A listed Free Plan model can execute under the installation posture. Rate-limit headers and 429 remain quota signals, not billing proof. |

For Gemini, the inspector uses an existing `GOOGLE_CLOUD_ACCESS_TOKEN` with both required read scopes, or a service-account credential from `GOOGLE_APPLICATION_CREDENTIALS`. Its token requests `cloud-platform.read-only` for API key lookup and `cloud-billing.readonly` for project billing; the identity also needs `apikeys.keys.lookup` and `resourcemanager.projects.get` on the project. Cloudflare uses the current API token if it has Billing Read permission; an optional `CLOUDFLARE_BILLING_API_TOKEN` can supply that read scope separately. These are access credentials for official account APIs, not plan-name declarations.

An unavailable or incomplete inspection stays `BILLING_CAPABILITY_UNKNOWN`; it does not override the installation posture. If the posture is also unknown, a potentially billable native route stays blocked. Unknown quota remains eligible for a qualified free-tier route. Exhausted quota produces cooldown and failover. OpenRouter keeps its request price ceiling and response-cost check; Ollama keeps its local endpoint proof. This installation assertion is an operator-supplied fact: if an account can actually bill and the operator declares otherwise, the provider's post-response cost check cannot prevent the first charge. Strict US$0 therefore depends on keeping this single installation setting accurate.

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
