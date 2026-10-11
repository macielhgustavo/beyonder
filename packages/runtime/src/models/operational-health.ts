import type { StateStore } from "../memory/state-store.js";
import { parseRateLimitReset, responseFailureScope, type InferenceAttempt } from "./inference.js";

export interface OperationalHealth {
  samples: number;
  failures: number;
  latencyMs: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  cooldown?: { reason: string; scope: "provider" | "model"; until: string; deadlineSource?: "provider-reset" | "retry-after" | "fallback" };
}
const empty = (): OperationalHealth => ({ samples: 0, failures: 0, latencyMs: 0 });
export function operationalCooldown(attempt: InferenceAttempt, now = Date.now()): OperationalHealth["cooldown"] {
  if (attempt.status !== "FAILED") return undefined;
  const body = attempt.responseBody ?? "";
  const cls = attempt.failureClass;
  let duration = 0, scope: "provider" | "model" = "model", reason = cls ?? "unknown";
  if (cls === "AUTH_REQUIRED") { duration = 60 * 60_000; scope = attempt.failureScope ?? (/PAID_MODEL_AUTH_REQUIRED|paid_model_auth_required/.test(body) ? "model" : "provider"); }
  else if (cls === "FORBIDDEN") duration = 60 * 60_000;
  else if (cls === "MODEL_UNAVAILABLE") duration = 6 * 60 * 60_000;
  else if (cls === "RATE_LIMITED") {
    const daily = /per[_ -]?day|daily|\brpd\b|\btpd\b/i.test(body);
    const account = attempt.httpStatus === 402 || /account|insufficient[_ ](?:quota|balance)|credits? exhausted|billing/i.test(body);
    const upstreamScope = attempt.failureScope ?? responseFailureScope(body);
    scope = upstreamScope ?? (daily || account ? "provider" : "model");
    const exhausted = daily || (account && scope === "provider");
    reason = exhausted ? "QUOTA_EXHAUSTED" : "RATE_LIMITED";
    duration = exhausted ? 24 * 60 * 60_000 : 3 * 60_000;
  } else if (["TIMEOUT", "NETWORK_ERROR", "PROVIDER_UNAVAILABLE"].includes(cls ?? "")) duration = 60_000;
  // A generic bad request/output is not evidence that a provider is unavailable.
  if (!duration) return undefined;
  const retryAt = Date.parse(attempt.retryAfterAt ?? "");
  const resetAt = cls === "RATE_LIMITED" ? Date.parse(parseRateLimitReset(body, undefined, now) ?? "") : NaN;
  const observed = [retryAt, resetAt].filter(timestamp => Number.isFinite(timestamp) && timestamp > now);
  const until = observed.length ? Math.min(Math.max(...observed), now + 7 * 86_400_000) : now + duration;
  return { reason, scope, until: new Date(until).toISOString(), deadlineSource: observed.length ? resetAt === until ? "provider-reset" : "retry-after" : "fallback" };
}

