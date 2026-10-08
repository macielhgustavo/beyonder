import type { HumanGateKind, ProviderCatalogEntry } from "./types.js";

const baseProviders: ProviderCatalogEntry[] = [
  {
    id: "pollinations",
    name: "Pollinations",
    signupUrl: "https://pollinations.ai",
    dashboardUrl: "https://auth.pollinations.ai",
    apiKeyUrl: "https://auth.pollinations.ai",
    authType: "bearer",
    credentialEnvVars: ["POLLINATIONS_API_KEY"],
    humanRequirements: ["review terms before production use"],
    openAiCompatibleEndpoint: "https://gen.pollinations.ai/v1",
    knownFreeModels: ["openai", "mistral", "searchgpt"],
    freeTier: "keyless; limits are not guaranteed and should be treated as shared public capacity",
    notes: ["Best as last-resort overflow, not as a reliability foundation."],
    automationStatus: "automatable",
    validation: { method: "models", url: "https://gen.pollinations.ai/v1/models" }
  },
  {
    id: "gemini",
    name: "Google Gemini",
    signupUrl: "https://ai.google.dev",
    dashboardUrl: "https://aistudio.google.com",
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
    authType: "api-key",
    credentialEnvVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    humanRequirements: ["Google account", "terms consent", "possible CAPTCHA or 2FA"],
    openAiCompatibleEndpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
    knownFreeModels: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-1.5-flash"],
    freeTier: "free tier exists; exact model quotas change frequently, verify-current",
    notes: ["Native Gemini API differs from OpenAI-compatible beta; validate with models endpoint."],
    automationStatus: "human-step",
    validation: { method: "gemini-models" }
  },
  {
    id: "groq",
    name: "Groq",
    signupUrl: "https://console.groq.com",
    dashboardUrl: "https://console.groq.com",
    apiKeyUrl: "https://console.groq.com/keys",
    authType: "bearer",
    credentialEnvVars: ["GROQ_API_KEY"],
    humanRequirements: ["account login", "possible CAPTCHA or 2FA"],
    openAiCompatibleEndpoint: "https://api.groq.com/openai/v1",
    knownFreeModels: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "moonshotai/kimi-k2-instruct"],
    modelCatalog: [
      { id: "meta-llama/llama-prompt-guard-2-86m", capabilities: ["OTHER"], role: "guard", structuredOutput: "unsupported" },
      { id: "meta-llama/llama-prompt-guard-2-22m", capabilities: ["OTHER"], role: "guard", structuredOutput: "unsupported" },
      { id: "openai/gpt-oss-safeguard-20b", capabilities: ["OTHER"], role: "guard", structuredOutput: "unsupported" }
    ],
    freeTier: "free developer tier; rate limits vary by model, verify-current",
    notes: ["Good first keyed provider for low-latency text inference."],
    automationStatus: "human-step",
    validation: { method: "models", url: "https://api.groq.com/openai/v1/models" }
  },
  {
    id: "cerebras",
    name: "Cerebras",
    signupUrl: "https://cloud.cerebras.ai",
    dashboardUrl: "https://cloud.cerebras.ai",
    apiKeyUrl: "https://cloud.cerebras.ai/platform",
    authType: "bearer",
    credentialEnvVars: ["CEREBRAS_API_KEY"],
    humanRequirements: ["account login", "possible CAPTCHA or 2FA"],
    openAiCompatibleEndpoint: "https://api.cerebras.ai/v1",
    knownFreeModels: ["qwen-3-235b-a22b", "llama-3.3-70b"],
    freeTier: "free tier reported by FreeLLMAPI forks; exact limits verify-current",
    notes: ["Free availability has changed before; keep validation health-based."],
    automationStatus: "human-step",
    validation: { method: "models", url: "https://api.cerebras.ai/v1/models" }
  },
  {
    id: "mistral",
    name: "Mistral AI",
    signupUrl: "https://console.mistral.ai",
    dashboardUrl: "https://console.mistral.ai",
    apiKeyUrl: "https://console.mistral.ai/api-keys",
    authType: "bearer",
    credentialEnvVars: ["MISTRAL_API_KEY"],
    humanRequirements: ["account login", "terms consent", "possible CAPTCHA or 2FA"],
    openAiCompatibleEndpoint: "https://api.mistral.ai/v1",
    knownFreeModels: ["mistral-small-latest", "codestral-latest", "open-mistral-nemo"],
    freeTier: "la Plateforme free/trial availability changes; verify-current",
    notes: ["Strong candidate for coding models when the account has trial/free access."],
    automationStatus: "human-step",
    validation: { method: "models", url: "https://api.mistral.ai/v1/models" }
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    signupUrl: "https://openrouter.ai",
    dashboardUrl: "https://openrouter.ai/settings",
    apiKeyUrl: "https://openrouter.ai/settings/keys",
    authType: "bearer",
    credentialEnvVars: ["OPENROUTER_API_KEY"],
    humanRequirements: ["account login", "possible CAPTCHA or 2FA"],
    openAiCompatibleEndpoint: "https://openrouter.ai/api/v1",
    knownFreeModels: ["openrouter/auto", "deepseek/deepseek-r1:free", "meta-llama/llama-3.3-70b-instruct:free"],
    freeTier: "free routes exist; per-route limits and availability change frequently",
    notes: ["Use explicit :free model ids to avoid accidental paid spend."],
    automationStatus: "human-step",
    validation: { method: "models", url: "https://openrouter.ai/api/v1/models" }
  },
  {
    id: "github-models",
    name: "GitHub Models",
    signupUrl: "https://github.com/marketplace/models",
    dashboardUrl: "https://github.com/marketplace/models",
    apiKeyUrl: "https://github.com/settings/tokens",
    authType: "github-token",
    credentialEnvVars: ["GITHUB_MODELS_TOKEN", "GITHUB_TOKEN"],
    humanRequirements: ["GitHub login", "token scope review", "possible 2FA"],
    openAiCompatibleEndpoint: "https://models.github.ai/inference",
    knownFreeModels: ["openai/gpt-4o-mini", "meta/llama-3.3-70b-instruct", "microsoft/phi-4"],
    freeTier: "free playground/API usage for eligible accounts; limits verify-current",
    notes: ["Prefer a fine-scoped token dedicated to model inference."],
    automationStatus: "manual-only",
    validation: { method: "models", url: "https://models.github.ai/inference/models" }
  },
  {
    id: "cohere",
    name: "Cohere",
    signupUrl: "https://dashboard.cohere.com",
    dashboardUrl: "https://dashboard.cohere.com",
    apiKeyUrl: "https://dashboard.cohere.com/api-keys",
    authType: "bearer",
    credentialEnvVars: ["COHERE_API_KEY"],
    humanRequirements: ["account login", "possible CAPTCHA or 2FA"],
    openAiCompatibleEndpoint: "https://api.cohere.com/compatibility/v1",
    knownFreeModels: ["command-r-plus", "command-r", "embed-v4.0", "rerank-v3.5"],
    freeTier: "trial/free developer access; exact quotas verify-current",
    notes: ["Useful for embeddings/reranking as well as chat."],
    automationStatus: "human-step",
    validation: { method: "models", url: "https://api.cohere.com/compatibility/v1/models" }
  },
  {
    id: "cloudflare-workers-ai",
    name: "Cloudflare Workers AI",
    signupUrl: "https://dash.cloudflare.com/sign-up",
    dashboardUrl: "https://dash.cloudflare.com",
    apiKeyUrl: "https://dash.cloudflare.com/profile/api-tokens",
    authType: "account-id-and-token",
    credentialEnvVars: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"],
    humanRequirements: ["Cloudflare account", "account id", "token permission review", "possible CAPTCHA or 2FA"],
    openAiCompatibleEndpoint: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1",
    knownFreeModels: [
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      "@cf/meta/llama-3.1-8b-instruct",
      "@cf/mistral/mistral-7b-instruct-v0.1",
      "@cf/baai/bge-base-en-v1.5",
      "@cf/baai/bge-reranker-base",
      "@cf/openai/whisper",
      "@cf/stabilityai/stable-diffusion-xl-base-1.0"
    ],
    modelCatalog: [
      { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", capabilities: ["CHAT", "REASONING"], status: "AVAILABLE" },
      { id: "@cf/meta/llama-3.1-8b-instruct", capabilities: ["CHAT", "REASONING"], status: "AVAILABLE" },
      { id: "@cf/mistral/mistral-7b-instruct-v0.1", capabilities: ["CHAT"], status: "AVAILABLE" },
      { id: "@cf/baai/bge-base-en-v1.5", capabilities: ["EMBEDDING"], status: "AVAILABLE" },
      { id: "@cf/baai/bge-reranker-base", capabilities: ["RERANK"], status: "AVAILABLE" },
      { id: "@cf/openai/whisper", capabilities: ["AUDIO"], status: "AVAILABLE" },
      { id: "@cf/stabilityai/stable-diffusion-xl-base-1.0", capabilities: ["VISION"], status: "AVAILABLE" }
    ],
    freeTier: "daily free allocation commonly described as neurons/day; verify-current",
    notes: ["Needs both account id and token; endpoint is account-specific."],
    automationStatus: "manual-only",
    validation: { method: "cloudflare-models" }
  },
  {
    id: "zai",
    name: "Z.ai / Zhipu",
    signupUrl: "https://open.bigmodel.cn",
    dashboardUrl: "https://open.bigmodel.cn",
    apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    authType: "bearer",
    credentialEnvVars: ["ZAI_API_KEY", "ZHIPU_API_KEY"],
    humanRequirements: ["account login", "regional availability review", "possible phone/CAPTCHA/2FA"],
    openAiCompatibleEndpoint: "https://open.bigmodel.cn/api/paas/v4",
    knownFreeModels: ["glm-4.5-flash", "glm-4.7-flash", "glm-4.6v-flash"],
    freeTier: "free/flash models reported; verify-current and regional requirements",
    notes: ["Some account flows may require phone or regional identity checks."],
    automationStatus: "manual-only",
    validation: { method: "models", url: "https://open.bigmodel.cn/api/paas/v4/models" }
  },
  {
    id: "huggingface",
    name: "Hugging Face Inference Providers",
    signupUrl: "https://huggingface.co/join",
    dashboardUrl: "https://huggingface.co/settings/tokens",
    apiKeyUrl: "https://huggingface.co/settings/tokens",
    authType: "bearer",
    credentialEnvVars: ["HUGGINGFACE_API_TOKEN", "HF_TOKEN"],
    humanRequirements: ["account login", "token scope review", "possible CAPTCHA or 2FA"],
    openAiCompatibleEndpoint: "https://router.huggingface.co/v1",
    knownFreeModels: ["verify-current"],
    freeTier: "free inference/provider quotas vary by account/provider, verify-current",
    notes: ["Provider routing can include third-party terms; review model/provider before use."],
    automationStatus: "manual-only",
    validation: { method: "models", url: "https://router.huggingface.co/v1/models" }
  },
  {
    id: "sambanova",
    name: "SambaNova Cloud",
    signupUrl: "https://cloud.sambanova.ai",
    dashboardUrl: "https://cloud.sambanova.ai",
    apiKeyUrl: "https://cloud.sambanova.ai/apis",
    authType: "bearer",
    credentialEnvVars: ["SAMBANOVA_API_KEY"],
    humanRequirements: ["account login", "possible CAPTCHA or 2FA"],
    openAiCompatibleEndpoint: "https://api.sambanova.ai/v1",
    knownFreeModels: ["Meta-Llama-3.3-70B-Instruct", "DeepSeek-V3.1"],
    freeTier: "conflicting reports in 2026; mark verify-current before relying on it",
    notes: ["One FreeLLMAPI provider file says the free tier was dropped in June 2026."],
    automationStatus: "manual-only",
    validation: { method: "models", url: "https://api.sambanova.ai/v1/models" }
  },
  {
    id: "nvidia-nim",
    name: "NVIDIA NIM",
    signupUrl: "https://build.nvidia.com",
    dashboardUrl: "https://build.nvidia.com",
    apiKeyUrl: "https://build.nvidia.com/explore/discover",
    authType: "bearer",
    credentialEnvVars: ["NVIDIA_NIM_API_KEY", "NVIDIA_API_KEY"],
    humanRequirements: ["NVIDIA account", "phone verification reported", "possible CAPTCHA or 2FA"],
    openAiCompatibleEndpoint: "https://integrate.api.nvidia.com/v1",
    knownFreeModels: [
      "deepseek-ai/deepseek-v4.1-flash",
      "nvidia/llama-3.1-nemotron-ultra-253b-v1",
      "nvidia/llama-3.1-nemotron-70b-instruct",
      "qwen/qwen2.5-coder-32b-instruct",
      "nvidia/nv-embedqa-e5-v5",
      "nvidia/nv-rerankqa-mistral-4b-v3"
    ],
    modelCatalog: [
      { id: "meta/llama-3.3-70b-instruct", capabilities: ["CHAT", "REASONING"], status: "MODEL_UNAVAILABLE", notes: ["NVIDIA API returned end-of-life for this model in October 2026."] },
      { id: "deepseek-ai/deepseek-v4.1-flash", capabilities: ["CHAT", "REASONING", "CODING"], status: "AVAILABLE" },
      { id: "nvidia/llama-3.1-nemotron-ultra-253b-v1", capabilities: ["CHAT", "REASONING"], status: "AVAILABLE" },
      { id: "nvidia/llama-3.1-nemotron-70b-instruct", capabilities: ["CHAT", "REASONING"], status: "AVAILABLE" },
      { id: "qwen/qwen2.5-coder-32b-instruct", capabilities: ["CHAT", "CODING"], status: "AVAILABLE" },
      { id: "nvidia/nv-embedqa-e5-v5", capabilities: ["EMBEDDING"], status: "AVAILABLE" },
      { id: "nvidia/nv-rerankqa-mistral-4b-v3", capabilities: ["RERANK"], status: "AVAILABLE" }
    ],
    freeTier: "free credits/tier reported; requires current verification",
    notes: ["Phone verification means no reliable full automation."],
    automationStatus: "manual-only",
    validation: { method: "models", url: "https://integrate.api.nvidia.com/v1/models" }
  },
  {
    id: "kilo-gateway",
    name: "Kilo Gateway",
    signupUrl: "https://kilo.ai",
    dashboardUrl: "https://kilo.ai",
    apiKeyUrl: "https://kilo.ai",
    authType: "keyless",
    credentialEnvVars: [],
    humanRequirements: ["review gateway/provider terms"],
    openAiCompatibleEndpoint: "https://api.kilo.ai/api/gateway",
    knownFreeModels: ["openrouter/free"],
    freeTier: "keyless free gateway reported; exact limits verify-current",
    notes: ["Treat as assisted/keyless overflow until terms and limits are confirmed."],
    automationStatus: "assisted",
    validation: { method: "none" }
  },
  {
    id: "ai21",
    name: "AI21",
    signupUrl: "https://studio.ai21.com",
    dashboardUrl: "https://studio.ai21.com",
    apiKeyUrl: "https://studio.ai21.com/account/api-key",
    authType: "bearer",
    credentialEnvVars: ["AI21_API_KEY"],
    humanRequirements: ["account login", "possible CAPTCHA or 2FA"],
    openAiCompatibleEndpoint: "https://api.ai21.com/studio/v1",
    knownFreeModels: ["jamba-mini", "jamba-large"],
    freeTier: "trial/free availability verify-current",
    notes: ["Included in FreeLLMAPI-Extended; validate availability before routing."],
    automationStatus: "manual-only",
    validation: { method: "models", url: "https://api.ai21.com/studio/v1/models" }
  },
  {
    id: "reka",
    name: "Reka",
    signupUrl: "https://reka.ai",
    dashboardUrl: "https://platform.reka.ai",
    apiKeyUrl: "https://platform.reka.ai",
    authType: "bearer",
    credentialEnvVars: ["REKA_API_KEY"],
    humanRequirements: ["account login", "possible CAPTCHA or 2FA", "billing/credit review"],
    openAiCompatibleEndpoint: "https://api.reka.ai/v1",
    knownFreeModels: ["reka-flash-3", "reka-edge-2603"],
    freeTier: "not reliably free for new accounts; verify-current",
    notes: ["Recent FreeLLMAPI comments say new accounts may require prepaid credits."],
    automationStatus: "manual-only",
    validation: { method: "models", url: "https://api.reka.ai/v1/models" }
  },
  {
    id: "ollama-cloud",
    name: "Ollama Cloud",
    signupUrl: "https://ollama.com",
    dashboardUrl: "https://ollama.com/settings/keys",
    apiKeyUrl: "https://ollama.com/settings/keys",
    authType: "bearer",
    credentialEnvVars: ["OLLAMA_API_KEY"],
    humanRequirements: ["account login", "possible OAuth consent or CAPTCHA"],
    openAiCompatibleEndpoint: "https://ollama.com/v1",
    knownFreeModels: ["verify-current"],
    freeTier: "free plan reported by FreeLLMAPI; GPU-time/session limits, verify-current",
    notes: ["Some listed models are subscription-only; validation must avoid paid/subscription models."],
    automationStatus: "human-step",
    validation: { method: "models", url: "https://ollama.com/v1/models" }
  },
  {
    id: "anyapi",
    name: "AnyAPI",
    signupUrl: "https://anyapi.ai",
    dashboardUrl: "https://anyapi.ai",
    apiKeyUrl: "https://anyapi.ai",
    authType: "bearer",
    credentialEnvVars: ["ANYAPI_API_KEY"],
    humanRequirements: ["account login", "possible OAuth consent or CAPTCHA"],
    openAiCompatibleEndpoint: "https://api.anyapi.ai/v1",
    knownFreeModels: ["verify-current"],
    freeTier: "FreeLLMAPI registry reports $0 recurring, no card, 100K tokens/day, verify-current",
    notes: ["Model ids from third-party lists are unverified; discover via /models after key."],
    automationStatus: "human-step",
    validation: { method: "models", url: "https://api.anyapi.ai/v1/models" }
  },
  {
    id: "ovh",
    name: "OVH AI Endpoints",
    signupUrl: "https://endpoints.ai.cloud.ovh.net",
    dashboardUrl: "https://endpoints.ai.cloud.ovh.net",
    authType: "keyless",
    credentialEnvVars: [],
    humanRequirements: ["review OVH terms"],
    openAiCompatibleEndpoint: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1",
    knownFreeModels: ["Meta-Llama-3_3-70B-Instruct", "gpt-oss-120b"],
    freeTier: "anonymous keyless path reported around 2 req/min per IP per model; verify-current",
    notes: ["Authenticated higher limits require Public Cloud project and payment method, so autopilot uses keyless only."],
    automationStatus: "automatable",
    validation: { method: "keyless-models", url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/models" }
  },
  {
    id: "ai-horde",
    name: "AI Horde",
    signupUrl: "https://aihorde.net",
    dashboardUrl: "https://aihorde.net",
    apiKeyUrl: "https://aihorde.net/register",
    authType: "keyless",
    credentialEnvVars: ["AI_HORDE_API_KEY"],
    humanRequirements: ["optional account for priority"],
    openAiCompatibleEndpoint: "https://aihorde.net/api/openai/v1",
    knownFreeModels: ["anonymous-worker-pool"],
    modelCatalog: [{ id: "anonymous-worker-pool", capabilities: ["CHAT"], status: "AVAILABLE" }],
    freeTier: "community-powered keyless queue; registered key improves priority",
    notes: ["Queue-based and slower; no tool calling; max_tokens constraints apply."],
    automationStatus: "automatable",
    validation: { method: "none" }
  },
  {
    id: "requesty",
    name: "Requesty",
    signupUrl: "https://requesty.ai",
    dashboardUrl: "https://requesty.ai",
    apiKeyUrl: "https://requesty.ai",
    authType: "bearer",
    credentialEnvVars: ["REQUESTY_API_KEY"],
    humanRequirements: ["account login", "possible CAPTCHA or OAuth consent"],
    openAiCompatibleEndpoint: "https://router.requesty.ai/v1",
    knownFreeModels: ["verify-current"],
    freeTier: "free model rows age into public catalog; verify-current",
    notes: ["Do not route paid models without explicit approval."],
    automationStatus: "human-step",
    validation: { method: "models", url: "https://router.requesty.ai/v1/models" }
  },
  {
    id: "navy",
    name: "NavyAI",
    signupUrl: "https://api.navy",
    dashboardUrl: "https://api.navy",
    apiKeyUrl: "https://api.navy",
    authType: "bearer",
    credentialEnvVars: ["NAVY_API_KEY"],
    humanRequirements: ["Discord-backed dashboard", "possible OAuth consent"],
    openAiCompatibleEndpoint: "https://api.navy/v1",
    knownFreeModels: ["verify-current"],
    freeTier: "FreeLLMAPI registry reports 150K tokens/day and 20 RPM, verify-current",
    notes: ["Validation may need browser-like User-Agent."],
    automationStatus: "human-step",
    validation: { method: "models", url: "https://api.navy/v1/models" }
  },
  {
    id: "xkiro",
    name: "xKiro",
    signupUrl: "https://xkiro.com",
    dashboardUrl: "https://xkiro.com",
    apiKeyUrl: "https://xkiro.com",
    authType: "bearer",
    credentialEnvVars: ["XKIRO_API_KEY"],
    humanRequirements: ["account login", "possible CAPTCHA or OAuth consent"],
    openAiCompatibleEndpoint: "https://api.xkiro.com/v1",
    knownFreeModels: ["verify-current"],
    freeTier: "FreeLLMAPI registry reports 5M free tokens/day on free plan, verify-current",
    notes: ["/v1/models is public, so validate against /v1/usage."],
    automationStatus: "human-step",
    validation: { method: "models", url: "https://api.xkiro.com/v1/usage" }
  },
  {
    id: "sealion",
    name: "SEA-LION",
    signupUrl: "https://sea-lion.ai",
    dashboardUrl: "https://sea-lion.ai",
    apiKeyUrl: "https://sea-lion.ai",
    authType: "bearer",
    credentialEnvVars: ["SEALION_API_KEY"],
    humanRequirements: ["Google sign-in", "OAuth consent"],
    openAiCompatibleEndpoint: "https://api.sea-lion.ai/v1",
    knownFreeModels: ["verify-current"],
    freeTier: "FreeLLMAPI registry reports recurring free tier at 10 RPM, verify-current",
    notes: ["No card or region wall reported by FreeLLMAPI registry."],
    automationStatus: "human-step",
    validation: { method: "models", url: "https://api.sea-lion.ai/v1/models" }
  },
  {
    id: "orcarouter",
    name: "OrcaRouter",
    signupUrl: "https://orcarouter.ai",
    dashboardUrl: "https://orcarouter.ai",
    apiKeyUrl: "https://orcarouter.ai",
    authType: "bearer",
    credentialEnvVars: ["ORCAROUTER_API_KEY"],
    humanRequirements: ["account login", "possible CAPTCHA"],
    openAiCompatibleEndpoint: "https://api.orcarouter.ai/v1",
    knownFreeModels: ["orcarouter/free", "*-free"],
    freeTier: "recurring $0 free aliases; unpublished limits; 429 is quota signal",
    notes: ["Free routes should not fall back to paid models."],
    automationStatus: "human-step",
    validation: { method: "models", url: "https://api.orcarouter.ai/v1/models" }
  },
  {
    id: "unorouter",
    name: "UnoRouter",
    signupUrl: "https://unorouter.com",
    dashboardUrl: "https://unorouter.com",
    apiKeyUrl: "https://unorouter.com",
    authType: "bearer",
    credentialEnvVars: ["UNOROUTER_API_KEY"],
    humanRequirements: ["account login", "possible CAPTCHA"],
    openAiCompatibleEndpoint: "https://api.unorouter.com/v1",
    knownFreeModels: [":free"],
    freeTier: "free models carry :free suffix; per-minute limits, verify-current",
    notes: ["API host is api.unorouter.com, not apex site."],
    automationStatus: "human-step",
    validation: { method: "models", url: "https://api.unorouter.com/v1/models" }
  },
  {
    id: "longcat",
    name: "LongCat",
    signupUrl: "https://longcat.chat",
    dashboardUrl: "https://longcat.chat",
    apiKeyUrl: "https://longcat.chat",
    authType: "bearer",
    credentialEnvVars: ["LONGCAT_API_KEY"],
    humanRequirements: ["email signup", "possible email verification", "terms consent"],
    openAiCompatibleEndpoint: "https://api.longcat.chat/openai/v1",
    knownFreeModels: ["verify-current"],
    freeTier: "FreeLLMAPI registry reports daily free quota, verify-current",
    notes: ["Listed as exception among Chinese providers: email signup outside mainland China reported."],
    automationStatus: "human-step",
    validation: { method: "models", url: "https://api.longcat.chat/openai/v1/models" }
  },
  {
    id: "modelscope",
    name: "ModelScope",
    signupUrl: "https://modelscope.cn",
    dashboardUrl: "https://modelscope.cn/my/myaccesstoken",
    apiKeyUrl: "https://modelscope.cn/my/myaccesstoken",
    authType: "bearer",
    credentialEnvVars: ["MODELSCOPE_API_KEY"],
    humanRequirements: ["Alibaba Cloud China account", "Chinese real-name verification"],
    openAiCompatibleEndpoint: "https://api-inference.modelscope.cn/v1",
    knownFreeModels: ["verify-current"],
    freeTier: "reported 2000 requests/day only after China-site real-name binding",
    notes: ["Blocked for autopilot because real-name verification is required."],
    automationStatus: "manual-only",
    validation: { method: "models", url: "https://api-inference.modelscope.cn/v1/models" }
  },
  {
    id: "sail",
    name: "Sail Research",
    signupUrl: "https://sail.co",
    dashboardUrl: "https://sail.co",
    authType: "bearer",
    credentialEnvVars: ["SAIL_API_KEY"],
    humanRequirements: ["payment method required for monthly free credits"],
    openAiCompatibleEndpoint: "https://api.sail.co/v1",
    knownFreeModels: ["verify-current"],
    freeTier: "FreeLLMAPI registry reports $5 monthly credits only with payment method",
    notes: ["Billing risk blocks autopilot."],
    automationStatus: "manual-only",
    validation: { method: "none" }
  }
];

const metadata: Record<string, Partial<ProviderCatalogEntry>> = {
  pollinations: {
    classification: "AUTO_WITH_HUMAN_GATE",
    privacyNote: "Recent FreeLLMAPI notes say publishable keys are now used for chat; prompts may be processed by shared service.",
    onboarding: { preferredAuth: "api-key-page", canAttemptSignup: true, safeAutopilot: false, blockers: ["TERMS_CONSENT"] }
  },
  gemini: classified("AUTO_WITH_HUMAN_GATE", ["TERMS_CONSENT", "CAPTCHA", "TWO_FACTOR", "OAUTH_CONSENT"], "google-oauth"),
  groq: classified("AUTO_WITH_HUMAN_GATE", ["CAPTCHA", "TWO_FACTOR", "OAUTH_CONSENT"], "google-oauth", { qualityClass: "high" }),
  cerebras: classified("AUTO_WITH_HUMAN_GATE", ["CAPTCHA", "TWO_FACTOR", "OAUTH_CONSENT"], "github-oauth"),
  mistral: classified("AUTO_WITH_HUMAN_GATE", ["TERMS_CONSENT", "CAPTCHA", "TWO_FACTOR"], "google-oauth"),
  openrouter: classified("AUTO_WITH_HUMAN_GATE", ["CAPTCHA", "TWO_FACTOR", "OAUTH_CONSENT"], "google-oauth"),
  "github-models": classified("MANUAL_REQUIRED", ["TWO_FACTOR", "TERMS_CONSENT"], "api-key-page"),
  cohere: classified("AUTO_WITH_HUMAN_GATE", ["CAPTCHA", "TWO_FACTOR"], "google-oauth"),
  "cloudflare-workers-ai": classified("MANUAL_REQUIRED", ["TWO_FACTOR", "TERMS_CONSENT"], "api-key-page"),
  zai: classified("MANUAL_REQUIRED", ["SMS_OR_PHONE", "KYC", "CAPTCHA"], "email"),
  huggingface: classified("AUTO_WITH_HUMAN_GATE", ["CAPTCHA", "TWO_FACTOR", "TERMS_CONSENT"], "api-key-page"),
  sambanova: { classification: "RETIRED", billingRisk: true, onboarding: blocked(["PAYMENT_METHOD"], "api-key-page") },
  "nvidia-nim": {
    ...classified("AUTO_WITH_HUMAN_GATE", ["SMS_OR_PHONE", "CAPTCHA", "TWO_FACTOR"], "api-key-page"),
    billingRisk: false,
    freeTierLimits: { rpm: "unknown", tpm: "unknown", quota: "Use only the currently authorized NIM API access; no automatic paid fallback or credit purchase." }
  },
  "kilo-gateway": {
    classification: "KEYLESS",
    privacyNote: "Free prompts/outputs may be logged for training according to FreeLLMAPI registry notes.",
    freeTierLimits: { rpm: "unknown", rpd: "unknown", quota: "FreeLLMAPI reports 200 req/hr per IP for keyless :free routes." },
    onboarding: { preferredAuth: "none", canAttemptSignup: false, safeAutopilot: true, blockers: [] },
    validation: { method: "keyless-models", url: "https://api.kilo.ai/api/gateway/models" }
  },
  ai21: classified("AUTO_WITH_HUMAN_GATE", ["CAPTCHA", "TWO_FACTOR"], "api-key-page"),
  reka: { classification: "PAID_ONLY", billingRisk: true, onboarding: blocked(["PAYMENT_METHOD"], "api-key-page") },
  "ollama-cloud": classified("AUTO_WITH_HUMAN_GATE", ["CAPTCHA", "OAUTH_CONSENT"], "email"),
  anyapi: classified("AUTO_WITH_HUMAN_GATE", ["CAPTCHA", "EMAIL_CONFIRMATION"], "email"),
  ovh: {
    classification: "KEYLESS",
    onboarding: { preferredAuth: "none", canAttemptSignup: false, safeAutopilot: true, blockers: [] },
    billingRisk: false,
    privacyNote: "Anonymous keyless route uses OVH public endpoint; authenticated path has billing risk."
  },
  "ai-horde": {
    classification: "KEYLESS",
    onboarding: { preferredAuth: "none", canAttemptSignup: false, safeAutopilot: true, blockers: [] },
    privacyNote: "Community worker pool; prompts are sent to volunteer infrastructure."
  },
  requesty: classified("AUTO_WITH_HUMAN_GATE", ["CAPTCHA", "OAUTH_CONSENT"], "email"),
  navy: classified("AUTO_WITH_HUMAN_GATE", ["OAUTH_CONSENT"], "github-oauth"),
  xkiro: classified("AUTO_WITH_HUMAN_GATE", ["CAPTCHA", "EMAIL_CONFIRMATION"], "email"),
  sealion: classified("AUTO_WITH_HUMAN_GATE", ["OAUTH_CONSENT"], "google-oauth"),
  orcarouter: classified("AUTO_WITH_HUMAN_GATE", ["CAPTCHA", "EMAIL_CONFIRMATION"], "email"),
  unorouter: classified("AUTO_WITH_HUMAN_GATE", ["CAPTCHA", "EMAIL_CONFIRMATION"], "email"),
  longcat: classified("AUTO_WITH_HUMAN_GATE", ["EMAIL_CONFIRMATION", "TERMS_CONSENT"], "email"),
  modelscope: { classification: "MANUAL_REQUIRED", onboarding: blocked(["KYC"], "api-key-page") },
  sail: { classification: "PAID_ONLY", billingRisk: true, onboarding: blocked(["PAYMENT_METHOD"], "api-key-page") }
};

export const providers: ProviderCatalogEntry[] = baseProviders.map((provider) => ({
  ...provider,
  classification: provider.classification ?? metadata[provider.id]?.classification ?? defaultClassification(provider),
  billingRisk: provider.billingRisk ?? metadata[provider.id]?.billingRisk ?? false,
  privacyNote: provider.privacyNote ?? metadata[provider.id]?.privacyNote,
  freeTierLimits: provider.freeTierLimits ?? metadata[provider.id]?.freeTierLimits ?? { rpm: "unknown", tpm: "unknown" },
  onboarding: provider.onboarding ?? metadata[provider.id]?.onboarding ?? defaultOnboarding(provider),
  validation: metadata[provider.id]?.validation ?? provider.validation
}));

export function getProvider(id: string): ProviderCatalogEntry | undefined {
  return providers.find((provider) => provider.id === id);
}

function classified(
  classification: ProviderCatalogEntry["classification"],
  blockers: HumanGateKind[],
  preferredAuth: NonNullable<ProviderCatalogEntry["onboarding"]>["preferredAuth"],
  _hints: Record<string, unknown> = {}
): Partial<ProviderCatalogEntry> {
  return {
    classification,
    onboarding: {
      preferredAuth,
      canAttemptSignup: classification === "AUTO_WITH_HUMAN_GATE" || classification === "FULL_AUTO",
      safeAutopilot: classification === "FULL_AUTO",
      blockers
    }
  };
}

function blocked(
  blockers: HumanGateKind[],
  preferredAuth: NonNullable<ProviderCatalogEntry["onboarding"]>["preferredAuth"]
): NonNullable<ProviderCatalogEntry["onboarding"]> {
  return { preferredAuth, canAttemptSignup: false, safeAutopilot: false, blockers };
}

function defaultClassification(provider: ProviderCatalogEntry): NonNullable<ProviderCatalogEntry["classification"]> {
  if (provider.authType === "keyless") return "KEYLESS";
  if (provider.automationStatus === "manual-only") return "MANUAL_REQUIRED";
  if (provider.automationStatus === "automatable") return "FULL_AUTO";
  return "AUTO_WITH_HUMAN_GATE";
}

function defaultOnboarding(provider: ProviderCatalogEntry): NonNullable<ProviderCatalogEntry["onboarding"]> {
  return {
    preferredAuth: provider.authType === "keyless" ? "none" : "api-key-page",
    canAttemptSignup: provider.automationStatus !== "manual-only",
    safeAutopilot: provider.automationStatus === "automatable",
    blockers: provider.humanRequirements.join(" ").toLowerCase().includes("phone") ? ["SMS_OR_PHONE"] : ["UNKNOWN"]
  };
}
