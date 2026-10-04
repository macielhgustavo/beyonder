import type { AppConfig } from "../config/env.js";
import type { IntelligenceTask, TaskOutcome } from "../intelligence/contracts.js";
import type { EconomicState, ModelMessage, ModelResponse } from "../types.js";
import { AutopilotStateStore, buildComputeInventory, getProvider, inferRole, isModelMetadataEligibleForWorkload } from "@beyonder/compute";
import { AdaptiveModelSelector, workloadForTask, type AdaptiveSelectorOptions } from "./adaptive-selector.js";
import type { ModelCandidate, QuotaSnapshot, RouteDecision, RouterTelemetry } from "./adaptive-types.js";
import { EmptyPerformanceRepository, type PerformanceRepository } from "./performance-repository.js";
import { ROUTER_CONFIG } from "./router-config.js";
import { ShadowCostCalculator } from "./shadow-cost.js";
import { calculateEffectiveResourceCost, calculateUtility } from "./utility.js";
import { httpFailure, InferenceError, type InferenceAttempt } from "./inference.js";
import type { StateStore } from "../memory/state-store.js";

export interface ModelRouterOptions extends AdaptiveSelectorOptions {
  state?: StateStore;
  performanceRepository?: PerformanceRepository;
  telemetry?: RouterTelemetry;
}

export class ModelRouter {
  private readonly selector: AdaptiveModelSelector;
  private readonly performance: PerformanceRepository;

  constructor(
    private readonly config: AppConfig["model"],
    private readonly options: ModelRouterOptions = {}
  ) {
    this.performance = options.performanceRepository ?? new EmptyPerformanceRepository();
    this.selector = new AdaptiveModelSelector(config.providerStatePath, { ...options, operationalHealth: async (provider, model) => options.state?.get(`model-health:${provider}:${model}`, { samples: 0, failures: 0, latencyMs: 0 }), ollamaBaseUrl: config.ollamaBaseUrl, performanceRepository: this.performance });
  }

  async recordAttempt(attempt: InferenceAttempt): Promise<void> {
    await this.options.state?.update<InferenceAttempt[]>(`task-attempts:${attempt.taskId}`, [], (previous) => [...previous.filter((item) => item.id !== attempt.id), attempt]);
    await this.options.telemetry?.record(attempt.status === "FAILED" ? "warn" : "info", `inference.${attempt.status.toLowerCase()}`, { ...attempt });
    if (attempt.status !== "STARTED" && attempt.phase !== "TOOL_EXECUTION") {
      await this.options.state?.update(`model-health:${attempt.provider}:${attempt.model}`, { samples: 0, failures: 0, latencyMs: 0 }, (health) => ({ samples: health.samples + 1, failures: health.failures + (attempt.status === "FAILED" && !["INVALID_OUTPUT", "INVALID_ACTION"].includes(attempt.failureClass ?? "") ? 1 : 0), latencyMs: (health.latencyMs * health.samples + (attempt.latencyMs ?? 0)) / (health.samples + 1) }));
    }
  }

  async attemptsFor(taskId: string): Promise<InferenceAttempt[]> {
    return this.options.state?.get<InferenceAttempt[]>(`task-attempts:${taskId}`, []) ?? [];
  }

  async route(task: IntelligenceTask, economicState: EconomicState): Promise<RouteDecision> {
    if (this.config.provider === "auto") return this.selector.route(task, economicState);
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
      const selected = await this.selectFreeProvider();
      if (!selected) {
        return {
          content: "No free READY/keyless provider is available. Continue with deterministic local policy.",
          provider: "none",
          model: "none",
          estimatedCostUsd: 0
        };
      }
      return this.syntheticAutoResponse(selected.providerId, selected.model, selected);
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
    if (this.config.provider === "ollama") return this.completeWithOllama(messages);
    if (this.config.provider === "openai-compatible") return this.completeWithOpenAiCompatible(messages);
    if (this.config.provider === "none") return this.complete(messages);
    return this.syntheticAutoResponse(candidate.provider, candidate.model, {
      utility: candidate.utility,
      predictedQuality: candidate.predictedQuality,
      shadowCostUsd: candidate.shadowCostUsd
    });
  }