export class OperationalHealthStore {
  private readonly checkedLegacyScopes = new Set<string>();
  private readonly checkedLegacyDeadlines = new Set<string>();
  async reclassifyLegacyModelDeadline(provider: string, model: string): Promise<{ attemptId: string; beforeUntil: string; until: string } | undefined> {
    const key = `model-health:${provider}:${model}`;
    if (!this.state || this.checkedLegacyDeadlines.has(key)) return;
    this.checkedLegacyDeadlines.add(key);
    const health = await this.get(provider, model);
    if (!health.cooldown || health.cooldown.deadlineSource || !["RATE_LIMITED", "QUOTA_EXHAUSTED"].includes(health.cooldown.reason)) return;
    const attempts = (await this.state.values<InferenceAttempt[]>("task-attempts:")).flat();
    const origin = attempts.find(attempt => attempt.provider === provider && attempt.model === model && attempt.status === "FAILED" && attempt.completedAt === health.lastFailureAt);
    const failedAt = Date.parse(origin?.completedAt ?? "");
    if (!origin || !Number.isFinite(failedAt)) return;
    const observed = operationalCooldown(origin, failedAt);
    if (!observed || observed.scope !== "model" || observed.deadlineSource === "fallback") return;
    // Reinterpret only the matching retained provider response. A catalog or
    // successful sibling cannot erase quota, and a newer failure wins the race.
    const updated = await this.state.update<OperationalHealth>(key, empty(), current => current.lastFailureAt === health.lastFailureAt && current.cooldown?.until === health.cooldown!.until ? { ...current, cooldown: observed } : current);
    if (updated.lastFailureAt !== health.lastFailureAt || updated.cooldown?.until !== observed.until || updated.cooldown?.deadlineSource !== observed.deadlineSource) return;
    return { attemptId: origin.id, beforeUntil: health.cooldown.until, until: observed.until };
  }
  async reclassifyLegacyProviderCooldown(provider: string): Promise<{ attemptId: string; model: string; reason: string } | undefined> {
    if (!this.state || this.checkedLegacyScopes.has(provider)) return;
    this.checkedLegacyScopes.add(provider);
    const health = await this.get(provider);
    if (!health.cooldown || health.cooldown.scope !== "provider") return;
    const attempts = (await this.state.values<InferenceAttempt[]>("task-attempts:")).flat();
    const origin = attempts.find(attempt => attempt.provider === provider && attempt.status === "FAILED" && attempt.completedAt === health.lastFailureAt);
    if (!origin || operationalCooldown(origin)?.scope !== "model") return;
    // Reinterpret the retained original response, retaining the old backoff on
    // the affected model. Genuine gateway quota remains blocked.
    const cooldown = { ...health.cooldown, scope: "model" as const };
    await this.state.update<OperationalHealth>(`model-health:${provider}:${origin.model}`, empty(), current => ({ ...current, cooldown: !current.cooldown || current.cooldown.until < cooldown.until ? cooldown : current.cooldown }));
    await this.state.update<OperationalHealth>(`provider-health:${provider}`, empty(), current => current.cooldown?.until === health.cooldown!.until ? { ...current, cooldown: undefined } : current);
    return { attemptId: origin.id, model: origin.model, reason: cooldown.reason };
  }

  constructor(private readonly state?: StateStore, private readonly now = () => Date.now()) {}

  async get(provider: string, model?: string): Promise<OperationalHealth> {
    return this.state?.get<OperationalHealth>(model ? `model-health:${provider}:${model}` : `provider-health:${provider}`, empty()) ?? empty();
  }
  async blocked(provider: string, model: string) {
    for (const health of [await this.get(provider), await this.get(provider, model)]) {
      if (health.cooldown && Date.parse(health.cooldown.until) > this.now()) return health.cooldown;
    }
    return undefined;
  }
  async credentialValidated(provider: string) {
    // Validation may repair authentication, but it does not prove a quota reset.
    await this.state?.update<OperationalHealth>(`provider-health:${provider}`, empty(), (health) => health.cooldown?.reason === "AUTH_REQUIRED" ? { ...health, cooldown: undefined } : health);
  }
  async record(attempt: InferenceAttempt) {
    if (!this.state || attempt.status === "STARTED" || attempt.phase === "TOOL_EXECUTION" || attempt.failureClass === 'ECONOMIC_POLICY_BLOCKED') return;
    // The bounded per-route sample list makes duplicate terminal callbacks idempotent.
    // This also bounds the effect of ancient outages, unlike lifetime means.
    for (const key of [`model-health:${attempt.provider}:${attempt.model}`, `provider-health:${attempt.provider}`]) {
      await this.state.update<OperationalHealth & { recent?: Array<{ id: string; failed: boolean; latency: number }> }>(key, empty(), (previous) => {
        if (previous.recent?.some((entry) => entry.id === attempt.id)) return previous;
        const failed = attempt.status === "FAILED" && !["INVALID_OUTPUT", "INVALID_ACTION", "BAD_REQUEST"].includes(attempt.failureClass ?? "");
        const recent = [...(previous.recent ?? []), { id: attempt.id, failed, latency: attempt.latencyMs ?? 0 }].slice(-100);
        const cooldown = operationalCooldown(attempt, this.now());
        const applies = cooldown && (key.startsWith("model-health:") ? cooldown.scope === "model" : cooldown.scope === "provider");
        return { ...previous, recent, samples: recent.length, failures: recent.filter((entry) => entry.failed).length,
          latencyMs: recent.reduce((sum, entry) => sum + entry.latency, 0) / recent.length,
          ...(attempt.status === "SUCCEEDED" ? { lastSuccessAt: attempt.completedAt } : { lastFailureAt: attempt.completedAt }),
          ...(applies ? { cooldown: !previous.cooldown || Date.parse(cooldown.until) > Date.parse(previous.cooldown.until) ? cooldown : previous.cooldown } : {}) };
      });
    }
  }
}
