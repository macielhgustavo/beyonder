import { CredentialBroker } from "./broker.js";
import type { ProviderCatalogEntry, ProviderStatus } from "./types.js";
import { getProviderStatus } from "./status.js";

const TIMEOUT_MS = 10_000;

export async function validateProvider(provider: ProviderCatalogEntry, broker: CredentialBroker): Promise<ProviderStatus> {
  const baseStatus = getProviderStatus(provider, broker);
  if (provider.validation?.method === "none" || (provider.authType === "keyless" && provider.validation?.method !== "keyless-models")) {
    return { ...baseStatus, validationStatus: "skipped", validationMessage: "No API key validation required." };
  }
  if (baseStatus.credentialStatus === "missing") {
    return { ...baseStatus, validationStatus: "skipped", validationMessage: "Missing credential." };
  }

  try {
    const response = await callValidationEndpoint(provider, broker);
    if (response.ok) {
      return { ...baseStatus, validationStatus: "validated", validationMessage: `HTTP ${response.status}` };
    }
    return {
      ...baseStatus,
      validationStatus: "failed",
      validationMessage: `HTTP ${response.status} ${response.statusText}`.trim()
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...baseStatus, validationStatus: "failed", validationMessage: message };
  }
}

export interface ProviderValidationReport {
  status: ProviderStatus;
  latencyMs?: number;
  models: string[];
  modelCount: number;
  rateLimitHeaders: Record<string, string>;
}

export async function validateProviderDetailed(provider: ProviderCatalogEntry, broker: CredentialBroker): Promise<ProviderValidationReport> {
  const started = Date.now();
  const status = await validateProvider(provider, broker);
  const latencyMs = Date.now() - started;
  if (status.validationStatus !== "validated") {
    return { status, latencyMs, models: [], modelCount: 0, rateLimitHeaders: {} };
  }
  try {
    const response = await callValidationEndpoint(provider, broker);
    const models = await extractModels(response);
    return {
      status,
      latencyMs,
      models,
      modelCount: models.length,
      rateLimitHeaders: extractRateLimitHeaders(response.headers)
    };
  } catch {
    return { status, latencyMs, models: [], modelCount: 0, rateLimitHeaders: {} };
  }
}

async function callValidationEndpoint(provider: ProviderCatalogEntry, broker: CredentialBroker): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    switch (provider.validation?.method) {
      case "gemini-models": {
        const key = broker.getSecret(provider.id, "GEMINI_API_KEY") ?? broker.getSecret(provider.id, "GOOGLE_API_KEY");
        return await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key ?? "")}`, {
          signal: controller.signal
        });
      }
      case "cloudflare-models": {
        const accountId = broker.getSecret(provider.id, "CLOUDFLARE_ACCOUNT_ID");
        const token = broker.getSecret(provider.id, "CLOUDFLARE_API_TOKEN");
        return await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal
        });
      }
      case "models": {
        const token = broker.getProviderSecrets(provider.id)[0]?.value;
        return await fetch(provider.validation.url ?? `${provider.openAiCompatibleEndpoint}/models`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal
        });
      }
      case "keyless-models": {
        return await fetch(provider.validation.url ?? `${provider.openAiCompatibleEndpoint}/models`, {
          signal: controller.signal
        });
      }
      default:
        throw new Error(`No validation method for ${provider.id}.`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function extractModels(response: Response): Promise<string[]> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) return [];
  const body = await response.json() as unknown;
  if (!body || typeof body !== "object") return [];
  const data = "data" in body ? (body as { data?: unknown }).data : undefined;
  if (Array.isArray(data)) {
    return data
      .map((item) => item && typeof item === "object" && "id" in item ? String((item as { id: unknown }).id) : undefined)
      .filter((id): id is string => Boolean(id));
  }
  const result = "result" in body ? (body as { result?: unknown }).result : undefined;
  if (Array.isArray(result)) {
    return result
      .map((item) => item && typeof item === "object" && "name" in item ? String((item as { name: unknown }).name) : undefined)
      .filter((id): id is string => Boolean(id));
  }
  return [];
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
