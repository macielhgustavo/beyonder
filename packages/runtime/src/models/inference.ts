import { nanoid } from "nanoid";
import { redactSecrets, redactString } from "@beyonder/tools";
import type { ModelCandidate } from "./adaptive-types.js";
import type { ModelMessage, ModelResponse } from "../types.js";

export type InferencePhase = "PLANNING" | "ACTION_PLANNING" | "DIRECT_RESPONSE" | "TOOL_EXECUTION" | "REPLANNING" | "OBJECTIVE_VERIFICATION";
export type FailureClass = "BAD_REQUEST" | "AUTH_REQUIRED" | "FORBIDDEN" | "MODEL_UNAVAILABLE" | "RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "TIMEOUT" | "NETWORK_ERROR" | "INVALID_OUTPUT" | "INVALID_ACTION" | "NO_CANDIDATES" | "NEEDS_CAPABILITY" | "BUDGET_EXHAUSTED" | "TOOL_ERROR" | "TOOL_UNAVAILABLE";
export interface InferenceAttempt {
  id: string; taskId: string; stepId?: string; phase: InferencePhase; attempt: number;
  provider: string; model: string; inferenceProfile?: string; startedAt: string; completedAt?: string;
  status: "STARTED" | "SUCCEEDED" | "FAILED"; latencyMs?: number;
  failureClass?: FailureClass; httpStatus?: number; upstreamHttpStatus?: number; error?: string; responseBody?: string; retryAfterAt?: string;
  monetaryCostUsd: number; shadowCostUsd: number;
  attribution?: ModelResponse["attribution"];
  failureScope?: "provider" | "model";
}
export class InferenceError extends Error {
  constructor(message: string, readonly failureClass: FailureClass, readonly httpStatus?: number, readonly responseBody?: string, readonly retryAfterAt?: string, readonly failureScope?: "provider" | "model", readonly upstreamHttpStatus?: number) { super(message); }
}
export function classifyFailure(error: unknown): InferenceError {
  if (error instanceof InferenceError) return error;
  const message = redactString(error instanceof Error ? error.message : String(error)).slice(0, 1000);
  const status = Number(message.match(/(?:HTTP|status|failed:)\s*(\d{3})/i)?.[1]) || undefined;
  if (status) return httpFailure(status, message);
  if (error instanceof SyntaxError) return new InferenceError(message, "INVALID_OUTPUT");
  if (/abort|timeout|timed out/i.test(message) || (error instanceof Error && /Abort|Timeout/.test(error.name))) return new InferenceError(message, "TIMEOUT");
  return new InferenceError(message, "NETWORK_ERROR");
}
export function safeDiagnosticBody(body: string): string {
  try { return JSON.stringify(redactSecrets(JSON.parse(body))); }
  catch {
    return redactString(body).replace(
      /((?:["']?)(?:api[_-]?key|token|secret|password|authorization|cookie|credential|private[_-]?key)(?:["']?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
      "$1[REDACTED]",
    );
  }
}
export function httpFailure(status: number, body: string, headers?: Headers): InferenceError {
  const failureClass: FailureClass = status === 400 || status === 422 ? "BAD_REQUEST" : status === 401 ? "AUTH_REQUIRED" : status === 403 ? "FORBIDDEN" : status === 404 ? "MODEL_UNAVAILABLE" : status === 429 || status === 402 ? "RATE_LIMITED" : "PROVIDER_UNAVAILABLE";
  const safeBody = safeDiagnosticBody(body);
  const detail = /tool_use_failed|Tool choice is none, but model called a tool/i.test(body) ? " Model attempted a tool call in an inference phase where tools are disabled; it was not executed." : "";
  const failureScope = responseFailureScope(body);
  return new InferenceError(`Provider returned HTTP ${status}.${detail}`, failureClass, status, safeBody.slice(0, 1500), parseRetryAfter(headers?.get("retry-after")), failureScope);
}

/** Gateways can report upstream HTTP errors in a successful HTTP envelope. */
export function completionEnvelopeFailure(error: unknown, httpStatus: number, headers?: Headers): InferenceError {
  const body = JSON.stringify({ error });
  const code = error && typeof error === "object" && "code" in error ? Number(error.code) : NaN;
  if (!Number.isInteger(code) || code < 400 || code > 599) return new InferenceError("Provider returned an invalid completion envelope.", "INVALID_OUTPUT", httpStatus, safeDiagnosticBody(body).slice(0, 1500));
  const upstream = httpFailure(code, body, headers);
  return new InferenceError(`Gateway reported an upstream failure: ${upstream.message}`, upstream.failureClass, httpStatus, upstream.responseBody, upstream.retryAfterAt, upstream.failureScope, code);
}

/** A daily cap may belong to one upstream model, not the entire gateway.
 * Unknown shared-capacity scopes retain the conservative provider exclusion. */
export function responseFailureScope(body: string): "model" | "provider" | undefined {
  if (/Rate limit exceeded for free models|gateway[_ -]rate[_ -]limit/i.test(body)) return "provider";
  if (/PAID_MODEL_AUTH_REQUIRED|paid_model_auth_required|upstream_provider_(?:shared_pool|account)/.test(body)) return "model";
  try {
    const payload = JSON.parse(body) as { error?: { message?: unknown; metadata?: { limit_source?: unknown } } };
    const error = payload?.error;
    if (error?.metadata?.limit_source === "openrouter_shared_capacity" && typeof error.message === "string"
      && /\blimit_(?:rpd|rpm|tpd|tpm)\/[a-z0-9_.-]+\/[a-z0-9_.:-]+\/[a-z0-9-]+/i.test(error.message)) return "model";
  } catch { /* No concrete scope was observed. */ }
  return undefined;
}

export function parseRetryAfter(raw?: string | null, now = Date.now()): string | undefined {
  if (!raw?.trim()) return undefined;
  const value = raw.trim();
  const numeric = Number(value);
  const until = Number.isFinite(numeric) ? numeric >= 0 ? now + numeric * 1000 : NaN : Date.parse(value);
  return Number.isFinite(until) && until >= now ? new Date(Math.min(until, now + 7 * 86_400_000)).toISOString() : undefined;
}

export function validateDirectResponse(content: string): string {
  if (!content.trim()) throw new InferenceError("Empty model response.", "INVALID_OUTPUT");
  if (/<(?:tool_call|function)|\bweb\.run\s*\(|"(?:tool_calls|function_call|tool)"\s*:|\bto=\w+[.\w]*/i.test(content)) throw new InferenceError("Model attempted a pseudo tool call in DIRECT_RESPONSE; no tool was executed.", "INVALID_OUTPUT");
  return content.trim();
}

/** Extract exactly one object, tracking strings and nesting rather than greedy regex. */
export function parseStructuredObject(content: string): Record<string, unknown> {
  const text = content.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1");
  if (text.startsWith("[")) throw new InferenceError("Expected object, not array.", "INVALID_OUTPUT");
  let start = -1, depth = 0, quoted = false, escaped = false;
  const objects: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (start < 0) { if (c === "{") { start = i; depth = 1; } continue; }
    if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) { objects.push(text.slice(start, i + 1)); start = -1; }
  }
  if (objects.length !== 1 || depth !== 0) throw new InferenceError("Expected one unambiguous JSON object.", "INVALID_OUTPUT");
  try { return JSON.parse(objects[0]!) as Record<string, unknown>; }
  catch { throw new InferenceError("Invalid JSON object.", "INVALID_OUTPUT"); }
}

export async function runCandidates<T>(input: {
  taskId: string; stepId?: string; phase: InferencePhase; candidates: ModelCandidate[];
  messages: ModelMessage[]; maxCandidates?: number; maxMonetaryCostUsd: number; maxShadowCostUsd: number; maxDurationMs: number;
  remoteAttemptBudget?: number;
  localFallbackBudget?: number;
  localFallbackFailureClasses?: FailureClass[];
  complete: (messages: ModelMessage[], candidate: ModelCandidate, signal?: AbortSignal) => Promise<ModelResponse>;
  validate: (response: ModelResponse) => T;
  record?: (attempt: InferenceAttempt) => Promise<void>;
  canAttempt?: (candidate: ModelCandidate) => Promise<boolean>;
}): Promise<{ value: T; response: ModelResponse; candidate: ModelCandidate; attempts: InferenceAttempt[]; monetaryCostUsd: number; shadowCostUsd: number }> {
  const start = Date.now();
  const attempts: InferenceAttempt[] = [];
  let monetaryCostUsd = 0, shadowCostUsd = 0;
  let last: InferenceError = new InferenceError("Adequate models for this mission are unavailable. Available compute is below the required quality floor or policy constraints.", "NEEDS_CAPABILITY");
  const requestedRemoteAttemptBudget = Math.max(0, input.remoteAttemptBudget ?? input.maxCandidates ?? 3);
  const localFallbackBudget = Math.max(0, input.localFallbackBudget ?? 1);
  const cloudFirstMetadata = input.candidates.some((candidate) => candidate.computeTier !== undefined);
  const legacyMaxCandidates = Math.max(0, input.maxCandidates ?? requestedRemoteAttemptBudget);
  const legacyHasLocal = input.candidates.some((candidate) => candidate.local);
  const legacyRemoteBudget = legacyHasLocal && legacyMaxCandidates > 0
    ? Math.min(requestedRemoteAttemptBudget, Math.max(1, legacyMaxCandidates - 1))
    : Math.min(requestedRemoteAttemptBudget, legacyMaxCandidates);
  const remoteAttemptBudget = cloudFirstMetadata ? requestedRemoteAttemptBudget : legacyRemoteBudget;
  // Do not slice before canAttempt: a sibling invalidated by provider health must not
  // consume a physical-attempt slot or prevent a later healthy cloud from being tried.
  const remoteCandidates = input.candidates.filter((candidate) => !candidate.local);
  const localCandidates = input.candidates.filter(isAcceptableLocalFallback).slice(0, localFallbackBudget);
  const candidates = [...remoteCandidates, ...localCandidates];
  let remoteAttempts = 0;
  let localAttempts = 0;
  const localFallbackFailureClasses = input.localFallbackFailureClasses ?? ["BAD_REQUEST", "AUTH_REQUIRED", "FORBIDDEN", "MODEL_UNAVAILABLE", "RATE_LIMITED", "PROVIDER_UNAVAILABLE", "TIMEOUT", "NETWORK_ERROR"];

  for (const candidate of candidates) {
    if (candidate.local) {
      if (localAttempts >= localFallbackBudget) continue;
      if (remoteAttempts > 0 && !localFallbackFailureClasses.includes(last.failureClass)) break;
    } else if (remoteAttempts >= remoteAttemptBudget) {
      continue;
    }
    if (input.canAttempt && !await input.canAttempt(candidate)) continue;
    if (Date.now() - start >= input.maxDurationMs || monetaryCostUsd + candidate.monetaryCostUsd > input.maxMonetaryCostUsd || shadowCostUsd + candidate.shadowCostUsd > input.maxShadowCostUsd) {
      last = new InferenceError("Inference budget exhausted.", "BUDGET_EXHAUSTED"); break;
    }

    if (candidate.local) localAttempts++;
    else remoteAttempts++;
    const attempt: InferenceAttempt = { id: nanoid(), taskId: input.taskId, stepId: input.stepId, phase: input.phase, attempt: attempts.length + 1, provider: candidate.provider, model: candidate.model, inferenceProfile: candidate.inferenceProfile, startedAt: new Date().toISOString(), status: "STARTED", monetaryCostUsd: 0, shadowCostUsd: candidate.shadowCostUsd };
    attempts.push(attempt);
    await input.record?.(attempt);
    shadowCostUsd += candidate.shadowCostUsd;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let response: ModelResponse | undefined;
    try {
      response = await Promise.race([input.complete(input.messages, candidate, controller.signal), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new InferenceError("Inference deadline exceeded.", "TIMEOUT")); }, Math.max(1, input.maxDurationMs - (Date.now() - start))); })]);
      attempt.monetaryCostUsd = response.estimatedCostUsd;
      attempt.attribution = response.attribution;
      monetaryCostUsd += response.estimatedCostUsd;
      if (!Number.isFinite(response.estimatedCostUsd) || response.estimatedCostUsd < 0 || monetaryCostUsd > input.maxMonetaryCostUsd) throw new InferenceError("Provider reported a cost outside the authorized monetary budget.", "BUDGET_EXHAUSTED");
      const value = input.validate(response);
      attempt.status = "SUCCEEDED";
      return { value, response, candidate, attempts, monetaryCostUsd, shadowCostUsd };
    } catch (error) {
      last = classifyFailure(error);
      if (last.failureClass === "INVALID_OUTPUT" && response?.content) last = new InferenceError(last.message, last.failureClass, last.httpStatus, safeDiagnosticBody(response.content).slice(0, 1_500), last.retryAfterAt);
      Object.assign(attempt, { status: "FAILED", failureClass: last.failureClass, failureScope: last.failureScope, httpStatus: last.httpStatus, upstreamHttpStatus: last.upstreamHttpStatus, error: last.message, responseBody: last.responseBody, retryAfterAt: last.retryAfterAt });
    } finally {
      if (timer) clearTimeout(timer);
      attempt.completedAt = new Date().toISOString();
      attempt.latencyMs = Date.now() - Date.parse(attempt.startedAt);
      await input.record?.(redactSecrets(attempt) as InferenceAttempt);
    }
  }
  if (cloudFirstMetadata && attempts.length > 0 && attempts.every((attempt) => ["AUTH_REQUIRED", "FORBIDDEN", "MODEL_UNAVAILABLE", "RATE_LIMITED", "PROVIDER_UNAVAILABLE", "TIMEOUT", "NETWORK_ERROR"].includes(attempt.failureClass ?? ""))) {
    throw new InferenceError(`No acceptable compute remains after qualified provider attempts failed (${last.failureClass}).`, "NEEDS_CAPABILITY");
  }
  throw last;
}

function isAcceptableLocalFallback(candidate: ModelCandidate): boolean {
  return candidate.local === true
    && candidate.provider === "ollama"
    && candidate.externalQuotaConsumption === false
    && candidate.monetaryCostUsd === 0
    && candidate.costClass === "FREE_CONFIRMED"
    && (candidate.computeTier === undefined || candidate.computeTier === "LOCAL_EMERGENCY")
    && candidate.eligible !== false;
}
