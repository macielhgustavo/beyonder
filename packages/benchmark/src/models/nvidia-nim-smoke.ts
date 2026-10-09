import { fileURLToPath } from "node:url";
import { getProvider, CredentialBroker, eligibleModelsForWorkload, resolveZeroCostExecution, modelMetadata, requireZeroCostDecision, declaredProviderAccountPlan, type ZeroCostDecision } from "@beyonder/compute";

export const NVIDIA_NIM_SMOKE_PROMPT = "Return exactly: BEYONDER_NVIDIA_OK";
export const NVIDIA_NIM_SMOKE_EXPECTED = "BEYONDER_NVIDIA_OK";

export type NvidiaNimSmokeStatus =
  | "PASS"
  | "RESPONSE_MISMATCH"
  | "RATE_LIMITED"
  | "AUTH_ERROR"
  | "QUOTA_EXHAUSTED"
  | "BILLING_REQUIRED"
  | "MODEL_UNAVAILABLE"
  | "UNSUPPORTED"
  | "TIMEOUT"
  | "PROVIDER_ERROR";

export interface NvidiaNimSmokeAttempt {
  model: string;
  status: NvidiaNimSmokeStatus;
  httpStatus?: number;
  errorCode?: string;
  failureReason?: string;
}

export interface NvidiaNimSmokeResult {
  ok: boolean;
  model?: string;
  catalogModelCount: number;
  chatCandidateCount: number;
  testedCandidates: number;
  attempts: NvidiaNimSmokeAttempt[];
  catalogFailure?: Omit<NvidiaNimSmokeAttempt, "model">;
  monetaryCostUsd: number | 'UNKNOWN';
}

interface NvidiaNimSmokeOptions {
  economicEvidence?: (model: string) => Promise<ZeroCostDecision>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxCandidates?: number;
}

