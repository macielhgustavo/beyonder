import type { AppConfig } from "../config/env.js";
import type { IntelligenceTask, TaskOutcome } from "../intelligence/contracts.js";
import type { EconomicState, ModelMessage, ModelResponse } from "../types.js";
import { getProvider, CredentialBroker, providerFetch as fetch, AutopilotStateStore, buildComputeInventory, resolveZeroCostExecution, readAccountCostEvidence, requireZeroCostDecision, isLocalZeroCostEndpoint, type ZeroCostDecision } from "@beyonder/compute";
import { redactSecrets } from "@beyonder/tools";
import { AdaptiveModelSelector, type AdaptiveSelectorOptions } from "./adaptive-selector.js";
import type { ModelCandidate, RouteDecision, RouterTelemetry } from "./adaptive-types.js";
import { EmptyPerformanceRepository, type PerformanceRepository } from "./performance-repository.js";
import { completionEnvelopeFailure, httpFailure, InferenceError, type InferenceAttempt } from "./inference.js";
import type { StateStore } from "../memory/state-store.js";
import { OperationalHealthStore } from "./operational-health.js";
import { AutopilotQuotaSource } from './quota.js';
import { discoverOllama } from './ollama-discovery.js';

export interface ModelRouterOptions extends AdaptiveSelectorOptions {
  credentials?: CredentialBroker;
  state?: StateStore;
  performanceRepository?: PerformanceRepository;
  telemetry?: RouterTelemetry;
}

export class ModelRouter {
  private readonly economicStops = new Set<string>();
  private readonly credentials: CredentialBroker;
  private readonly selector: AdaptiveModelSelector;
  private readonly performance: PerformanceRepository;
  readonly operationalHealth: OperationalHealthStore;

  constructor(
    private readonly config: AppConfig["model"],
    private readonly options: ModelRouterOptions = {}
  ) {
    this.credentials = options.credentials ?? new CredentialBroker({}, { ...process.env, ...(config.openAiCompatApiKey ? { OPENAI_COMPAT_API_KEY: config.openAiCompatApiKey } : {}) }, { providerStatePath: config.providerStatePath });
    this.performance = options.performanceRepository ?? new EmptyPerformanceRepository();
    this.operationalHealth = new OperationalHealthStore(options.state);
    this.selector = new AdaptiveModelSelector(config.providerStatePath, { ...options, credentialAccess: async provider => getProvider(provider) ? (await this.credentials.resolve(provider)).descriptor : undefined, operationalHealth: (provider, model) => this.operationalHealth.get(provider, model), canAttempt: (candidate) => this.canAttempt(candidate), ollamaBaseUrl: config.ollamaBaseUrl, performanceRepository: this.performance });
  }

  async recordAttempt(attempt: InferenceAttempt): Promise<void> {
    let duplicate = false;
    await this.options.state?.update<InferenceAttempt[]>(`task-attempts:${attempt.taskId}`, [], (previous) => {
      if (previous.some((item) => item.id === attempt.id && item.status !== "STARTED")) { duplicate = true; return previous; }
      return [...previous.filter((item) => item.id !== attempt.id), attempt];
    });
    if (duplicate) return;
    if (attempt.status === "STARTED" && attempt.provider === "ollama") {
      await this.options.telemetry?.record("warn", "router.capacity_reduced", { taskId: attempt.taskId, phase: attempt.phase, attemptId: attempt.id, computeTier: "LOCAL_EMERGENCY", selected: `ollama/${attempt.model}`, reason: "Qualified local emergency attempt after cloud capacity could not serve this phase." });
    }
    await this.options.telemetry?.record(attempt.status === "FAILED" ? "warn" : "info", `inference.${attempt.status.toLowerCase()}`, { ...attempt });
    await this.operationalHealth.record(attempt);
  }

