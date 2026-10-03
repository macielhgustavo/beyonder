# Security and Ethics

## Boundaries

This bootstrapper only supports legitimate provider onboarding. It must stop for human intervention when a flow requires:

- CAPTCHA
- 2FA
- phone verification
- payment or billing review
- terms, privacy, or model/provider consent
- account recovery or identity checks

Do not use it to create multiple accounts, evade rate limits, bypass geographic/account controls, scrape dashboards, or hide usage from providers.

## Threat Model

Assets:

- Provider API keys and tokens
- Cloudflare account id/token pairs
- GitHub tokens
- The future runtime's in-memory credential access

Main risks:

- Plaintext key leakage through logs, shell history, commits, crash output, or overly broad runtime access.
- Accidental paid usage through routers that mix free and paid models.
- Stale free-tier assumptions causing failed calls or unexpected account prompts.
- Compromised local machine or environment variables.
- Browser automation accidentally accepting terms, enabling billing, or creating account state the user did not approve.
- Discovery adding unknown providers before terms and billing risks have been reviewed.

Controls in this implementation:

- `.providers-vault/` is ignored by Git.
- Vault contents are AES-256-GCM encrypted.
- The CLI status output only reports source and presence, not values.
- The `CredentialBroker` exposes secrets in memory and provides redacted summaries.
- Provider catalog entries call out human requirements and uncertain free-tier information.
- OpenRouter-style routes are documented with `:free` guidance where relevant.
- Autopilot persists per-provider state and pauses individual providers instead of retrying sensitive gates blindly.
- `BILLING_RISK=true` providers are skipped unless an explicit environment approval is set.
- `providers:discover` marks unknown registry entries as `UNREVIEWED`; it does not signup or store keys.
- Central redaction removes common API key/token shapes from CLI errors and reports.

Residual risks:

- The vault password can be exposed if placed directly in shell history.
- Any process running as the user can potentially read environment variables.
- Validation calls contact provider APIs and may reveal that a key exists.
- Free-tier terms and limits can change without notice.
- The generic browser agent cannot reliably capture provider-specific one-time keys yet; safe provider-specific adapters are required before true full account mutation.

## Provider Automation Policy

`automatable` is reserved for keyless or local-only setup.

`assisted` means the tool can open pages and guide the user but should not complete account actions.

`human-step` means signup/key generation normally requires login, terms, CAPTCHA, 2FA, or similar user-only actions.

`manual-only` means the provider has token scope decisions, account verification, phone/billing/region requirements, or unstable automation surfaces.

## Autopilot Guardrails

Autopilot may open a browser and guide the user to the correct page, but it must not:

- accept legal terms automatically;
- approve OAuth permissions automatically;
- submit phone, KYC, payment, or billing forms;
- bypass CAPTCHA or anti-bot challenges;
- create multiple accounts or evade quotas;
- enable paid models or paid fallback routes;
- print or persist captured keys outside the encrypted vault.

Live signup requires `PROVIDER_BOOTSTRAPPER_LIVE_SIGNUP=1`. Providers with billing risk additionally require `PROVIDER_BOOTSTRAPPER_ALLOW_BILLING_RISK=1`, which should only be set after explicit user approval.

## Operational Guidance

- Prefer environment variables for ephemeral CI/dev runs and the encrypted vault for local repeated use.
- Use dedicated API keys with minimum necessary scopes.
- Avoid storing provider account passwords anywhere in this project.
- For routers/aggregators, pin free model ids when possible and reject paid model ids in the economic runtime.
- Revalidate the catalog before relying on quota, model, or pricing assumptions.
