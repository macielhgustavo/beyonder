# Provider Research Notes

Research date: 2026-10-03.

Sources checked:

- FreeLLMAPI-Extended README: `https://github.com/SeyhmusKaya/freellmapi-extended`
- FreeLLMAPI fork README: `https://github.com/rahamanleon/freellmapi`
- FreeLLMAPI provider registry: `https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/providers/index.ts`
- FreeLLMAPI provider docs overview: `https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/providers/OVERVIEW.md`
- freellmpool docs/FAQ and free-provider catalogs found during search.

Findings applied to the catalog:

- FreeLLMAPI-Extended lists Google Gemini, Groq, Cerebras, Cloudflare Workers AI, Mistral, OpenRouter, GitHub Models, Cohere, SambaNova, NVIDIA NIM, Z.ai/Zhipu, Pollinations, Kilo Gateway, AI21, and Reka.
- A recent FreeLLMAPI fork lists Google, Groq, Cerebras, SambaNova, NVIDIA, Mistral, OpenRouter, GitHub Models, Cohere, Cloudflare, Hugging Face, and Z.ai/Zhipu.
- The upstream provider registry includes cautionary notes for providers whose free tier or account requirements changed, including SambaNova and Reka.
- Several long-tail routers are visible in FreeLLMAPI ecosystem notes, but this bootstrapper keeps the first catalog conservative. Additional routers should be added only after current signup, terms, and validation behavior are confirmed.

Catalog policy:

- Use `verify-current` when free limits, model names, or eligibility are unstable.
- Prefer first-party providers and well-known routers before long-tail aggregators.
- Never treat a provider as fully automatable if signup requires login, consent, CAPTCHA, 2FA, phone, billing, token scope choices, or regional verification.