  async canAttempt(candidate: Pick<ModelCandidate, "provider" | "model">): Promise<boolean> {
    if (this.economicStops.has(candidate.provider)) return false;
    if (await this.options.state?.get<boolean>(`economic-stop:${candidate.provider}`, false)) return false;
    if (getProvider(candidate.provider)) { const credential = (await this.credentials.resolve(candidate.provider)).descriptor; if (!credential.accessible || credential.valid === false) return false; }
    const repaired = await this.operationalHealth.reclassifyLegacyProviderCooldown(candidate.provider);
    if (repaired) await this.options.telemetry?.record("info", "router.cooldown_scope_repaired", { provider: candidate.provider, ...repaired, evidenceSource: "persisted-original-provider-response" });
    const deadline = await this.operationalHealth.reclassifyLegacyModelDeadline(candidate.provider, candidate.model);
    if (deadline) await this.options.telemetry?.record("info", "router.cooldown_deadline_repaired", { provider: candidate.provider, model: candidate.model, ...deadline, evidenceSource: "persisted-original-rate-limit-reset" });
    let cooldown = await this.operationalHealth.blocked(candidate.provider, candidate.model);
    if (cooldown?.scope === "provider" && cooldown.reason === "AUTH_REQUIRED" && getProvider(candidate.provider)?.authType === "keyless") {
      const health = await this.operationalHealth.get(candidate.provider);
      const evidence = await this.options.capabilitySource?.getLastSuccessfulRequest?.(candidate.provider);
      const provenAt = Date.parse(evidence?.observedAt ?? "");
      if (Number.isFinite(provenAt) && provenAt > Date.parse(health.lastFailureAt ?? "") && provenAt <= Date.now()) {
        await this.operationalHealth.credentialValidated(candidate.provider);
        await this.options.telemetry?.record("info", "router.authentication_recovered", { provider: candidate.provider, model: evidence!.model, evidenceSource: "real-BIB-inference", observedAt: evidence!.observedAt });
        cooldown = await this.operationalHealth.blocked(candidate.provider, candidate.model);
      }
    }
    if (cooldown) await this.options.telemetry?.record("info", "router.candidate_deferred", { provider: candidate.provider, model: candidate.model, ...cooldown });
    return !cooldown;
  }

  async attemptsFor(taskId: string): Promise<InferenceAttempt[]> {
    return this.options.state?.get<InferenceAttempt[]>(`task-attempts:${taskId}`, []) ?? [];
  }

  async route(task: IntelligenceTask, economicState: EconomicState): Promise<RouteDecision> {
    if (this.config.provider === "auto" || this.config.provider === "ollama") return this.selector.route(task, economicState);
    if (this.config.provider === "none" || economicState === "halted") {
      return {
        task,
        economicState,
        candidates: [],
        explored: false,
        reason: economicState === "halted" ? "economic state halted blocks normal inference" : "model provider is disabled"
      };
    }
    return this.directRoute(task, economicState);
  }

  async complete(messages: ModelMessage[]): Promise<ModelResponse> {
    if (this.config.provider === "auto") {
      throw new InferenceError("Auto inference requires an explicit task route and bounded candidate execution.", "INVALID_ACTION");
    }
    if (this.config.provider === "none") {
      return { content: "No paid or remote model configured. Continue with deterministic local policy.", provider: "none", model: "none", estimatedCostUsd: 0 };
    }
    if (this.config.provider === "ollama") return this.completeWithOllama(messages);
    return this.completeWithOpenAiCompatible(messages);
  }

  async completeForCandidate(messages: ModelMessage[], candidate: ModelCandidate): Promise<ModelResponse> {
    if (this.config.provider === "auto" || this.config.provider === "ollama") return this.completeAutoCandidate(messages, candidate);
    if (this.config.provider === "openai-compatible") return this.completeWithOpenAiCompatible(messages);
    if (this.config.provider === "none") return this.complete(messages);
    throw new InferenceError("No compatible inference provider configured.", "NO_CANDIDATES");
  }

  async completeForPlanningCandidate(messages: ModelMessage[], candidate: ModelCandidate, signal?: AbortSignal): Promise<ModelResponse> {
    if (this.config.provider === "auto" || this.config.provider === "ollama") return this.completeAutoCandidate(messages, candidate, signal);
    return this.completeForCandidate(messages, candidate);
  }

