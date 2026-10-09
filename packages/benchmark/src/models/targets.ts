import { AutopilotStateStore, buildComputeInventory, getProvider, isModelMetadataEligibleForWorkload, resolveZeroCostExecution, readAccountCostEvidence, observedEconomicQuota, declaredProviderAccountPlan, type ZeroCostDecision, type CredentialBroker } from "@beyonder/compute";
import type { ModelTarget } from "../types.js";

const UNSAFE_MODEL_MARKERS = ["verify-current", "auto"];
type AutopilotState = Parameters<typeof buildComputeInventory>[0];
type ComputeInventoryEntry = ReturnType<typeof buildComputeInventory>[number];

export interface BenchmarkTargetSelection { provider?: string; models?: string[]; reasoningMode?: "low" | "disabled"; economicEvidence?: (provider: string, model: string) => ZeroCostDecision; }

export function selectFreeModelTargets(state: AutopilotState, broker: CredentialBroker, selection: BenchmarkTargetSelection = {}): ModelTarget[] {
  return buildComputeInventory(state).filter(entry => !selection.provider || entry.providerId === selection.provider).flatMap((entry) => targetsForEntry(entry, broker, selection));
}

function targetsForEntry(entry: ComputeInventoryEntry, broker: CredentialBroker, selection: BenchmarkTargetSelection): ModelTarget[] {
  const provider = getProvider(entry.providerId);
  const baseUrl = provider?.openAiCompatibleEndpoint;
  if (!baseUrl) return [];
  if (entry.cost === "billing-risk") return [];
  if (!["healthy", "keyless"].includes(entry.status)) return [];
  if (provider.billingRisk || provider.classification === "PAID_ONLY") return [];

  const apiKey = provider.authType === "keyless" ? undefined : apiKeyForProvider(provider.id, broker);
  const accountId = broker.getSecret(provider.id, 'CLOUDFLARE_ACCOUNT_ID');
  const accountPlan = declaredProviderAccountPlan(provider.id, apiKey, accountId);
  if (provider.authType !== "keyless" && !apiKey) return [];

  return entry.models
    .filter(model => !selection.models || selection.models.includes(model))
    .filter((model) => isSafeModel(entry.providerId, model))
    .filter((model) => {
      const metadata = entry.modelMetadata.find(row => row.id === model);
      if (!metadata || !isModelMetadataEligibleForWorkload(metadata, "benchmark_text")) return false;
      const economics = selection.economicEvidence?.(provider.id, model) ?? resolveZeroCostExecution({ provider, model: metadata, accountPlan, usageContext: 'DEV_EVAL' });
      return economics.zeroCostExecutionGuaranteed;
    })
    .filter(model => selection.reasoningMode !== "disabled" || entry.modelMetadata.find(row => row.id === model)?.reasoningControl)
    .slice(0, selection.models ? selection.models.length : 2)
    .map((model) => protectTarget({
      economics: selection.economicEvidence?.(provider.id, model) ?? resolveZeroCostExecution({ provider, model: entry.modelMetadata.find(m => m.id === model)!, accountPlan, usageContext: 'DEV_EVAL' }),
      resolveEconomics: async () => {
        if (selection.economicEvidence) return selection.economicEvidence(provider.id, model);
        const state = await new AutopilotStateStore(broker.providerStatePath).read();
        const current = buildComputeInventory(state).find(row => row.providerId === provider.id);
        const metadata = current?.modelMetadata.find(row => row.id === model) ?? { id: model, capabilities: [], costClass: 'UNKNOWN_COST' as const };
        const resolved = await broker.resolve(provider.id);
        const credential = resolved.descriptor;
        const decision = resolveZeroCostExecution({ provider, model: metadata, credential, accountPlan: declaredProviderAccountPlan(provider.id, resolved.apiKey(), resolved.get('CLOUDFLARE_ACCOUNT_ID')), usageContext: 'DEV_EVAL', quota: observedEconomicQuota(state.providers[provider.id]), accountEvidence: (await readAccountCostEvidence()).find(row => row.provider === provider.id && row.model === model) });
        return credential.accessible && credential.valid !== false && ['healthy', 'keyless'].includes(current?.status ?? '') ? decision : { ...decision, zeroCostExecutionGuaranteed: false, monetaryCost: { state: 'UNKNOWN' }, reason: 'Current credential/provider accessibility not established.' };
      },
      provider: entry.providerId,
      providerName: entry.providerName,
      model,
      baseUrl: resolveBaseUrl(baseUrl, broker, provider.id),
      apiKey,
      accountId: broker.getSecret(provider.id, "CLOUDFLARE_ACCOUNT_ID"),
      rateLimitDelayMs: rateLimitDelay(entry),
      ...(entry.modelMetadata.find(row => row.id === model)?.reasoningControl ? { reasoning: selection.reasoningMode === "disabled" ? { enabled: false } : { effort: "low" as const } } : {})
    }));
}

function apiKeyForProvider(providerId: string, broker: CredentialBroker): string | undefined {
  if (providerId === "cloudflare-workers-ai") return broker.getSecret(providerId, "CLOUDFLARE_API_TOKEN");
  return broker.getProviderSecrets(providerId)[0]?.value;
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

/** Keep server-only credential material out of JSON snapshots and telemetry. */
function protectTarget(target: ModelTarget): ModelTarget {
  for (const key of ["apiKey", "accountId", "resolveEconomics"] as const) Object.defineProperty(target, key, { value: target[key], writable: false, enumerable: false });
  return target;
}
