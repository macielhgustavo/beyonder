import { CredentialBroker } from "./broker.js";
import type { ModelCatalogEntry, ProviderCatalogEntry, ProviderStatus } from "./types.js";
import { modelMetadata } from "./model-capabilities.js";
import { getProviderStatus } from "./status.js";
import { providerFetch as fetch } from "./http.js";

const TIMEOUT_MS = 10_000;

export async function validateProvider(provider: ProviderCatalogEntry, broker: CredentialBroker): Promise<ProviderStatus> {
  return (await validateProviderDetailed(provider, broker)).status;
}

export interface ProviderValidationReport {
  status: ProviderStatus;
  latencyMs?: number;
  models: string[];
  modelMetadata?: ModelCatalogEntry[];
  modelCount: number;
  rateLimitHeaders: Record<string, string>;
}

export async function validateProviderDetailed(provider: ProviderCatalogEntry, broker: CredentialBroker): Promise<ProviderValidationReport> {
  const started = Date.now();
  const baseStatus = getProviderStatus(provider, broker);
  const report = (status: ProviderStatus, models: string[] = [], rateLimitHeaders: Record<string, string> = {}): ProviderValidationReport => ({ status, models, modelCount: models.length, rateLimitHeaders, latencyMs: Date.now() - started });
  if (provider.validation?.method === "none" || (provider.authType === "keyless" && provider.validation?.method !== "keyless-models")) {
    return report({ ...baseStatus, validationStatus: "skipped", validationMessage: "No API key validation required." });
  }
  if (baseStatus.credentialStatus === "missing") {
    return report({ ...baseStatus, validationStatus: "skipped", validationMessage: "Missing credential." });
  }

  try {
    const response = await callValidationEndpoint(provider, broker);
    if (response.ok) {
      const catalog = await extractModels(response, provider);
      return { ...report({ ...baseStatus, validationStatus: "validated", validationMessage: `HTTP ${response.status}` }, catalog.models, extractRateLimitHeaders(response.headers)), modelMetadata: catalog.metadata };
    }
    return report({
      ...baseStatus,
      validationStatus: "failed",
      validationMessage: `HTTP ${response.status} ${response.statusText}`.trim()
    }, [], extractRateLimitHeaders(response.headers));
  } catch (error) {
    // Network errors may contain URLs with query credentials. Never persist them.
    return report({ ...baseStatus, validationStatus: "failed", validationMessage: "Provider validation failed (network, timeout or malformed catalog)." });
  }
}

async function callValidationEndpoint(provider: ProviderCatalogEntry, broker: CredentialBroker): Promise<Response> {
  // The deadline remains attached while extractModels consumes the body.
  const signal = AbortSignal.timeout(TIMEOUT_MS);
    switch (provider.validation?.method) {
      case "gemini-models": {
        const key = broker.getSecret(provider.id, "GEMINI_API_KEY") ?? broker.getSecret(provider.id, "GOOGLE_API_KEY");
        return await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key ?? "")}`, {
          signal
        });
      }
      case "cloudflare-models": {
        const accountId = broker.getSecret(provider.id, "CLOUDFLARE_ACCOUNT_ID");
        const token = broker.getSecret(provider.id, "CLOUDFLARE_API_TOKEN");
        return await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search`, {
          headers: { Authorization: `Bearer ${token}` },
          signal
        });
      }
      case "models": {
        const token = broker.getProviderSecrets(provider.id)[0]?.value;
        return await fetch(provider.validation.url ?? `${provider.openAiCompatibleEndpoint}/models`, {
          headers: { Authorization: `Bearer ${token}` },
          signal
        });
      }
      case "keyless-models": {
        return await fetch(provider.validation.url ?? `${provider.openAiCompatibleEndpoint}/models`, {
          signal
        });
      }
      default:
        throw new Error(`No validation method for ${provider.id}.`);
    }
}