  async completeForStructuredCandidate(messages: ModelMessage[], candidate: ModelCandidate, signal?: AbortSignal, schema?: Record<string, unknown>): Promise<ModelResponse> {
    if (candidate.provider === "ollama") { await this.assertZeroCost(candidate); return this.completeWithOllama(messages, candidate.model, signal, schema ?? "json"); }
    if (this.config.provider === "auto" || this.config.provider === "ollama") return this.completeAutoCandidate(messages, candidate, signal, true);
    return this.completeForPlanningCandidate(messages, candidate, signal);
  }

  async quotas() { return this.selector.quotas(); }
  async performanceFor(provider: string, model: string, taskType: IntelligenceTask["type"]) { return this.selector.performanceFor(provider, model, taskType); }

  async economicDecision(providerId: string, model: string): Promise<ZeroCostDecision> {
    const state = await new AutopilotStateStore(this.config.providerStatePath).read();
    const provider = getProvider(providerId);
    const metadata = buildComputeInventory(state).find(e => e.providerId === providerId)?.modelMetadata.find(m => m.id === model) ?? { id: model, capabilities: [], costClass: 'UNKNOWN_COST' as const };
    const credential = provider ? (await this.credentials.resolve(providerId)).descriptor : undefined;
    const quota = await (this.options.quotaSource ?? new AutopilotQuotaSource(this.config.providerStatePath)).get(providerId, model);
    const observed = resolveZeroCostExecution({ provider: provider ?? { id: 'ollama', openAiCompatibleEndpoint: providerId === 'ollama' ? this.config.ollamaBaseUrl : undefined }, model: metadata, credential, quota, accountEvidence: (await readAccountCostEvidence()).find(e => e.provider === providerId && e.model === model) });
    const supplied = await this.options.economicEvidence?.(providerId, model);
    if (supplied && !['FREE_QUOTA_EXHAUSTED', 'PAID', 'BILLING_RISK'].includes(observed.classification)) return supplied;
    return observed;
  }

  private async assertZeroCost(candidate: Pick<ModelCandidate, 'provider' | 'model'>): Promise<ZeroCostDecision> {
    const decision = await this.economicDecision(candidate.provider, candidate.model);
    await this.options.telemetry?.record('info', 'economic.zero_cost_guarantee', { ...decision });
    try { requireZeroCostDecision(decision, candidate.provider, candidate.model); }
    catch { await this.options.telemetry?.record('warn', 'router.candidate_rejected_cost', { ...decision }); throw new InferenceError(decision.reason, 'ECONOMIC_POLICY_BLOCKED'); }
    if (!await this.canAttempt(candidate)) throw new InferenceError('Credential or operational cooldown prevents this attempt.', 'NEEDS_CAPABILITY');
    return decision;
  }

  async completeForZeroCostSmoke(messages: ModelMessage[], candidate: ModelCandidate): Promise<ModelResponse> {
    // 32 tokens is too small for a dynamic free router that may land on a
    // reasoning model. Keep the probe bounded, but large enough to distinguish
    // real operational failure from a locally manufactured truncation error.
    return this.completeAutoCandidate(messages, candidate, undefined, false, 512);
  }

  async recordOutcome(outcome: TaskOutcome): Promise<void> {
    await this.performance.outcomeRecorded?.(outcome);
    const provider = outcome.provider ?? outcome.attempts.at(-1)?.provider ?? "none";
    const model = outcome.model ?? outcome.attempts.at(-1)?.model ?? "none";
    if (provider === "none" || model === "none") return;
    const performance = await this.performance.get(provider, model, outcome.task.type);
    await this.options.telemetry?.record("info", "performance.updated", { taskId: outcome.task.id, provider, model, taskType: outcome.task.type, performance });
  }

