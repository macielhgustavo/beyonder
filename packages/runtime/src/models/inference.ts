import { nanoid } from "nanoid";
import { redactSecrets, redactString } from "@beyonder/tools";
import type { ModelCandidate } from "./adaptive-types.js";
import type { ModelMessage, ModelResponse } from "../types.js";

export type InferencePhase = "PLANNING" | "ACTION_PLANNING" | "DIRECT_RESPONSE" | "TOOL_EXECUTION" | "REPLANNING";
export type FailureClass = "BAD_REQUEST" | "AUTH_REQUIRED" | "FORBIDDEN" | "MODEL_UNAVAILABLE" | "RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "TIMEOUT" | "NETWORK_ERROR" | "INVALID_OUTPUT" | "INVALID_ACTION" | "NO_CANDIDATES" | "BUDGET_EXHAUSTED" | "TOOL_ERROR" | "TOOL_UNAVAILABLE";
export interface InferenceAttempt {
  id: string; taskId: string; stepId?: string; phase: InferencePhase; attempt: number;
  provider: string; model: string; startedAt: string; completedAt?: string;
  status: "STARTED" | "SUCCEEDED" | "FAILED"; latencyMs?: number;
  failureClass?: FailureClass; httpStatus?: number; error?: string; responseBody?: string; retryAfterAt?: string;
  monetaryCostUsd: number; shadowCostUsd: number;
}
export class InferenceError extends Error {
  constructor(message: string, readonly failureClass: FailureClass, readonly httpStatus?: number, readonly responseBody?: string, readonly retryAfterAt?: string) { super(message); }
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
export function httpFailure(status: number, body: string, headers?: Headers): InferenceError {
  const failureClass: FailureClass = status === 400 || status === 422 ? "BAD_REQUEST" : status === 401 ? "AUTH_REQUIRED" : status === 403 ? "FORBIDDEN" : status === 404 ? "MODEL_UNAVAILABLE" : status === 429 || status === 402 ? "RATE_LIMITED" : "PROVIDER_UNAVAILABLE";
  let safeBody: string;
  try { safeBody = JSON.stringify(redactSecrets(JSON.parse(body))); }
  catch { safeBody = redactString(body).replace(/\b(authorization|cookie|credential)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]"); }
  const detail = /tool_use_failed|Tool choice is none, but model called a tool/i.test(body) ? " Model attempted a tool call in an inference phase where tools are disabled; it was not executed." : "";
  return new InferenceError(`Provider returned HTTP ${status}.${detail}`, failureClass, status, safeBody.slice(0, 1500), parseRetryAfter(headers?.get("retry-after")));
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
  complete: (messages: ModelMessage[], candidate: ModelCandidate, signal?: AbortSignal) => Promise<ModelResponse>;
  validate: (response: ModelResponse) => T;
  record?: (attempt: InferenceAttempt) => Promise<void>;
  canAttempt?: (candidate: ModelCandidate) => Promise<boolean>;
}): Promise<{ value: T; response: ModelResponse; candidate: ModelCandidate; attempts: InferenceAttempt[]; monetaryCostUsd: number; shadowCostUsd: number }> {
  const start = Date.now();
  const attempts: InferenceAttempt[] = [];
  let monetaryCostUsd = 0, shadowCostUsd = 0;
  let last: InferenceError = new InferenceError("No compatible candidates are available.", "NO_CANDIDATES");
  const limit = input.maxCandidates ?? 3;
  const candidates = input.canAttempt ? [...input.candidates] : input.candidates.slice(0, limit);
  // Reserve one bounded fallback slot for eligible local compute, rather than letting
  // a long stale remote catalog prevent the installed models from ever being tried.
  const local = input.candidates.find((candidate) => candidate.local);
  if (limit > 1 && local && !candidates.includes(local)) candidates[candidates.length - 1] = local;
  if (input.canAttempt && limit > 1 && local && candidates.indexOf(local) >= limit) {
    candidates.splice(candidates.indexOf(local), 1);
    candidates.splice(limit - 1, 0, local);
  }
  const survivalFallback = input.remoteAttemptBudget !== undefined;
  if (survivalFallback) {
    candidates.splice(0);
    // Remote quota attempts and zero-quota local fallback have independent caps.
    candidates.push(...input.candidates.filter((c) => !c.local).slice(0, input.canAttempt ? undefined : input.remoteAttemptBudget));
    candidates.push(...input.candidates.filter((c) => c.local && c.provider === "ollama" && c.costClass === "FREE_CONFIRMED" && c.monetaryCostUsd === 0 && c.externalQuotaConsumption === false).slice(0, input.localFallbackBudget ?? 0));
  }
  for (const candidate of candidates) {
    if (survivalFallback && !candidate.local && attempts.filter((a) => a.provider !== "ollama").length >= (input.remoteAttemptBudget ?? 0)) continue;
    if (!survivalFallback && attempts.length >= limit) break;
    if (input.canAttempt && !await input.canAttempt(candidate)) continue;
    if (survivalFallback && candidate.local && attempts.length && !["BAD_REQUEST", "AUTH_REQUIRED", "FORBIDDEN", "MODEL_UNAVAILABLE", "RATE_LIMITED", "PROVIDER_UNAVAILABLE", "TIMEOUT", "NETWORK_ERROR"].includes(last.failureClass)) break;
    if (Date.now() - start >= input.maxDurationMs || monetaryCostUsd + candidate.monetaryCostUsd > input.maxMonetaryCostUsd || shadowCostUsd + candidate.shadowCostUsd > input.maxShadowCostUsd) {
      last = new InferenceError("Inference budget exhausted.", "BUDGET_EXHAUSTED"); break;
    }
    const attempt: InferenceAttempt = { id: nanoid(), taskId: input.taskId, stepId: input.stepId, phase: input.phase, attempt: attempts.length + 1, provider: candidate.provider, model: candidate.model, startedAt: new Date().toISOString(), status: "STARTED", monetaryCostUsd: 0, shadowCostUsd: candidate.shadowCostUsd };
    attempts.push(attempt);
    await input.record?.(attempt);
    shadowCostUsd += candidate.shadowCostUsd;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([input.complete(input.messages, candidate, controller.signal), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new InferenceError("Inference deadline exceeded.", "TIMEOUT")); }, Math.max(1, input.maxDurationMs - (Date.now() - start))); })]);
      attempt.monetaryCostUsd = response.estimatedCostUsd;
      monetaryCostUsd += response.estimatedCostUsd;
      const value = input.validate(response);
      attempt.status = "SUCCEEDED";
      return { value, response, candidate, attempts, monetaryCostUsd, shadowCostUsd };
    } catch (error) {
      last = classifyFailure(error);
      Object.assign(attempt, { status: "FAILED", failureClass: last.failureClass, httpStatus: last.httpStatus, error: last.message, responseBody: last.responseBody, retryAfterAt: last.retryAfterAt });
    } finally {
      if (timer) clearTimeout(timer);
      attempt.completedAt = new Date().toISOString();
      attempt.latencyMs = Date.now() - Date.parse(attempt.startedAt);
      await input.record?.(redactSecrets(attempt) as InferenceAttempt);
    }
  }
  throw last;
}
