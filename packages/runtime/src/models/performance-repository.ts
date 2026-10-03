import type { IntelligenceTaskType, TaskOutcome } from "../intelligence/contracts.js";
import type { MemoryStore } from "../memory/memory-store.js";
import type { HistoricalPerformance } from "./adaptive-types.js";

export interface PerformanceRepository {
  get(provider: string, model: string, taskType: IntelligenceTaskType): Promise<HistoricalPerformance>;
  outcomeRecorded?(outcome: TaskOutcome): Promise<void>;
}

export class MemoryPerformanceRepository implements PerformanceRepository {
  constructor(private readonly memoryStore: MemoryStore) {}

  async get(provider: string, model: string, taskType: IntelligenceTaskType): Promise<HistoricalPerformance> {
    const records = (await this.memoryStore.all(2000)).filter((record) => {
      if (record.kind !== "economic") return false;
      return record.metadata.provider === provider && record.metadata.model === model && record.metadata.taskType === taskType;
    });

    const samples = records.length;
    let successes = 0;
    let evaluationTotal = 0;
    let evaluationSamples = 0;
    let latencyTotal = 0;
    let monetaryTotal = 0;
    let shadowTotal = 0;
    let attemptsTotal = 0;

    for (const record of records) {
      if (record.metadata.success === true) successes += 1;
      const evaluationScore = asNumber(record.metadata.evaluationScore);
      if (evaluationScore != null) {
        evaluationTotal += evaluationScore;
        evaluationSamples += 1;
      }
      latencyTotal += asNumber(record.metadata.latencyMs) ?? 0;
      monetaryTotal += asNumber(record.metadata.monetaryCostUsd) ?? 0;
      shadowTotal += asNumber(record.metadata.shadowCostUsd) ?? 0;
      attemptsTotal += asNumber(record.metadata.attempts) ?? 0;
    }

    const failures = samples - successes;
    const successRate = samples === 0 ? 0.5 : successes / samples;
    return {
      provider,
      model,
      taskType,
      samples,
      successes,
      failures,
      successRate,
      avgEvaluationScore: evaluationSamples === 0 ? successRate : evaluationTotal / evaluationSamples,
      avgLatencyMs: samples === 0 ? 0 : latencyTotal / samples,
      avgMonetaryCostUsd: samples === 0 ? 0 : monetaryTotal / samples,
      avgShadowCostUsd: samples === 0 ? 0 : shadowTotal / samples,
      avgAttempts: samples === 0 ? 0 : attemptsTotal / samples,
      updatedAt: records[0]?.createdAt
    };
  }

  async outcomeRecorded(_outcome: TaskOutcome): Promise<void> {
    // The Memory Engine is the source of truth. No benchmark/performance table is duplicated here.
  }
}

export class EmptyPerformanceRepository implements PerformanceRepository {
  async get(provider: string, model: string, taskType: IntelligenceTaskType): Promise<HistoricalPerformance> {
    return {
      provider,
      model,
      taskType,
      samples: 0,
      successes: 0,
      failures: 0,
      successRate: 0.5,
      avgEvaluationScore: 0.5,
      avgLatencyMs: 0,
      avgMonetaryCostUsd: 0,
      avgShadowCostUsd: 0,
      avgAttempts: 0
    };
  }
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
