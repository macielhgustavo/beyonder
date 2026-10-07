import type { AppConfig } from "../config/env.js";
import type { IntelligenceTask, TaskOutcome } from "../intelligence/contracts.js";
import type { EconomicState, ModelMessage, ModelResponse } from "../types.js";
import { getProvider, providerFetch as fetch } from "@beyonder/compute";
import { redactSecrets } from "@beyonder/tools";
import { AdaptiveModelSelector, type AdaptiveSelectorOptions } from "./adaptive-selector.js";
import type { ModelCandidate, RouteDecision, RouterTelemetry } from "./adaptive-types.js";
import { EmptyPerformanceRepository, type PerformanceRepository } from "./performance-repository.js";
import { completionEnvelopeFailure, httpFailure, InferenceError, type InferenceAttempt } from "./inference.js";
import type { StateStore } from "../memory/state-store.js";
import { OperationalHealthStore } from "./operational-health.js";

export interface ModelRouterOptions extends AdaptiveSelectorOptions {
  state?: StateStore;
  performanceRepository?: PerformanceRepository;
  telemetry?: RouterTelemetry;
}

export class ModelRouter {
  private readonly selector: AdaptiveModelSelector;
  private readonly performance: PerformanceRepository;
  readonly operationalHealth: OperationalHealthStore;