  async completeForPlanningCandidate(messages: ModelMessage[], candidate: ModelCandidate, signal?: AbortSignal): Promise<ModelResponse> {
    if (this.config.provider === "ollama") return this.completeWithOllama(messages, candidate.model, signal);
    if (this.config.provider === "auto") return this.completeAutoCandidate(messages, candidate, signal);
    return this.completeForCandidate(messages, candidate);
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
    if (this.config.provider !== "ollama") return { task, economicState, candidates: [], explored: false, reason: "Explicit endpoint has UNKNOWN_COST; no zero-cost evidence." };
    if (!isModelMetadataEligibleForWorkload({ id: this.config.name, role: inferRole(this.config.name), capabilities: ["CHAT"] }, workloadForTask(task.type)) || /:cloud$|-cloud$/.test(this.config.name)) return { task, economicState, candidates: [], explored: false, reason: "Configured model is incompatible with this workload or lacks local cost evidence." };
    const performance = await this.performance.get(this.config.provider, this.config.name, task.type);
    const quota: QuotaSnapshot = {
      provider: this.config.provider,
      model: this.config.name,
      requestsPerMinute: "unknown",
      requestsPerDay: "unknown",
      tokensPerMinute: "unknown",
      tokensPerDay: "unknown",
      requestQuotaTotal: "unknown",
      requestQuotaRemaining: "unknown",
      tokenQuotaTotal: "unknown",
      tokenQuotaRemaining: "unknown",
      resetAt: "unknown",
      health: "healthy",
      lastUpdatedAt: "unknown"
    };
    const predictedQuality = performance.samples > 0 ? performance.avgEvaluationScore : ROUTER_CONFIG.qualityClassDefaults.unknown;
    const realScore = performance.samples > 0 ? Math.min(1, Math.max(0, (performance.avgEvaluationScore + performance.successRate) / 2)) : null;
    const failureRisk = performance.samples > 0 ? performance.failures / performance.samples : 0.08;
    const reliability = 1 - failureRisk;
    const latencyPenalty = performance.avgLatencyMs > 0
      ? Math.min(1, performance.avgLatencyMs / ROUTER_CONFIG.costNormalization.latencyReferenceMs)
      : 0;
    const shadowCostUsd = this.config.provider === "ollama"
      ? 0
      : new ShadowCostCalculator().calculate({ quota, economicState, alternativesAvailable: 0 }).shadowCostUsd;
    const effectiveResourceCost = calculateEffectiveResourceCost({
      monetaryCostUsd: 0,
      shadowCostUsd,
      latencyPenalty
    });
    const utility = calculateUtility({
      predictedQuality,
      historicalSuccess: performance.successRate,
      reliability,
      monetaryCostUsd: 0,
      shadowCostUsd,
      latencyPenalty,
      failureRisk
    }, economicState);
    const candidate: ModelCandidate = {
      local: true,
      externalQuotaConsumption: false,
      costClass: "FREE_CONFIRMED",
      provider: this.config.provider,
      model: this.config.name,
      capabilities: ["text"],
      contextWindow: "unknown",
      toolCalling: "unknown",
      predictedQuality,
      historicalSuccess: performance.successRate,
      reliability,
      monetaryCostUsd: 0,
      shadowCostUsd,
      latencyPenalty,
      failureRisk,
      effectiveResourceCost,
      utility,
      quota,
      performance,
      benchmarkCapability: null,
      capabilityEvidence: {
        bibScore: null,
        bibSamples: 0,
        realScore,
        realSamples: performance.samples,
        predictedScore: predictedQuality,
        source: performance.samples > 0 ? "outcomes" : "metadata"
      },
      explanation: {
        positives: [
          { signal: `${task.type} capability`, value: predictedQuality },
          { signal: "historical success", value: performance.successRate },
          { signal: "explicit provider configuration", value: this.config.provider }
        ],
        penalties: [{ signal: "shadow cost", value: shadowCostUsd }],
        constraints: [`economic-state=${economicState}`]
      }
    };
    await this.options.telemetry?.record("info", "router.selected", {
      taskId: task.id,
      provider: candidate.provider,
      model: candidate.model,
      utility: candidate.utility,
      explicitProvider: true
    });
    return {
      task,
      economicState,
      candidates: [candidate],
      selected: candidate,
      explored: false,
      reason: "explicit provider configuration preserved"
    };
  }

