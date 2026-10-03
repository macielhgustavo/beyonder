export type IntelligenceTaskType =
  | "chat"
  | "reasoning"
  | "coding"
  | "research"
  | "extraction"
  | "classification"
  | "planning"
  | "tool-use"
  | "browser"
  | "memory"
  | "compression";

export interface IntelligenceRequirements {
  tools?: string[];
  contextWindow?: number;
  structuredOutput?: boolean;
  reasoning?: boolean;
  vision?: boolean;
}

export interface IntelligenceTask {
  id: string;
  input: string;
  type: IntelligenceTaskType;
  complexity: number;
  risk: number;
  estimatedTokens: number;
  requirements: IntelligenceRequirements;
}

export interface ExecutionPlanStep {
  id: string;
  kind: "memory" | "deterministic" | "model" | "tool";
  description: string;
  optional?: boolean;
}

export interface ExecutionPlan {
  id: string;
  taskId: string;
  steps: ExecutionPlanStep[];
  createdAt: string;
}

export interface ExecutionAttempt {
  id: string;
  taskId: string;
  attempt: number;
  provider?: string;
  model?: string;
  startedAt: string;
  completedAt?: string;
  latencyMs?: number;
  tokens?: number;
  monetaryCostUsd: number;
  shadowCostUsd: number;
  tools: string[];
  success: boolean;
  error?: string;
}

export interface Evaluation {
  score: number;
  passed: boolean;
  confidence?: number;
  method?: string;
  criteria?: Record<string, number | boolean | string>;
  notes?: string[];
  issues?: string[];
}

export interface TaskOutcome {
  task: IntelligenceTask;
  plan?: ExecutionPlan;
  attempts: ExecutionAttempt[];
  success: boolean;
  result?: string;
  error?: string;
  evaluation?: Evaluation;
  provider?: string;
  model?: string;
  tokens: number;
  monetaryCostUsd: number;
  shadowCostUsd: number;
  latencyMs: number;
  tools: string[];
  quotaConsumed?: number;
  completedAt: string;
}

export interface IntelligenceResult {
  task: IntelligenceTask;
  plan?: ExecutionPlan;
  context: {
    memoryIds: string[];
    summary: string;
  };
  outcome?: TaskOutcome;
}
