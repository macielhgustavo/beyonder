import { AutopilotStateStore, getProvider, providers } from "@beyonder/compute";
import type { QuotaSnapshot, QuotaValue } from "./adaptive-types.js";

export interface QuotaSource {
  get(provider: string, model?: string): Promise<QuotaSnapshot>;
  list(): Promise<QuotaSnapshot[]>;
}

export class AutopilotQuotaSource implements QuotaSource {
  constructor(private readonly providerStatePath: string) {}

  async get(providerId: string, model?: string): Promise<QuotaSnapshot> {
    const catalog = getProvider(providerId);
    const state = await new AutopilotStateStore(this.providerStatePath).read();
    const progress = state.providers[providerId];
    const headers = normalizeHeaders(progress?.validation?.rateLimitHeaders ?? {});
    const limits = catalog?.freeTierLimits;

    const requestQuotaTotal = firstNumber(
      headerNumber(headers, ["x-ratelimit-limit-requests", "ratelimit-limit", "x-rate-limit-limit"]),
      numericLimit(limits?.rpd)
    );
    const tokenQuotaTotal = firstNumber(
      headerNumber(headers, ["x-ratelimit-limit-tokens", "x-ratelimit-token-limit"]),
      numericLimit(limits?.tpd)
    );

    return {
      provider: providerId,
      model,
      requestsPerMinute: numericLimit(limits?.rpm),
      requestsPerDay: numericLimit(limits?.rpd),
      tokensPerMinute: numericLimit(limits?.tpm),
      tokensPerDay: numericLimit(limits?.tpd),
      requestQuotaTotal,
      requestQuotaRemaining: headerNumber(headers, ["x-ratelimit-remaining-requests", "ratelimit-remaining", "x-rate-limit-remaining"]),
      tokenQuotaTotal,
      tokenQuotaRemaining: headerNumber(headers, ["x-ratelimit-remaining-tokens"]),
      resetAt: parseReset(headers["x-ratelimit-reset-requests"] ?? headers["ratelimit-reset"] ?? headers["x-rate-limit-reset"]),
      health: providerHealth(catalog?.authType, progress?.state),
      lastUpdatedAt: progress?.lastUpdatedAt ?? "unknown"
    };
  }

  async list(): Promise<QuotaSnapshot[]> {
    return Promise.all(providers.map((provider) => this.get(provider.id)));
  }
}

export class UnknownQuotaSource implements QuotaSource {
  async get(provider: string, model?: string): Promise<QuotaSnapshot> {
    return unknownSnapshot(provider, model);
  }

  async list(): Promise<QuotaSnapshot[]> {
    return [];
  }
}

function unknownSnapshot(provider: string, model?: string): QuotaSnapshot {
  return {
    provider,
    model,
    requestsPerMinute: "unknown",
    requestsPerDay: "unknown",
    tokensPerMinute: "unknown",
    tokensPerDay: "unknown",
    requestQuotaTotal: "unknown",
    requestQuotaRemaining: "unknown",
    tokenQuotaTotal: "unknown",
    tokenQuotaRemaining: "unknown",
    resetAt: "unknown",
    health: "unknown",
    lastUpdatedAt: "unknown"
  };
}

function numericLimit(value: number | "unknown" | undefined): QuotaValue {
  return typeof value === "number" && Number.isFinite(value) ? value : "unknown";
}

function firstNumber(...values: QuotaValue[]): QuotaValue {
  return values.find((value): value is number => typeof value === "number") ?? "unknown";
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

function headerNumber(headers: Record<string, string>, names: string[]): QuotaValue {
  for (const name of names) {
    const raw = headers[name];
    if (raw == null) continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return "unknown";
}

function providerHealth(authType: string | undefined, state: string | undefined): QuotaSnapshot["health"] {
  if (state === "READY") return authType === "keyless" ? "keyless" : "healthy";
  if (state === "FAILED" || state === "SKIPPED") return "unhealthy";
  if (!state && authType === "keyless") return "keyless";
  return "unknown";
}

function parseReset(raw: string | undefined): string | "unknown" {
  if (!raw) return "unknown";
  const direct = Date.parse(raw);
  if (!Number.isNaN(direct)) return new Date(direct).toISOString();
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric < 0) return "unknown";
  if (numeric > 1_000_000_000_000) return new Date(numeric).toISOString();
  if (numeric > 1_000_000_000) return new Date(numeric * 1000).toISOString();
  return new Date(Date.now() + numeric * 1000).toISOString();
}