async function extractModels(response: Response, provider: ProviderCatalogEntry): Promise<{ models: string[]; metadata: ModelCatalogEntry[] }> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) throw new Error("Expected model catalog JSON.");
  const body = await response.json() as unknown;
  if (!body || typeof body !== "object") throw new Error("Invalid model catalog.");
  const data = "data" in body ? (body as { data?: unknown }).data : undefined;
  if (Array.isArray(data)) {
    const metadata = data.flatMap(item => liveModelMetadata(provider, item));
    return { models: metadata.map(item => item.id), metadata };
  }
  const result = "result" in body ? (body as { result?: unknown }).result : undefined;
  if (Array.isArray(result)) {
    const models = result
      .map((item) => {
        if (!item || typeof item !== "object") return undefined;
        if ("name" in item) return String((item as { name: unknown }).name);
        if ("id" in item) return String((item as { id: unknown }).id);
        return undefined;
      })
      .filter((id): id is string => Boolean(id));
    return { models, metadata: models.map(id => modelMetadata(provider, id)) };
  }
  const models = "models" in body ? (body as { models?: unknown }).models : undefined;
  if (Array.isArray(models)) {
    const ids = models.flatMap((item) => item && typeof item === "object" && "name" in item && typeof item.name === "string" ? [item.name.replace(/^models\//, "")] : []);
    return { models: ids, metadata: ids.map(id => modelMetadata(provider, id)) };
  }
  throw new Error("Unknown model catalog schema.");
}

function liveModelMetadata(provider: ProviderCatalogEntry, value: unknown): ModelCatalogEntry[] {
  if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string") return [];
  const row = value as { id: string; isFree?: boolean; architecture?: { input_modalities?: string[]; output_modalities?: string[] }; pricing?: Record<string, unknown>; supported_parameters?: string[]; context_length?: number };
  const metadata = modelMetadata(provider, row.id);
  const text = row.architecture?.input_modalities?.includes("text") && row.architecture?.output_modalities?.includes("text");
  if (text && metadata.role === "unknown") { metadata.role = "instruct"; metadata.capabilities = [...new Set([...metadata.capabilities.filter(c => c !== "OTHER"), "CHAT" as const])]; }
  if (typeof row.context_length === "number" && row.context_length > 0) metadata.contextWindow = row.context_length;
  if (row.supported_parameters?.includes("tools")) metadata.toolCalling = "yes";
  if (["kilo-gateway", "openrouter"].includes(provider.id) && row.supported_parameters?.includes("reasoning")) metadata.reasoningControl = true;
  if (row.supported_parameters?.includes("response_format")) metadata.structuredOutput = "native";
  const pricing = row.pricing;
  if (pricing && Object.hasOwn(pricing, "prompt") && Object.hasOwn(pricing, "completion")) {
    const amounts = Object.entries(pricing).filter(([key]) => !["currency_unit", "discount"].includes(key)).map(([,amount]) => typeof amount === "string" && amount.trim() !== "" || typeof amount === "number" ? Number(amount) : NaN);
    const free = amounts.length > 0 && amounts.every(amount => Number.isFinite(amount) && amount === 0);
    // Only supported providers with an explicitly zero-priced model can unlock
    // a route. Negative sentinel/unknown charges and paid extras stay excluded.
    metadata.costClass = row.isFree === false || amounts.some(amount => amount > 0) ? "PAID" : free && !provider.billingRisk ? "FREE_TIER_ELIGIBLE" : "UNKNOWN_COST";
    metadata.costEvidence = { source: "live-catalog", observedAt: new Date().toISOString() };
  }
  if (row.isFree === false) metadata.costClass = "PAID";
  return [metadata];
}

function extractRateLimitHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    if (key.toLowerCase().includes("rate") || key.toLowerCase().includes("quota") || key.toLowerCase().startsWith("x-ratelimit")) {
      out[key] = value;
    }
  }
  return out;
}
