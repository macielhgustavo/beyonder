import type { IntelligenceRequirements, IntelligenceTaskType } from "./contracts.js";

export interface ComplexityEstimate {
  complexity: number;
  risk: number;
  estimatedTokens: number;
  requirements: IntelligenceRequirements;
}

const TYPE_BASELINE: Record<IntelligenceTaskType, number> = {
  chat: 0.12,
  reasoning: 0.46,
  coding: 0.5,
  research: 0.52,
  extraction: 0.3,
  classification: 0.22,
  planning: 0.44,
  "tool-use": 0.38,
  browser: 0.4,
  memory: 0.24,
  compression: 0.26
};

export class ComplexityEstimator {
  estimate(input: string, type: IntelligenceTaskType): ComplexityEstimate {
    const words = input.trim().split(/\s+/).filter(Boolean).length;
    const lengthScore = Math.min(0.2, words / 1200);
    const structureScore = Math.min(0.14, countMatches(input, /(?:^|\n)\s*(?:[-*]|\d+[.)])\s+/gm) * 0.018);
    const codeScore = /```|\b(function|class|interface|SELECT|INSERT|UPDATE|async|await)\b/i.test(input) ? 0.1 : 0;
    const multiStepScore = /\b(first|then|after|before|finally|multiple|several|primeiro|depois|antes|por fim|vários?)\b/i.test(input) ? 0.08 : 0;
    const complexity = clamp(TYPE_BASELINE[type] + lengthScore + structureScore + codeScore + multiStepScore);

    const riskSignals = countMatches(
      input,
      /\b(delete|remove|payment|wallet|secret|token|credential|shell|sudo|rm\s+-rf|deploy|purchase|pagar|pagamento|carteira|segredo|credencial|apagar|deletar)\b/gi
    );
    const typeRisk = type === "browser" || type === "tool-use" ? 0.12 : 0.04;
    const risk = clamp(typeRisk + Math.min(0.64, riskSignals * 0.12));

    const estimatedTokens = Math.min(8192, Math.max(256, Math.ceil(input.length / 4 + 256 + complexity * 1500)));
    const requirements: IntelligenceRequirements = {
      contextWindow: Math.max(2048, Math.ceil(estimatedTokens * 1.8)),
      structuredOutput: /\b(json|schema|structured|table|csv|yaml|estrutura|estruturado|tabela)\b/i.test(input),
      reasoning: ["reasoning", "coding", "research", "planning"].includes(type),
      vision: /\b(image|screenshot|photo|vision|imagem|print|foto)\b/i.test(input)
    };

    if (type === "browser") requirements.tools = ["browser"];
    if (type === "tool-use") requirements.tools = ["restricted-tool"];

    return { complexity, risk, estimatedTokens, requirements };
  }
}

function countMatches(input: string, pattern: RegExp): number {
  return [...input.matchAll(pattern)].length;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}
