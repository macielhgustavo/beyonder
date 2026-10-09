import { providers } from "./catalog.js";
import { isModelMetadataEligibleForWorkload, modelsWithMetadata } from "./model-capabilities.js";
import type { AutopilotStateFile, ComputeInventoryEntry, ProviderCatalogEntry } from "./types.js";

export function buildComputeInventory(state: AutopilotStateFile): ComputeInventoryEntry[] {
  return providers.map((provider) => buildInventoryEntry(provider, state));
}

function buildInventoryEntry(provider: ProviderCatalogEntry, state: AutopilotStateFile): ComputeInventoryEntry {
  const progress = state.providers[provider.id];
  const healthy = progress?.state === "READY";
  const human = progress?.state === "HUMAN_GATE";
  const skipped = progress?.state === "SKIPPED";
  const failed = progress?.state === "FAILED";
  const validatedModels = progress?.validation?.status === "validated" ? progress.validation.models : undefined;
  const models = provider.id === "nvidia-nim"
    ? validatedModels ?? []
    : validatedModels ?? provider.knownFreeModels;
  const modelMetadata = modelsWithMetadata(provider, models).map(model => progress?.validation?.modelMetadata?.find(observed => observed.id === model.id) ?? model);
  return {
    bootstrapReady: healthy,
    modelCatalogReady: progress?.validation?.status === "validated",
    // Bootstrap and public catalogue validation do not perform inference or
    // independent semantic verification. Preserve those separate qualifications.
    inferenceQualified: false,
    verifierQualified: false,
    providerId: provider.id,
    providerName: provider.name,
    status: healthy
      ? provider.authType === "keyless" ? "keyless" : "healthy"
      : human ? "human-action-required"
        : skipped ? "skipped"
          : failed ? "failed"
            : provider.authType === "keyless" ? "keyless" : "missing-credential",
    auth: provider.authType,
    cost: provider.billingRisk || provider.classification === "PAID_ONLY" ? "billing-risk" : "unknown",
    models,
    modelMetadata,
    eligibleChatModels: modelMetadata.filter(model => isModelMetadataEligibleForWorkload(model, "general_chat")).map(model => model.id),
    rpm: provider.freeTierLimits?.rpm,
    tpm: provider.freeTierLimits?.tpm,
    contextWindow: provider.freeTierLimits?.contextWindow,
    toolCalling: inferToolCalling(provider),
    qualityClass: inferQuality(provider),
    latencyMs: progress?.validation?.latencyMs,
    privacyNote: provider.privacyNote,
    lastCheckedAt: progress?.lastUpdatedAt
  };
}

function inferToolCalling(provider: ProviderCatalogEntry): ComputeInventoryEntry["toolCalling"] {
  if (["ai-horde"].includes(provider.id)) return "no";
  if (provider.openAiCompatibleEndpoint) return "unknown";
  return "unknown";
}

function inferQuality(provider: ProviderCatalogEntry): ComputeInventoryEntry["qualityClass"] {
  if (["groq", "cerebras", "gemini", "openrouter", "mistral", "nvidia-nim", "cloudflare-workers-ai"].includes(provider.id)) return "high";
  if (["kilo-gateway", "ovh", "ai-horde", "cohere", "huggingface"].includes(provider.id)) return "medium";
  return "unknown";
}
