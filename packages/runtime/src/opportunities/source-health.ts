import type { StateStore } from "../memory/state-store.js";

export type SourceHealthStatus = "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "RATE_LIMITED" | "AUTH_REQUIRED" | "UNKNOWN";
export interface SourceReliability { sourceId: string; status: SourceHealthStatus; availability: number; latencyMs?: number; successfulDiscoveries: number; malformedResponses: number; errorTypes: Record<string, number>; lastSuccess?: string; lastFailure?: string; updatedAt: string; }
const KEY = "opportunity-sources:reliability";
export class SourceReliabilityStore {
  constructor(private readonly state: StateStore, private readonly now: () => Date = () => new Date()) {}
  async record(sourceId: string, input: { status: SourceHealthStatus; latencyMs: number; discovered: number; error?: string; malformed?: boolean }): Promise<SourceReliability> {
    const all = await this.all(); const previous = all.find((item) => item.sourceId === sourceId);
    const success = input.error === undefined && !input.malformed;
    const errorTypes = { ...(previous?.errorTypes ?? {}) };
    if (input.error) { const key = input.error.match(/HTTP \d+/)?.[0] ?? (input.error.toLowerCase().includes("timeout") ? "TIMEOUT" : "OTHER"); errorTypes[key] = (errorTypes[key] ?? 0) + 1; }
    const total = (previous?.successfulDiscoveries ?? 0) + (input.error === undefined ? 1 : 0);
    const failures = (previous?.malformedResponses ?? 0) + (input.malformed ? 1 : 0) + (input.error ? 1 : 0);
    const record: SourceReliability = { sourceId, status: input.status, availability: total / Math.max(1, total + failures), latencyMs: input.latencyMs, successfulDiscoveries: (previous?.successfulDiscoveries ?? 0) + (success ? input.discovered : 0), malformedResponses: (previous?.malformedResponses ?? 0) + (input.malformed ? 1 : 0), errorTypes, lastSuccess: success ? this.now().toISOString() : previous?.lastSuccess, lastFailure: success ? previous?.lastFailure : this.now().toISOString(), updatedAt: this.now().toISOString() };
    await this.state.set(KEY, [...all.filter((item) => item.sourceId !== sourceId), record]); return record;
  }
  async all(): Promise<SourceReliability[]> { return this.state.get<SourceReliability[]>(KEY, []); }
}

export function sourceHealthFromError(error?: string): SourceHealthStatus {
  if (!error) return "HEALTHY";
  if (/429/.test(error)) return "RATE_LIMITED";
  if (/401|403/.test(error)) return "AUTH_REQUIRED";
  if (/5\d\d|timeout|network/i.test(error)) return "UNAVAILABLE";
  return "DEGRADED";
}
