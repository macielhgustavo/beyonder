# Manual Provider Steps

These instructions are intentionally exact but not automated. Complete all account, identity, and consent steps yourself.

## Groq

1. Open `https://console.groq.com/keys`.
2. Sign in normally.
3. Complete any CAPTCHA or 2FA yourself.
4. Create a dedicated API key.
5. Store it with `pnpm providers:vault:set groq GROQ_API_KEY`.

## Google Gemini

1. Open `https://aistudio.google.com/app/apikey`.
2. Sign in and review Google AI Studio terms.
3. Create or select a project if prompted.
4. Create an API key.
5. Store it with `pnpm providers:vault:set gemini GEMINI_API_KEY`.

## OpenRouter

1. Open `https://openrouter.ai/settings/keys`.
2. Sign in and create a key.
3. In the runtime, prefer explicit `:free` model ids to avoid paid spend.
4. Store it with `pnpm providers:vault:set openrouter OPENROUTER_API_KEY`.

## Cloudflare Workers AI

1. Open `https://dash.cloudflare.com/profile/api-tokens`.
2. Create a token with the minimum Workers AI permissions needed.
3. Copy your account id from the Cloudflare dashboard.
4. Store both values:
   - `pnpm providers:vault:set cloudflare-workers-ai CLOUDFLARE_ACCOUNT_ID`
   - `pnpm providers:vault:set cloudflare-workers-ai CLOUDFLARE_API_TOKEN`

## GitHub Models

1. Open `https://github.com/marketplace/models`.
2. Review current API access requirements.
3. Create a fine-scoped GitHub token from `https://github.com/settings/tokens`.
4. Store it with `pnpm providers:vault:set github-models GITHUB_TOKEN`.

## NVIDIA NIM

1. Open `https://build.nvidia.com`.
2. Complete NVIDIA's account and verification flow yourself.
3. Do not attempt to automate phone verification.
4. Store the key with `pnpm providers:vault:set nvidia-nim NVIDIA_API_KEY`.

## Z.ai / Zhipu

1. Open `https://open.bigmodel.cn/usercenter/apikeys`.
2. Complete account, regional, phone, or identity requirements yourself.
3. Store the key with `pnpm providers:vault:set zai ZAI_API_KEY`.

## Keyless Providers

Pollinations and Kilo Gateway are cataloged as keyless/assisted overflow. Review their terms and current limits before production use.
