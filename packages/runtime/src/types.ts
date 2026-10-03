export type EconomicState = "growth" | "normal" | "defensive" | "survival" | "halted";

export type LedgerEntryType = "capital" | "expense" | "revenue" | "adjustment";

export type AgentStepStatus = "completed" | "skipped" | "failed" | "halted";

export interface AgentDecision {
  action: string;
  rationale: string;
  expectedCostUsd: number;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelResponse {
  content: string;
  provider: string;
  model: string;
  estimatedCostUsd: number;
  raw?: unknown;
}

export interface ToolCallResult {
  ok: boolean;
  output: string;
  error?: string;
}
