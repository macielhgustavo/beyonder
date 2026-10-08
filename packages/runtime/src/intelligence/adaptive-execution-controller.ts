import type { RouterTelemetry, ModelCandidate, RouteDecision } from "../models/adaptive-types.js";
import type { ModelRouter } from "../models/model-router.js";
import { getEconomicRoutingPolicy, inferenceAttemptPolicy } from "../models/router-config.js";
import { InferenceError, runCandidates, validateDirectResponse, type InferenceAttempt } from "../models/inference.js";
import type { EconomicState, ModelMessage, ModelResponse } from "../types.js";
import type { Evaluation, ExecutionAttempt, IntelligenceTask } from "./contracts.js";
import { EvaluationLayer, type EvaluationSpec } from "./evaluation-layer.js";

export interface AdaptiveExecutionResult {
  route: RouteDecision;
  attempts: ExecutionAttempt[];
  response?: ModelResponse;
  evaluation?: Evaluation;
  selectedCandidate?: ModelCandidate;
  exhausted: boolean;
}

/** Legacy inference adapter, not a second task/tool executor. */
export class AdaptiveExecutionController {
  constructor(private readonly router: ModelRouter, private readonly evaluator = new EvaluationLayer(), private readonly telemetry?: RouterTelemetry) {}

  async execute(input: { task: IntelligenceTask; economicState: EconomicState; messages: ModelMessage[]; evaluationSpec?: EvaluationSpec }): Promise<AdaptiveExecutionResult> {
    const policy = getEconomicRoutingPolicy(input.economicState);
    const route = await this.router.route(input.task, input.economicState);
    const attempts: ExecutionAttempt[] = [];
    if (!policy.allowInference || !route.selected) return { route, attempts, exhausted: true };
    if (input.task.requirements.toolUse || input.task.requirements.tools?.length || input.task.requirements.browser) {
      await this.telemetry?.record("warn", "inference.requires_task_executor", { taskId: input.task.id });
      return { route, attempts, exhausted: true };
    }
    const candidates = [route.selected, ...route.candidates.filter((c) => c !== route.selected)];
    const record = async (attempt: InferenceAttempt) => {
      await this.router.recordAttempt?.(attempt);
      if (attempt.status === "STARTED") return;
      attempts.push({ ...attempt, completedAt: attempt.completedAt!, latencyMs: attempt.latencyMs ?? 0, tools: [], tokens: 0, success: attempt.status === "SUCCEEDED" });
    };
    try {
      const result = await runCandidates({ taskId: input.task.id, phase: "DIRECT_RESPONSE", candidates, messages: input.messages,
        maxCandidates: Math.min(policy.maxAttempts, policy.maxEscalations + 1), ...inferenceAttemptPolicy(input.economicState),
        maxMonetaryCostUsd: policy.maxMonetaryCostUsd, maxShadowCostUsd: policy.maxEffectiveCostUsd, maxDurationMs: 60_000,
        complete: this.router.completeForPlanningCandidate?.bind(this.router) ?? this.router.completeForCandidate.bind(this.router),
        canAttempt: this.router.canAttempt?.bind(this.router), record,
        validate: (response) => {
          validateDirectResponse(response.content);
          const evaluation = this.evaluator.evaluate({ task: input.task, output: response.content, spec: input.evaluationSpec });
          if (!response.content.trim() || !evaluation.passed || evaluation.score < policy.minimumAcceptableQuality) throw new InferenceError("Response did not meet the evaluation quality floor.", "INVALID_OUTPUT");
          return evaluation;
        }
      });
      await this.telemetry?.record("info", "evaluation.completed", { taskId: input.task.id, provider: result.candidate.provider, model: result.candidate.model, ...result.value });
      return { route, attempts, response: result.response, evaluation: result.value, selectedCandidate: result.candidate, exhausted: false };
    } catch {
      return { route, attempts, exhausted: true };
    }
  }
}
