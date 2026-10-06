import type { TaskOutcome } from "../intelligence/contracts.js";
import { WorkingMemory, type WorkingMemoryRecord } from "./working-memory.js";
import type { MemoryKind, MemoryRecord, MemoryStore, PersistentMemoryKind } from "./memory-store.js";

export interface RetrievalWeights {
  relevance: number;
  importance: number;
  recency: number;
  utility: number;
  taskType: number;
}

export const DEFAULT_RETRIEVAL_WEIGHTS: RetrievalWeights = {
  relevance: 0.5,
  importance: 0.18,
  recency: 0.14,
  utility: 0.13,
  taskType: 0.05
};

export interface RetrieveMemoryRequest {
  query: string;
  taskType?: string;
  limit?: number;
}

export interface RetrievedMemory {
  id: string;
  kind: MemoryKind;
  content: string;
  importance: number;
  confidence: number;
  utility: number;
  score: number;
  createdAt: string;
  lastAccessedAt: string;
  accessCount: number;
  source?: string;
  taskId?: string;
  keywords: string[];
  metadata: Record<string, unknown>;
}

export interface MemoryRememberOptions {
  confidence?: number;
  utility?: number;
  source?: string;
  taskId?: string;
  keywords?: string[];
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface MemoryStats {
  total: number;
  working: number;
  episodic: number;
  semantic: number;
  procedural: number;
  economic: number;
}

export class MemoryEngine {
  private readonly working = new WorkingMemory();

  constructor(
    private readonly store: MemoryStore,
    private readonly weights: RetrievalWeights = DEFAULT_RETRIEVAL_WEIGHTS
  ) {}

  async remember(kind: MemoryKind, content: string, importance = 1, options: MemoryRememberOptions = {}) {
    if (kind === "working") {
      return this.working.remember(content, importance, options);
    }
    return this.store.remember({
      kind,
      content,
      importance,
      confidence: options.confidence,
      utility: options.utility,
      source: options.source,
      taskId: options.taskId,
      keywords: options.keywords,
      metadata: options.metadata,
      createdAt: options.createdAt
    });
  }