  constructor(
    private readonly config: AppConfig["model"],
    private readonly options: ModelRouterOptions = {}
  ) {
    this.performance = options.performanceRepository ?? new EmptyPerformanceRepository();
    this.operationalHealth = new OperationalHealthStore(options.state);
    this.selector = new AdaptiveModelSelector(config.providerStatePath, { ...options, operationalHealth: (provider, model) => this.operationalHealth.get(provider, model), canAttempt: (candidate) => this.canAttempt(candidate), ollamaBaseUrl: config.ollamaBaseUrl, performanceRepository: this.performance });
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
    const repaired = await this.operationalHealth.reclassifyLegacyProviderCooldown(candidate.provider);
    if (repaired) await this.options.telemetry?.record("info", "router.cooldown_scope_repaired", { provider: candidate.provider, ...repaired, evidenceSource: "persisted-original-provider-response" });
    const deadline = await this.operationalHealth.reclassifyLegacyModelDeadline(candidate.provider, candidate.model);
    if (deadline) await this.options.telemetry?.record("info", "router.cooldown_deadline_repaired", { provider: candidate.provider, model: candidate.model, ...deadline, evidenceSource: "persisted-original-rate-limit-reset" });
    let cooldown = await this.operationalHealth.blocked(candidate.provider, candidate.model);
    if (cooldown?.scope === "provider" && cooldown.reason === "AUTH_REQUIRED" && getProvider(candidate.provider)?.authType === "keyless") {
      // A real, newer successful keyless inference disproves an old gateway-
      // wide auth block. This never clears rate/quota cooldowns or uses a mere
      // public catalog response as proof of inference access.
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
    // Explicit local configuration describes discovery, not permission to bypass
    // the mission floor or displace suitable free cloud capacity.
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
      return {
        content: "No paid or remote model configured. Continue with deterministic local policy.",
        provider: "none",
        model: "none",
        estimatedCostUsd: 0
      };
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
    if (candidate.provider === "ollama") return this.completeWithOllama(messages, candidate.model, signal, schema ?? "json");
    if (this.config.provider === "auto" || this.config.provider === "ollama") return this.completeAutoCandidate(messages, candidate, signal, true);
    return this.completeForPlanningCandidate(messages, candidate, signal);
  }

  async quotas() {
    return this.selector.quotas();
  }

  async performanceFor(provider: string, model: string, taskType: IntelligenceTask["type"]) {
    return this.selector.performanceFor(provider, model, taskType);
  }

  async recordOutcome(outcome: TaskOutcome): Promise<void> {
    await this.performance.outcomeRecorded?.(outcome);
    const provider = outcome.provider ?? outcome.attempts.at(-1)?.provider ?? "none";
    const model = outcome.model ?? outcome.attempts.at(-1)?.model ?? "none";
    if (provider === "none" || model === "none") return;
    const performance = await this.performance.get(provider, model, outcome.task.type);
    await this.options.telemetry?.record("info", "performance.updated", {
      taskId: outcome.task.id,
      provider,
      model,
      taskType: outcome.task.type,
      performance
    });
  }

  private async directRoute(task: IntelligenceTask, economicState: EconomicState): Promise<RouteDecision> {
    return { task, economicState, candidates: [], explored: false, capacityStatus: "NEEDS_CAPABILITY", reason: "Explicit endpoint has UNKNOWN_COST; no zero-cost evidence." };
  }

  private async completeWithOllama(messages: ModelMessage[], model = this.config.name, signal?: AbortSignal, format?: "json" | Record<string, unknown>): Promise<ModelResponse> {
    const deadline = signal ?? AbortSignal.timeout(30_000);
    const response = await fetch(`${this.config.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: deadline,
      body: JSON.stringify({ model, messages, stream: false, think: false, ...(format ? { format } : {}), options: { temperature: 0, num_predict: format ? 180 : 1200 } })
    });
    if (!response.ok) throw httpFailure(response.status, await response.text(), response.headers);
    const json = (await response.json()) as { message?: { content?: string; tool_calls?: unknown[] } };
    if (json.message?.tool_calls?.length) throw new InferenceError("Model returned unsolicited native tool calls while tools are disabled; no tool was executed.", "INVALID_OUTPUT");
    return { content: json.message?.content ?? "", provider: "ollama", model, estimatedCostUsd: 0, raw: json };
  }

  private async completeWithOpenAiCompatible(messages: ModelMessage[]): Promise<ModelResponse> {
    if (!this.config.openAiCompatBaseUrl || !this.config.openAiCompatApiKey) {
      throw new Error("OpenAI-compatible provider requires base URL and API key.");
    }
    const response = await fetch(`${this.config.openAiCompatBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.config.openAiCompatApiKey}` },
      body: JSON.stringify({ model: this.config.name, messages })
    });
    if (!response.ok) throw new Error(`OpenAI-compatible request failed: ${response.status} ${await response.text()}`);
    const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return { content: json.choices?.[0]?.message?.content ?? "", provider: "openai-compatible", model: this.config.name, estimatedCostUsd: 0, raw: json };
  }

  private async completeAutoCandidate(messages: ModelMessage[], candidate: ModelCandidate, signal?: AbortSignal, structured = false): Promise<ModelResponse> {
    if (candidate.provider === "ollama") return this.completeWithOllama(messages, candidate.model, signal);
    const provider = getProvider(candidate.provider);
    if (!provider?.openAiCompatibleEndpoint) throw new Error(`Provider ${candidate.provider} has no compatible completion endpoint.`);
    const apiKey = provider.credentialEnvVars.filter((name) => !name.endsWith("ACCOUNT_ID")).map((name) => process.env[name]).find((value) => Boolean(value));
    if (provider.authType !== "keyless" && !apiKey) throw new InferenceError(`Provider ${candidate.provider} credential is unavailable.`, "AUTH_REQUIRED");
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (provider.openAiCompatibleEndpoint.includes("{account_id}") && !accountId) throw new InferenceError("Provider account configuration is unavailable.", "AUTH_REQUIRED");
    const endpoint = provider.openAiCompatibleEndpoint.replace("{account_id}", encodeURIComponent(accountId ?? ""));
    const controller = new AbortController();
    // Live evidence-bearing synthesis completed correctly in 36.9s on an
    // otherwise qualified free reasoning model. Keep a bounded per-request
    // allowance for that profile; the enclosing mission deadline still wins.
    const timer = setTimeout(() => controller.abort(), candidate.capabilities?.includes("reasoning-control") ? 45_000 : 20_000);
    try {
      const response = await fetch(`${endpoint.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
        },
        signal: AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]),
        // A catalog declaration is not proof that native JSON mode was evaluated.
        // Keep the observed BIB request mode instead of silently changing the
        // inference profile used to establish structured-output capability.
        body: JSON.stringify({ model: candidate.model, messages, temperature: 0, max_tokens: 2400, stream: false, ...(candidate.capabilities?.includes("reasoning-control") ? { reasoning: candidate.inferenceProfile === "reasoning-disabled:max-output-2400" && candidate.benchmarkCapability?.inferenceProfile === candidate.inferenceProfile ? { enabled: false } : { effort: "low" } } : {}), ...(structured && (candidate.benchmarkCapability?.structuredOutputMode ?? candidate.structuredOutput) === "native" ? { response_format: { type: "json_object" } } : {}) })
      });
      if (!response.ok) throw httpFailure(response.status, (await response.text()).replaceAll(apiKey || "\u0000", "[REDACTED]"), response.headers);
      const json = await response.json() as { error?: unknown; model?: string; provider?: string; choices?: Array<{ finish_reason?: string; message?: { content?: string; tool_calls?: unknown[]; function_call?: unknown; provider_metadata?: { gateway?: { routing?: { resolvedProvider?: string; totalProviderAttemptCount?: number } } } } }>; usage?: { total_tokens?: number; cost?: number | string } };
      const completion = json.choices?.[0];
      // An HTTP 200 can still carry a gateway error or a truncated/empty
      // completion. Preserve a bounded, redacted diagnostic, without storing
      // hidden reasoning, so an operator can distinguish these failure modes.
      const diagnostic = () => JSON.stringify(redactSecrets({ model: json.model, error: json.error, usage: json.usage, finishReason: completion?.finish_reason, content: typeof completion?.message?.content === "string" ? completion.message.content.slice(0, 500) : undefined })).slice(0, 1500);
      if (json.error) throw completionEnvelopeFailure(json.error, response.status, response.headers);
      if (completion?.finish_reason === "length") throw new InferenceError("Completion exhausted its output budget before finishing.", "INVALID_OUTPUT", response.status, diagnostic());
      if (!completion?.message || typeof completion.message.content !== "string" || !completion.message.content.trim()) throw new InferenceError("Provider returned an empty or invalid completion envelope.", "INVALID_OUTPUT", response.status, diagnostic());
      if (json.choices?.[0]?.message?.tool_calls?.length || json.choices?.[0]?.message?.function_call) throw new InferenceError("Model returned unsolicited native tool calls while tools are disabled; no tool was executed.", "INVALID_OUTPUT");
      return {
        content: json.choices?.[0]?.message?.content ?? "",
        provider: candidate.provider,
        model: candidate.model,
        estimatedCostUsd: json.usage?.cost === undefined ? 0 : Number(json.usage.cost),
        attribution: { requestedModel: candidate.model, reportedModel: json.model, upstreamProvider: json.provider ?? json.choices?.[0]?.message?.provider_metadata?.gateway?.routing?.resolvedProvider, upstreamAttemptCount: json.choices?.[0]?.message?.provider_metadata?.gateway?.routing?.totalProviderAttemptCount },
        raw: { usage: json.usage }
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
