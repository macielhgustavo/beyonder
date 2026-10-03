import { nanoid } from "nanoid";
import type { RouterTelemetry, ModelCandidate, RouteDecision } from "../models/adaptive-types.js";
import type { ModelRouter } from "../models/model-router.js";
import { getEconomicRoutingPolicy } from "../models/router-config.js";
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

export class AdaptiveExecutionController {
  constructor(
    private readonly router: ModelRouter,
    private readonly evaluator = new EvaluationLayer(),
    private readonly telemetry?: RouterTelemetry
  ) {}

  async execute(input: {
    task: IntelligenceTask;
    economicState: EconomicState;
    messages: ModelMessage[];
    evaluationSpec?: EvaluationSpec;
  }): Promise<AdaptiveExecutionResult> {
    const policy = getEconomicRoutingPolicy(input.economicState);
    const route = await this.router.route(input.task, input.economicState);
    if (!policy.allowInference || !route.selected || policy.maxAttempts === 0) {
      return { route, attempts: [], exhausted: true };
    }

    const ordered = [route.selected, ...route.candidates.filter((candidate) => candidate !== route.selected)
      .sort((a, b) => b.predictedQuality - a.predictedQuality || b.utility - a.utility)];
    const attempts: ExecutionAttempt[] = [];
    let candidateIndex = 0;
    let retriesForCandidate = 0;
    let escalations = 0;
    let lastEvaluation: Evaluation | undefined;
    let lastResponse: ModelResponse | undefined;
    let lastCandidate: ModelCandidate | undefined;

    while (attempts.length < policy.maxAttempts && candidateIndex < ordered.length) {
      const candidate = ordered[candidateIndex];
      if (!candidate) break;
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      lastCandidate = candidate;

      try {
        const response = await this.router.completeForCandidate(input.messages, candidate);
        lastResponse = response;
        const evaluation = this.evaluator.evaluate({ task: input.task, output: response.content, spec: input.evaluationSpec });
        lastEvaluation = evaluation;
        const attempt: ExecutionAttempt = {
          id: `attempt_${nanoid()}`,
          taskId: input.task.id,
          attempt: attempts.length + 1,
          provider: candidate.provider,
          model: candidate.model,
          startedAt,
          completedAt: new Date().toISOString(),
          latencyMs: Date.now() - startedMs,
          tokens: response.provider === "none" ? 0 : input.task.estimatedTokens,
          monetaryCostUsd: response.estimatedCostUsd,
          shadowCostUsd: candidate.shadowCostUsd,
          tools: [],
          success: true
        };
        attempts.push(attempt);
        await this.telemetry?.record("info", "evaluation.completed", {
          taskId: input.task.id,
          provider: candidate.provider,
          model: candidate.model,
          score: evaluation.score,
          passed: evaluation.passed,
          method: evaluation.method
        });

        if (evaluation.passed && evaluation.score >= policy.minimumAcceptableQuality) {
          return { route, attempts, response, evaluation, selectedCandidate: candidate, exhausted: false };
        }

        if (escalations >= policy.maxEscalations) break;
        candidateIndex += 1;
        retriesForCandidate = 0;
        escalations += 1;
        const next = ordered[candidateIndex];
        if (next) {
          await this.telemetry?.record("info", "router.escalated", {
            taskId: input.task.id,
            from: `${candidate.provider}/${candidate.model}`,
            to: `${next.provider}/${next.model}`,
            previousScore: evaluation.score,
            escalation: escalations
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attempts.push({
          id: `attempt_${nanoid()}`,
          taskId: input.task.id,
          attempt: attempts.length + 1,
          provider: candidate.provider,
          model: candidate.model,
          startedAt,
          completedAt: new Date().toISOString(),
          latencyMs: Date.now() - startedMs,
          tokens: 0,
          monetaryCostUsd: 0,
          shadowCostUsd: candidate.shadowCostUsd,
          tools: [],
          success: false,
          error: message
        });

        if (attempts.length >= policy.maxAttempts) break;
        if (retriesForCandidate < 1) {
          retriesForCandidate += 1;
          continue;
        }
        if (escalations >= policy.maxEscalations) break;
        candidateIndex += 1;
        retriesForCandidate = 0;
        escalations += 1;
        const next = ordered[candidateIndex];
        if (next) {
          await this.telemetry?.record("info", "router.escalated", {
            taskId: input.task.id,
            from: `${candidate.provider}/${candidate.model}`,
            to: `${next.provider}/${next.model}`,
            error: message,
            escalation: escalations
          });
        }
      }
    }

    return {
      route,
      attempts,
      response: lastResponse,
      evaluation: lastEvaluation,
      selectedCandidate: lastCandidate,
      exhausted: true
    };
  }
}
