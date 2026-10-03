import { providers } from "./catalog.js";
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
  return {
    providerId: provider.id,
    providerName: provider.name,
    status: healthy
      ? provider.authType === "keyless" ? "keyless" : "healthy"
      : human ? "human-action-required"
        : skipped ? "skipped"
          : failed ? "failed"
            : provider.authType === "keyless" ? "keyless" : "missing-credential",
    auth: provider.authType,
    cost: provider.billingRisk ? "billing-risk" : provider.classification === "PAID_ONLY" ? "billing-risk" : "$0",
    models: progress?.validation?.models?.length ? progress.validation.models : provider.knownFreeModels,
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
  if (["groq", "cerebras", "gemini", "openrouter", "mistral", "nvidia-nim"].includes(provider.id)) return "high";
  if (["kilo-gateway", "ovh", "ai-horde"].includes(provider.id)) return "medium";
  return "unknown";
}
