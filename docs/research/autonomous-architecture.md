# Autonomous Compute Acquisition Architecture

## Components

- `ProviderAutopilotOrchestrator`: per-provider state machine and retry boundary.
- `AutopilotStateStore`: JSON progress store under `.providers-vault/`.
- `BrowserAgent`: navigation/onboarding abstraction. The default `SystemBrowserAgent` opens the right page and pauses at human gates; provider-specific safe adapters can later implement semantic clicking/key capture.
- `EmailVerificationBroker`: interface for confirmation emails. The default broker is no-op and causes `HUMAN_GATE` when email confirmation is required.
- `Vault`: AES-256-GCM encrypted local secret store with credential metadata.
- `CredentialBroker`: in-memory secret resolver for env and vault.
- `FreeLlmApiIntegrator`: integration point for official FreeLLMAPI DB/API registration.
- `ComputeInventory`: normalized view for the future economic router.
- `Discovery`: fetches current FreeLLMAPI provider registry and marks unknown entries as `UNREVIEWED`.

## State Machine

`DISCOVERED -> CREDENTIAL_CHECK -> SIGNUP -> EMAIL_VERIFICATION -> HUMAN_GATE -> DASHBOARD -> KEY_CREATION -> VAULT_STORE -> VALIDATION -> FREELLM_REGISTRATION -> HEALTH_CHECK -> READY`

Recoverable terminal-like states:

- `HUMAN_GATE`: user-only step is required. Rerun `pnpm providers:resume [provider-id]` after resolving it or storing a key.
- `SKIPPED`: provider is retired, paid-only, unsupported, or blocked by billing risk.
- `FAILED`: validation or integration failed without a known human gate.

## Current Full-Auto Scope

The safe full-auto surface today is:

- keyless providers with no account mutation;
- providers that already have credentials in env/vault;
- validation, inventory, FreeLLMAPI registration handoff, and health state persistence.

Account creation/API-key capture is architected but intentionally paused behind provider-specific adapters because most dashboards involve consent, CAPTCHA, OAuth, or one-time key display that must not be handled with brittle generic scraping.

## Future Provider Adapter Contract

A safe provider-specific adapter should implement:

- semantic navigation by role/label/text;
- blocker detection for CAPTCHA, 2FA, SMS, OAuth consent, terms, KYC, payment;
- key capture directly into `Vault.set`, without logging;
- screenshots/debug output only after redaction and never containing secrets;
- resume markers after each state transition.
