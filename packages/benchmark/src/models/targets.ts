import { buildComputeInventory, getProvider, type CredentialBroker } from "@beyonder/compute";
import type { ModelTarget } from "../types.js";

const UNSAFE_MODEL_MARKERS = ["verify-current", "auto"];
type AutopilotState = Parameters<typeof buildComputeInventory>[0];
type ComputeInventoryEntry = ReturnType<typeof buildComputeInventory>[number];

export function selectFreeModelTargets(state: AutopilotState, broker: CredentialBroker): ModelTarget[] {
  return buildComputeInventory(state).flatMap((entry) => targetsForEntry(entry, broker));
}

function targetsForEntry(entry: ComputeInventoryEntry, broker: CredentialBroker): ModelTarget[] {
  const provider = getProvider(entry.providerId);
  const baseUrl = provider?.openAiCompatibleEndpoint;
  if (!baseUrl) return [];
  if (entry.cost !== "$0") return [];
  if (!["healthy", "keyless"].includes(entry.status)) return [];
  if (provider.billingRisk || provider.classification === "PAID_ONLY") return [];

  const apiKey = provider.authType === "keyless" ? undefined : broker.getProviderSecrets(provider.id)[0]?.value;
  if (provider.authType !== "keyless" && !apiKey) return [];

  return entry.models
    .filter((model) => isSafeModel(entry.providerId, model))
    .slice(0, 2)
    .map((model) => ({
      provider: entry.providerId,
      providerName: entry.providerName,
      model,
      baseUrl: resolveBaseUrl(baseUrl, broker, provider.id),
      apiKey,
      accountId: broker.getSecret(provider.id, "CLOUDFLARE_ACCOUNT_ID"),
      rateLimitDelayMs: rateLimitDelay(entry)
    }));
}

function isSafeModel(providerId: string, model: string): boolean {
  const normalized = model.toLowerCase();
  if (UNSAFE_MODEL_MARKERS.some((marker) => normalized === marker || normalized.endsWith(`/${marker}`))) return false;
  if (providerId === "openrouter") return normalized.endsWith(":free");
  if (providerId === "unorouter" || providerId === "orcarouter") return normalized.includes("free");
  return !normalized.includes("paid") && !normalized.includes("premium") && !normalized.includes("subscription");
}

function resolveBaseUrl(baseUrl: string, broker: CredentialBroker, providerId: string): string {
  const accountId = broker.getSecret(providerId, "CLOUDFLARE_ACCOUNT_ID");
  return accountId ? baseUrl.replace("{account_id}", accountId) : baseUrl;
}

function rateLimitDelay(entry: ComputeInventoryEntry): number {
  if (entry.rpm === "unknown" || entry.rpm == null) return 750;
  if (entry.rpm <= 0) return 2_000;
  return Math.max(250, Math.ceil(60_000 / entry.rpm));
}
