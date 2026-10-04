import { nanoid } from "nanoid";
import { redactSecrets, redactString } from "@beyonder/tools";
import type { ModelCandidate } from "./adaptive-types.js";
import type { ModelMessage, ModelResponse } from "../types.js";

export type InferencePhase = "PLANNING" | "ACTION_PLANNING" | "DIRECT_RESPONSE" | "TOOL_EXECUTION" | "REPLANNING";
export type FailureClass = "BAD_REQUEST" | "AUTH_REQUIRED" | "FORBIDDEN" | "MODEL_UNAVAILABLE" | "RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "TIMEOUT" | "NETWORK_ERROR" | "INVALID_OUTPUT" | "INVALID_ACTION" | "NO_CANDIDATES" | "BUDGET_EXHAUSTED" | "TOOL_ERROR";
export interface InferenceAttempt {
  id: string; taskId: string; stepId?: string; phase: InferencePhase; attempt: number;
  provider: string; model: string; startedAt: string; completedAt?: string;
  status: "STARTED" | "SUCCEEDED" | "FAILED"; latencyMs?: number;
  failureClass?: FailureClass; httpStatus?: number; error?: string; responseBody?: string;
  monetaryCostUsd: number; shadowCostUsd: number;
}
export class InferenceError extends Error {
  constructor(message: string, readonly failureClass: FailureClass, readonly httpStatus?: number, readonly responseBody?: string) { super(message); }
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
export function httpFailure(status: number, body: string): InferenceError {
  const failureClass: FailureClass = status === 400 ? "BAD_REQUEST" : status === 401 ? "AUTH_REQUIRED" : status === 403 ? "FORBIDDEN" : status === 404 ? "MODEL_UNAVAILABLE" : status === 429 ? "RATE_LIMITED" : "PROVIDER_UNAVAILABLE";
  let safeBody: string;
  try { safeBody = JSON.stringify(redactSecrets(JSON.parse(body))); }
  catch { safeBody = redactString(body).replace(/\b(authorization|cookie|credential)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]"); }
  return new InferenceError(`Provider returned HTTP ${status}.`, failureClass, status, safeBody.slice(0, 1500));
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
  complete: (messages: ModelMessage[], candidate: ModelCandidate, signal?: AbortSignal) => Promise<ModelResponse>;
  validate: (response: ModelResponse) => T;
  record?: (attempt: InferenceAttempt) => Promise<void>;
}): Promise<{ value: T; response: ModelResponse; candidate: ModelCandidate; attempts: InferenceAttempt[]; monetaryCostUsd: number; shadowCostUsd: number }> {
  const start = Date.now();
  const attempts: InferenceAttempt[] = [];
  let monetaryCostUsd = 0, shadowCostUsd = 0;
  let last: InferenceError = new InferenceError("No compatible candidates are available.", "NO_CANDIDATES");
  const limit = input.maxCandidates ?? 3;
  const candidates = input.candidates.slice(0, limit);
  // Reserve one bounded fallback slot for eligible local compute, rather than letting
  // a long stale remote catalog prevent the installed models from ever being tried.
  const local = input.candidates.find((candidate) => candidate.local);
  if (limit > 1 && local && !candidates.includes(local)) candidates[candidates.length - 1] = local;
  for (const candidate of candidates) {
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
      Object.assign(attempt, { status: "FAILED", failureClass: last.failureClass, httpStatus: last.httpStatus, error: last.message, responseBody: last.responseBody });
    } finally {
      if (timer) clearTimeout(timer);
      attempt.completedAt = new Date().toISOString();
      attempt.latencyMs = Date.now() - Date.parse(attempt.startedAt);
      await input.record?.(redactSecrets(attempt) as InferenceAttempt);
    }
  }
  throw last;
}