  async retrieve(request: RetrieveMemoryRequest | string, legacyLimit = 6): Promise<RetrievedMemory[]> {
    const options: RetrieveMemoryRequest = typeof request === "string"
      ? { query: request, limit: legacyLimit }
      : request;
    const limit = options.limit ?? 6;
    const queryTerms = tokenize(options.query);
    const persistent = await this.store.all();
    const candidates: Array<MemoryRecord | WorkingMemoryRecord> = [...this.working.all(), ...persistent];

    const ranked = candidates
      .map((memory) => scoreMemory(memory, queryTerms, options.taskType, this.weights))
      .filter((memory) => memory.relevant)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ relevant: _relevant, ...memory }) => memory);

    const persistentIds = ranked.filter((memory) => memory.kind !== "working").map((memory) => memory.id);
    const workingIds = ranked.filter((memory) => memory.kind === "working").map((memory) => memory.id);
    await this.store.touch(persistentIds);
    this.working.touch(workingIds);

    return ranked.map((memory) => ({ ...memory, accessCount: memory.accessCount + 1, lastAccessedAt: new Date().toISOString() }));
  }

  async contextSummary(query: string, maxChars = 1200): Promise<string> {
    const retrieved = await this.retrieve({ query });
    if (retrieved.length === 0) return "No relevant prior memory.";
    const lines = retrieved.map((memory) => `${memory.kind}: ${memory.content}`);
    return compact(lines.join("\n"), maxChars);
  }

  async recordOutcome(outcome: TaskOutcome): Promise<{ episodic: MemoryRecord; economic: MemoryRecord }> {
    const objectiveStatus = outcome.evaluation?.criteria?.objectiveStatus;
    const qualityEvaluated = !["NEEDS_CAPABILITY", "NEEDS_INPUT", "CANCELLED", "RECONCILIATION_REQUIRED"].includes(String(objectiveStatus ?? ""))
      && (!outcome.failureClass || ["INVALID_OUTPUT", "INVALID_ACTION"].includes(outcome.failureClass));
    const evaluationScore = qualityEvaluated ? outcome.evaluation?.score ?? null : null;
    const commonMetadata = {
      phase: outcome.phase,
      failureClass: outcome.failureClass,
      taskType: outcome.task.type,
      provider: outcome.provider ?? outcome.attempts.at(-1)?.provider ?? "none",
      model: outcome.model ?? outcome.attempts.at(-1)?.model ?? "none",
      attempts: outcome.attempts.length,
      success: outcome.success,
      evaluationScore,
      qualityEvaluated,
      objectiveStatus,
      objectiveScore: outcome.evaluation?.score ?? null
    };
    const keywords = [...tokenize(outcome.task.input)].slice(0, 24);

    const episodic = await this.store.remember({
      kind: "episodic",
      content: JSON.stringify({
        event: "task_outcome",
        input: outcome.task.input,
        result: outcome.result,
        error: outcome.error,
        tools: outcome.tools,
        completedAt: outcome.completedAt
      }),
      importance: outcome.success ? 3 : 4,
      confidence: outcome.evaluation?.score ?? (outcome.success ? 0.8 : 1),
      utility: outcome.success ? 0.7 : 0.6,
      source: "agent-loop",
      taskId: outcome.task.id,
      keywords,
      metadata: commonMetadata
    });

    const economic = await this.store.remember({
      kind: "economic",
      content: JSON.stringify({
        provider: commonMetadata.provider,
        model: commonMetadata.model,
        taskType: outcome.task.type,
        tokens: outcome.tokens,
        monetaryCostUsd: outcome.monetaryCostUsd,
        shadowCostUsd: outcome.shadowCostUsd,
        latencyMs: outcome.latencyMs,
        attempts: outcome.attempts.length,
        success: outcome.success,
        evaluationScore,
        quotaConsumed: outcome.quotaConsumed ?? null
      }),
      importance: 3,
      confidence: 1,
      utility: 0.8,
      source: "agent-loop",
      taskId: outcome.task.id,
      keywords: [outcome.task.type, String(commonMetadata.provider), String(commonMetadata.model)],
      metadata: {
        ...commonMetadata,
        tokens: outcome.tokens,
        monetaryCostUsd: outcome.monetaryCostUsd,
        shadowCostUsd: outcome.shadowCostUsd,
        latencyMs: outcome.latencyMs,
        quotaConsumed: outcome.quotaConsumed ?? null
      }
    });

    return { episodic, economic };
  }

  async stats(): Promise<MemoryStats> {
    const records = await this.store.all();
    const stats: MemoryStats = {
      total: records.length + this.working.size,
      working: this.working.size,
      episodic: 0,
      semantic: 0,
      procedural: 0,
      economic: 0
    };
    for (const record of records) stats[record.kind] += 1;
    return stats;
  }

  clearWorkingMemory() {
    this.working.clear();
  }
}

function scoreMemory(
  memory: MemoryRecord | WorkingMemoryRecord,
  queryTerms: Set<string>,
  taskType: string | undefined,
  weights: RetrievalWeights
): RetrievedMemory & { relevant: boolean } {
  const contentTerms = tokenize(`${memory.content} ${memory.keywords.join(" ")}`);
  const overlap = [...queryTerms].filter((term) => contentTerms.has(term)).length;
  const relevance = queryTerms.size === 0 ? 0 : overlap / queryTerms.size;
  const importance = clamp(memory.importance / 5);
  const utility = clamp(memory.utility);
  const ageMs = Math.max(0, Date.now() - Date.parse(memory.createdAt));
  const ageDays = ageMs / 86_400_000;
  const recency = Math.exp(-ageDays / 30);
  const memoryTaskType = typeof memory.metadata.taskType === "string" ? memory.metadata.taskType : undefined;
  const taskTypeScore = taskType && memoryTaskType === taskType ? 1 : 0;
  const score =
    relevance * weights.relevance +
    importance * weights.importance +
    recency * weights.recency +
    utility * weights.utility +
    taskTypeScore * weights.taskType;

  return {
    ...memory,
    score: Number(score.toFixed(6)),
    relevant: relevance > 0 || taskTypeScore > 0 || memory.importance >= 4
  };
}

function tokenize(input: string): Set<string> {
  return new Set(input.toLowerCase().match(/[\p{L}\p{N}_.$-]{3,}/gu) ?? []);
}

function compact(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  const head = input.slice(0, Math.floor(maxChars * 0.7)).trim();
  const tail = input.slice(-Math.floor(maxChars * 0.25)).trim();
  return `${head}\n...\n${tail}`;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export type { PersistentMemoryKind };
