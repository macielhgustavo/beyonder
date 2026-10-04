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
    const observedAt = Date.parse(progress?.lastUpdatedAt ?? "");
    const resetAt = parseReset(headers["x-ratelimit-reset-requests"] ?? headers["ratelimit-reset"] ?? headers["x-rate-limit-reset"], observedAt);
    const fresh = Number.isFinite(observedAt) && Date.now() - observedAt >= 0 && Date.now() - observedAt < 300_000 && (resetAt === "unknown" || Date.parse(resetAt) > Date.now());

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
      requestQuotaRemaining: fresh ? headerNumber(headers, ["x-ratelimit-remaining-requests", "ratelimit-remaining", "x-rate-limit-remaining"]) : "unknown",
      tokenQuotaTotal,
      tokenQuotaRemaining: fresh ? headerNumber(headers, ["x-ratelimit-remaining-tokens"]) : "unknown",
      resetAt: fresh ? resetAt : "unknown",
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

export function parseReset(raw: string | undefined, observedAt = Date.now()): string | "unknown" {
  if (!raw) return "unknown";
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    if (numeric < 0 || !Number.isFinite(observedAt)) return "unknown";
    const timestamp = numeric > 1_000_000_000_000 ? numeric : numeric > 1_000_000_000 ? numeric * 1000 : observedAt + numeric * 1000;
    return Number.isFinite(new Date(timestamp).getTime()) ? new Date(timestamp).toISOString() : "unknown";
  }
  if (/^(?:\d+(?:\.\d+)?(?:ms|s|m|h|d))+$/.test(raw) && Number.isFinite(observedAt)) {
    const units: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    const duration = [...raw.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)].reduce((sum, match) => sum + Number(match[1]) * units[match[2]!]!, 0);
    return Number.isFinite(new Date(observedAt + duration).getTime()) ? new Date(observedAt + duration).toISOString() : "unknown";
  }
  const direct = Date.parse(raw);
  return Number.isFinite(direct) ? new Date(direct).toISOString() : "unknown";
}