export async function runNvidiaNimSmoke(
  apiKey: string,
  options: NvidiaNimSmokeOptions = {}
): Promise<NvidiaNimSmokeResult> {
  const provider = getProvider("nvidia-nim");
  if (!provider?.openAiCompatibleEndpoint) throw new Error("NVIDIA NIM provider endpoint is not configured.");
  if (!apiKey) throw new Error("NVIDIA_NIM_API_KEY is required.");

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxCandidates = Math.min(3, options.maxCandidates ?? 1);
  const baseUrl = provider.openAiCompatibleEndpoint.replace(/\/$/, "");

  const catalogResponse = await timedFetch(fetchImpl, `${baseUrl}/models`, {
    headers: { authorization: `Bearer ${apiKey}` }
  }, timeoutMs).catch((error) => error);

  if (catalogResponse instanceof Error) {
    return emptyFailure(classifyThrownError(catalogResponse));
  }
  if (!catalogResponse.ok) {
    const failure = await classifyHttpFailure(catalogResponse);
    return emptyFailure(failure);
  }

  const models = await extractModelIds(catalogResponse);
  const candidates = eligibleModelsForWorkload(provider, models, "benchmark_text")
    .sort((left, right) => candidatePriority(right) - candidatePriority(left))
    .slice(0, maxCandidates);
  const attempts: NvidiaNimSmokeAttempt[] = [];

  for (const model of candidates) {
    const economics = await options.economicEvidence?.(model) ?? resolveZeroCostExecution({ provider, model: modelMetadata(provider, model), accountPlan: declaredProviderAccountPlan(provider.id, apiKey), usageContext: 'DEV_EVAL' });
    try { requireZeroCostDecision(economics, provider.id, model); }
    catch { continue; } // Auth/catalog existence is not monetary authorization.
    try {
      const response = await timedFetch(fetchImpl, `${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: NVIDIA_NIM_SMOKE_PROMPT }],
          temperature: 0,
          max_tokens: 32,
          stream: false
        })
      }, timeoutMs);

      if (!response.ok) {
        attempts.push({ model, ...(await classifyHttpFailure(response)) });
        continue;
      }

      const content = await extractCompletionContent(response);
      if (content.trim() === NVIDIA_NIM_SMOKE_EXPECTED) {
        attempts.push({ model, status: "PASS" });
        return {
          ok: true,
          model,
          catalogModelCount: models.length,
          chatCandidateCount: candidates.length,
          testedCandidates: attempts.length,
          attempts,
          monetaryCostUsd: 0
        };
      }

      attempts.push({
        model,
        status: "RESPONSE_MISMATCH",
      failureReason: 'Response did not match the operational smoke expectation.'
      });
    } catch (error) {
      if (error instanceof SmokeBillingViolation) return { ok: false, catalogModelCount: models.length, chatCandidateCount: candidates.length, testedCandidates: attempts.length + 1, attempts: [...attempts, { model, status: 'BILLING_REQUIRED', errorCode: 'ZERO_COST_EVIDENCE_CONTRADICTED' }], monetaryCostUsd: error.cost };
      attempts.push({ model, ...classifyThrownError(error) });
    }
  }

  return {
    ok: false,
    catalogModelCount: models.length,
    chatCandidateCount: candidates.length,
    testedCandidates: attempts.length,
    attempts,
    catalogFailure: candidates.length
      ? attempts.length ? undefined : { status: 'BILLING_REQUIRED', errorCode: 'ZERO_COST_EXECUTION_NOT_GUARANTEED', failureReason: 'Catalog/auth valid does not prove free quota or no paid spillover; no inference executed.' }
      : {
          status: "MODEL_UNAVAILABLE",
          errorCode: "NO_CHAT_CANDIDATES",
          failureReason: `Authenticated NVIDIA catalog returned ${models.length} models, but none were eligible for chat/instruct smoke testing.`
        },
    monetaryCostUsd: 0
  };
}

async function extractModelIds(response: Response): Promise<string[]> {
  const body = await response.json() as { data?: Array<{ id?: unknown }> };
  const ids = (body.data ?? [])
    .map((entry) => typeof entry?.id === "string" ? entry.id : undefined)
    .filter((id): id is string => Boolean(id));
  return [...new Set(ids)];
}

async function extractCompletionContent(response: Response): Promise<string> {
  const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }>; usage?: { cost?: unknown } };
  if (body.usage?.cost !== undefined && (typeof body.usage.cost !== 'number' || !Number.isFinite(body.usage.cost) || body.usage.cost !== 0)) throw new SmokeBillingViolation(typeof body.usage.cost === 'number' && Number.isFinite(body.usage.cost) && body.usage.cost >= 0 ? body.usage.cost : 'UNKNOWN');
  const content = body.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

class SmokeBillingViolation extends Error {
  constructor(readonly cost: number | 'UNKNOWN') { super('Provider contradicted zero-cost evidence.'); }
}

function candidatePriority(model: string): number {
  const normalized = model.toLowerCase();
  let score = 0;
  if (normalized.includes("instruct")) score += 100;
  if (normalized.includes("chat")) score += 90;
  if (normalized.includes("coder") || normalized.includes("code")) score += 50;
  if (/(llama|qwen|mistral|gemma|nemotron|deepseek|gpt|phi|kimi|command)/.test(normalized)) score += 30;
  if (/(reason|thinking|\br1\b)/.test(normalized)) score -= 20;
  return score;
}

async function timedFetch(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, redirect: 'error', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function classifyHttpFailure(response: Response): Promise<Omit<NvidiaNimSmokeAttempt, "model">> {
  const body = await response.text();
  const metadata = extractErrorMetadata(body);
  const reason = `HTTP ${response.status}${body ? ` ${body.slice(0, 800)}` : ""}`;
  const normalized = body.toLowerCase();

  if (response.status === 401 || response.status === 403) {
    return { status: "AUTH_ERROR", httpStatus: response.status, errorCode: metadata.code, failureReason: reason };
  }
  if (response.status === 402) {
    const status = /quota|credit|depleted|exhaust/.test(normalized) ? "QUOTA_EXHAUSTED" : "BILLING_REQUIRED";
    return { status, httpStatus: response.status, errorCode: metadata.code, failureReason: reason };
  }
  if (response.status === 429) {
    return { status: "RATE_LIMITED", httpStatus: response.status, errorCode: metadata.code, failureReason: reason };
  }
  if (
    response.status === 404 ||
    response.status === 410 ||
    /end[- ]of[- ]life|\beol\b|retired|deprecated|model.{0,32}(unavailable|not available|not found)/.test(normalized)
  ) {
    return { status: "MODEL_UNAVAILABLE", httpStatus: response.status, errorCode: metadata.code, failureReason: reason };
  }
  if (response.status === 400 || response.status === 422) {
    return { status: "UNSUPPORTED", httpStatus: response.status, errorCode: metadata.code, failureReason: reason };
  }
  return { status: "PROVIDER_ERROR", httpStatus: response.status, errorCode: metadata.code, failureReason: reason };
}

function classifyThrownError(error: unknown): Omit<NvidiaNimSmokeAttempt, "model"> {
  if (error instanceof Error && (error.name === "AbortError" || /timed?\s*out|abort/i.test(error.message))) {
    return { status: "TIMEOUT", errorCode: "TIMEOUT", failureReason: error.message || "Request timed out." };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { status: "PROVIDER_ERROR", errorCode: "REQUEST_ERROR", failureReason: message };
}

function extractErrorMetadata(body: string): { code?: string } {
  try {
    const parsed = JSON.parse(body) as {
      error?: { code?: unknown; type?: unknown } | string;
      code?: unknown;
    };
    if (parsed.error && typeof parsed.error === "object") {
      const value = parsed.error.code ?? parsed.error.type;
      if (value != null) return { code: String(value) };
    }
    if (parsed.code != null) return { code: String(parsed.code) };
  } catch {
    // Preserve the raw HTTP body in failureReason when the provider does not return JSON.
  }
  return {};
}

function emptyFailure(failure: Omit<NvidiaNimSmokeAttempt, "model">): NvidiaNimSmokeResult {
  return {
    ok: false,
    catalogModelCount: 0,
    chatCandidateCount: 0,
    testedCandidates: 0,
    attempts: [],
    catalogFailure: failure,
    monetaryCostUsd: 0
  };
}

async function main(): Promise<void> {
  const credential = await new CredentialBroker().resolve('nvidia-nim');
  const apiKey = credential.apiKey();
  if (!apiKey) {
    console.error(JSON.stringify({ ok: false, errorCode: credential.descriptor.status, monetaryCostUsd: 0 }));
    process.exitCode = 2;
    return;
  }
  const maxCandidatesRaw = Number(process.env.NVIDIA_NIM_SMOKE_MAX_CANDIDATES ?? "1");
  const maxCandidates = Number.isFinite(maxCandidatesRaw) && maxCandidatesRaw > 0 ? Math.floor(maxCandidatesRaw) : 1;
  const result = await runNvidiaNimSmoke(apiKey, { maxCandidates });
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}
