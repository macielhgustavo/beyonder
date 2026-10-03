# Credential And Runtime State Security

## Never Commit

The repository ignores:

- `.env` and `.env.*`
- `.providers-vault/`
- `.beyonder/`
- `data/`
- `*.sqlite` and SQLite sidecar files
- cookies, sessions, tokens, private keys, and local output artifacts

## Credential Boundary

`CredentialBroker` can read credentials from environment variables or the encrypted local vault. Provider status and validation output must use redaction helpers before printing errors. The CLI does not print secret values.

## Provider Autopilot

Autopilot is dry-run by default. It stops at human gates such as CAPTCHA, 2FA, OAuth consent, SMS/phone checks, KYC, terms consent, and payment risk. Live signup requires an explicit `--live-signup` flag and still stops for human-gated steps.

## Tool Sandbox

Shell, browser, and filesystem tools are disabled unless explicitly enabled with `BEYONDER_TOOLS_ENABLED=true` plus the specific tool flag. The default milestone tool has no external side effects.