  private async directRoute(task: IntelligenceTask, economicState: EconomicState): Promise<RouteDecision> {
    return { task, economicState, candidates: [], explored: false, capacityStatus: "NEEDS_CAPABILITY", reason: "Explicit endpoint has UNKNOWN_COST; no zero-cost evidence." };
  }

  private async completeWithOllama(messages: ModelMessage[], model = this.config.name, signal?: AbortSignal, format?: "json" | Record<string, unknown>): Promise<ModelResponse> {
    if (!isLocalZeroCostEndpoint(this.config.ollamaBaseUrl) || /(?:[:/-]cloud)$/i.test(model)) throw new InferenceError('Remote/local-cloud inference has no zero-cost guarantee.', 'ECONOMIC_POLICY_BLOCKED');
    if (!(await discoverOllama(this.config.ollamaBaseUrl)).some(entry => entry.models.includes(model))) throw new InferenceError('Local model execution not proven; remote proxy metadata or unavailable local model.', 'ECONOMIC_POLICY_BLOCKED');
    const deadline = signal ?? AbortSignal.timeout(30_000);
    const response = await fetch(`${this.config.ollamaBaseUrl}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, signal: deadline, redirect: 'error', body: JSON.stringify({ model, messages, stream: false, think: false, ...(format ? { format } : {}), options: { temperature: 0, num_predict: format ? 180 : 1200 } }) });
    if (!response.ok) throw httpFailure(response.status, await response.text(), response.headers);
    const json = (await response.json()) as { message?: { content?: string; tool_calls?: unknown[] } };
    if (json.message?.tool_calls?.length) throw new InferenceError("Model returned unsolicited native tool calls while tools are disabled; no tool was executed.", "INVALID_OUTPUT");
    return { content: json.message?.content ?? "", provider: "ollama", model, estimatedCostUsd: 0, raw: json };
  }

  private async completeWithOpenAiCompatible(messages: ModelMessage[]): Promise<ModelResponse> {
    throw new InferenceError('Explicit endpoint has UNKNOWN_COST; direct completion cannot bypass the economic gate.', 'ECONOMIC_POLICY_BLOCKED');
  }

  private async completeAutoCandidate(messages: ModelMessage[], candidate: ModelCandidate, signal?: AbortSignal, structured = false, maxOutputTokens = 2400): Promise<ModelResponse> {
    const economics = await this.assertZeroCost(candidate);
    if (candidate.provider === "ollama") return this.completeWithOllama(messages, candidate.model, signal);
    const provider = getProvider(candidate.provider);
    if (!provider?.openAiCompatibleEndpoint) throw new Error(`Provider ${candidate.provider} has no compatible completion endpoint.`);
    const credential = await this.credentials.resolve(provider.id);
    if (!credential.descriptor.accessible || credential.descriptor.valid === false) throw new InferenceError(credential.descriptor.status, 'AUTH_REQUIRED');
    const apiKey = credential.apiKey();
    const accountId = credential.get('CLOUDFLARE_ACCOUNT_ID');
    if (provider.openAiCompatibleEndpoint.includes("{account_id}") && !accountId) throw new InferenceError("Provider account configuration is unavailable.", "AUTH_REQUIRED");
    const endpoint = provider.openAiCompatibleEndpoint.replace("{account_id}", encodeURIComponent(accountId ?? ""));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), candidate.capabilities?.includes("reasoning-control") ? 45_000 : 20_000);
    try {
      const response = await fetch(`${endpoint.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        signal: AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]),
        redirect: 'error',
        body: JSON.stringify({ model: candidate.model, messages, temperature: 0, max_tokens: maxOutputTokens, stream: false, ...(candidate.provider === 'openrouter' ? { provider: { max_price: { prompt: 0, completion: 0 }, allow_fallbacks: true } } : candidate.provider === 'kilo-gateway' ? { provider: { max_price: { prompt: 0, completion: 0 }, allow_fallbacks: false } } : {}), ...(candidate.capabilities?.includes("reasoning-control") ? { reasoning: candidate.inferenceProfile === "reasoning-disabled:max-output-2400" && candidate.benchmarkCapability?.inferenceProfile === candidate.inferenceProfile ? { enabled: false } : { effort: "low" } } : {}), ...(structured && (candidate.benchmarkCapability?.structuredOutputMode ?? candidate.structuredOutput) === "native" ? { response_format: { type: "json_object" } } : {}) })
      });
      if (!response.ok) throw httpFailure(response.status, (await response.text()).replaceAll(apiKey || "\u0000", "[REDACTED]"), response.headers);
      const json = await response.json() as { error?: unknown; model?: string; provider?: string; choices?: Array<{ finish_reason?: string; message?: { content?: string; tool_calls?: unknown[]; function_call?: unknown; provider_metadata?: { gateway?: { routing?: { resolvedProvider?: string; totalProviderAttemptCount?: number } } } } }>; usage?: { total_tokens?: number; cost?: number | string } };
      const completion = json.choices?.[0];
      const reportedCost = json.usage?.cost;
      const cost = reportedCost === undefined && economics.zeroCostExecutionGuaranteed ? 0 : typeof reportedCost === 'number' || typeof reportedCost === 'string' && reportedCost.trim() ? Number(reportedCost) : undefined;
      if (cost === undefined || !Number.isFinite(cost) || cost !== 0) {
        this.economicStops.add(candidate.provider);
        await this.options.telemetry?.record('error', 'economic.zero_cost_violation', { provider: candidate.provider, model: candidate.model, reportedCostUsd: Number.isFinite(cost) ? cost : 'UNKNOWN' });
        await this.options.state?.set(`economic-stop:${candidate.provider}`, true);
        throw new InferenceError('Provider contradicted zero-cost evidence; execution stopped.', 'ECONOMIC_POLICY_BLOCKED', response.status, undefined, undefined, undefined, undefined, cost !== undefined && Number.isFinite(cost) && cost > 0 ? cost : undefined);
      }
      const diagnostic = () => JSON.stringify(redactSecrets({ model: json.model, error: json.error, usage: json.usage, finishReason: completion?.finish_reason, content: typeof completion?.message?.content === "string" ? completion.message.content.slice(0, 500) : undefined })).slice(0, 1500);
      if (json.error) throw completionEnvelopeFailure(json.error, response.status, response.headers);
      if (completion?.finish_reason === "length") throw new InferenceError("Completion exhausted its output budget before finishing.", "INVALID_OUTPUT", response.status, diagnostic());
      if (!completion?.message || typeof completion.message.content !== "string" || !completion.message.content.trim()) throw new InferenceError("Provider returned an empty or invalid completion envelope.", "INVALID_OUTPUT", response.status, diagnostic());
      if (json.choices?.[0]?.message?.tool_calls?.length || json.choices?.[0]?.message?.function_call) throw new InferenceError("Model returned unsolicited native tool calls while tools are disabled; no tool was executed.", "INVALID_OUTPUT");
      return {
        content: credential.redact(json.choices?.[0]?.message?.content ?? ""), provider: candidate.provider, model: candidate.model, estimatedCostUsd: cost,
        attribution: { requestedModel: candidate.model, reportedModel: typeof json.model === 'string' ? credential.redact(json.model) : undefined, upstreamProvider: typeof json.provider === 'string' ? credential.redact(json.provider) : undefined, upstreamAttemptCount: json.choices?.[0]?.message?.provider_metadata?.gateway?.routing?.totalProviderAttemptCount }, raw: { usage: json.usage }
      };
    } catch (error) {
      if (error instanceof InferenceError) throw new InferenceError(credential.redact(error.message), error.failureClass, error.httpStatus, error.responseBody ? credential.redact(error.responseBody) : undefined, error.retryAfterAt, error.failureScope, error.upstreamHttpStatus, error.reportedMonetaryCostUsd);
      throw new InferenceError('Provider request failed (network, timeout or malformed response).', signal?.aborted || controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR');
    } finally { clearTimeout(timer); }
  }
}
