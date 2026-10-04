import type { StateStore } from "../memory/state-store.js";
import type { InferenceAttempt } from "./inference.js";

export interface OperationalHealth {
  samples: number;
  failures: number;
  latencyMs: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  cooldown?: { reason: string; scope: "provider" | "model"; until: string };
}
const empty = (): OperationalHealth => ({ samples: 0, failures: 0, latencyMs: 0 });
export function operationalCooldown(attempt: InferenceAttempt, now = Date.now()): OperationalHealth["cooldown"] {
  if (attempt.status !== "FAILED") return undefined;
  const body = attempt.responseBody ?? "";
  const cls = attempt.failureClass;
  let duration = 0, scope: "provider" | "model" = "model", reason = cls ?? "unknown";
  if (cls === "AUTH_REQUIRED") { duration = 60 * 60_000; scope = "provider"; }
  else if (cls === "FORBIDDEN") duration = 60 * 60_000;
  else if (cls === "MODEL_UNAVAILABLE") duration = 6 * 60 * 60_000;
  else if (cls === "RATE_LIMITED") {
    const daily = /per[_ -]?day|daily|\brpd\b|\btpd\b/i.test(body);
    const account = attempt.httpStatus === 402 || /account|insufficient[_ ](?:quota|balance)|credits? exhausted|billing/i.test(body);
    scope = daily || account ? "provider" : "model";
    reason = daily || account ? "QUOTA_EXHAUSTED" : "RATE_LIMITED";
    duration = daily || account ? 24 * 60 * 60_000 : 3 * 60_000;
  } else if (["TIMEOUT", "NETWORK_ERROR", "PROVIDER_UNAVAILABLE"].includes(cls ?? "")) duration = 60_000;
  // A generic bad request/output is not evidence that a provider is unavailable.
  if (!duration) return undefined;
  const retryAt = Date.parse(attempt.retryAfterAt ?? "");
  const until = Number.isFinite(retryAt) && retryAt > now ? Math.min(retryAt, now + 7 * 24 * 60 * 60_000) : now + duration;
  return { reason, scope, until: new Date(until).toISOString() };
}

export class OperationalHealthStore {
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
    if (!this.state || attempt.status === "STARTED" || attempt.phase === "TOOL_EXECUTION") return;
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