  private async selectFreeProvider(): Promise<{ providerId: string; model: string; status: string } | null> {
    const state = await new AutopilotStateStore(this.config.providerStatePath).read();
    const inventory = buildComputeInventory(state)
      .filter((entry) => entry.cost === "$0")
      .filter((entry) => ["healthy", "keyless"].includes(entry.status))
      .sort((a, b) => qualityRank(b.qualityClass) - qualityRank(a.qualityClass));
    const selected = inventory[0];
    if (!selected) return null;
    return {
      providerId: selected.providerId,
      model: selected.models[0] ?? this.config.name,
      status: selected.status
    };
  }

  private syntheticAutoResponse(provider: string, model: string, raw: unknown): ModelResponse {
    return {
      content: `Selected zero-cost provider ${provider} with model ${model} for an economically constrained plan.`,
      provider,
      model,
      estimatedCostUsd: 0,
      raw
    };
  }

  private async completeWithOllama(messages: ModelMessage[], model = this.config.name, signal?: AbortSignal): Promise<ModelResponse> {
    const response = await fetch(`${this.config.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
      body: JSON.stringify({ model, messages, stream: false, think: false, options: { temperature: 0, num_predict: 1200 } })
    });
    if (!response.ok) throw httpFailure(response.status, await response.text());
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

  private async completeAutoCandidate(messages: ModelMessage[], candidate: ModelCandidate, signal?: AbortSignal): Promise<ModelResponse> {
    if (candidate.provider === "ollama") return this.completeWithOllama(messages, candidate.model, signal);
    const provider = getProvider(candidate.provider);
    if (!provider?.openAiCompatibleEndpoint) throw new Error(`Provider ${candidate.provider} has no compatible completion endpoint.`);
    const apiKey = provider.credentialEnvVars.filter((name) => !name.endsWith("ACCOUNT_ID")).map((name) => process.env[name]).find((value) => Boolean(value));
    if (provider.credentialEnvVars.length > 0 && !apiKey) throw new InferenceError(`Provider ${candidate.provider} credential is unavailable.`, "AUTH_REQUIRED");
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (provider.openAiCompatibleEndpoint.includes("{account_id}") && !accountId) throw new InferenceError("Provider account configuration is unavailable.", "AUTH_REQUIRED");
    const endpoint = provider.openAiCompatibleEndpoint.replace("{account_id}", encodeURIComponent(accountId ?? ""));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${endpoint.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
        },
        signal: AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]),
        body: JSON.stringify({ model: candidate.model, messages, temperature: 0, max_tokens: 800, stream: false })
      });
      if (!response.ok) throw httpFailure(response.status, (await response.text()).replaceAll(apiKey || "\u0000", "[REDACTED]"));
      const json = await response.json() as { choices?: Array<{ message?: { content?: string; tool_calls?: unknown[]; function_call?: unknown } }>; usage?: { total_tokens?: number } };
      if (json.choices?.[0]?.message?.tool_calls?.length || json.choices?.[0]?.message?.function_call) throw new InferenceError("Model returned unsolicited native tool calls while tools are disabled; no tool was executed.", "INVALID_OUTPUT");
      return {
        content: json.choices?.[0]?.message?.content ?? "",
        provider: candidate.provider,
        model: candidate.model,
        estimatedCostUsd: 0,
        raw: { usage: json.usage }
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function qualityRank(quality: "high" | "medium" | "low" | "unknown"): number {
  if (quality === "high") return 3;
  if (quality === "medium") return 2;
  if (quality === "low") return 1;
  return 0;
}
