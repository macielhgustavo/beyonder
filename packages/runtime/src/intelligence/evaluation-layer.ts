import type { Evaluation, IntelligenceTask } from "./contracts.js";

export type EvaluationSpec =
  | { kind: "exact"; expected: string }
  | { kind: "classification"; expectedLabel?: string; allowedLabels: string[] }
  | { kind: "extraction"; requiredFields: string[] }
  | { kind: "json-schema"; requiredKeys?: string[]; propertyTypes?: Record<string, "string" | "number" | "boolean" | "object" | "array"> }
  | { kind: "tool-arguments"; requiredKeys: string[] }
  | { kind: "coding-test"; testsPassed: boolean; details?: string };

export class EvaluationLayer {
  evaluate(input: { task: IntelligenceTask; output: string; spec?: EvaluationSpec }): Evaluation {
    const { task, output, spec } = input;
    if (spec) return this.evaluateSpec(output, spec);
    if (task.requirements.structuredOutput) {
      return this.evaluateSpec(output, { kind: "json-schema" });
    }
    return heuristicEvaluation(task, output);
  }

  private evaluateSpec(output: string, spec: EvaluationSpec): Evaluation {
    if (spec.kind === "exact") {
      const passed = output.trim() === spec.expected.trim();
      return deterministic(passed ? 1 : 0, passed, "exact-output", passed ? [] : ["output did not match expected value"]);
    }

    if (spec.kind === "classification") {
      const label = output.trim();
      const allowed = spec.allowedLabels.includes(label);
      const matchesExpected = spec.expectedLabel == null || label === spec.expectedLabel;
      const passed = allowed && matchesExpected;
      return deterministic(passed ? 1 : allowed ? 0.5 : 0, passed, "classification-label", passed ? [] : ["classification label failed deterministic validation"]);
    }

    if (spec.kind === "coding-test") {
      return deterministic(spec.testsPassed ? 1 : 0, spec.testsPassed, "coding-test", spec.testsPassed ? [] : [spec.details ?? "coding tests failed"]);
    }

    const parsed = parseJson(output);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return deterministic(0, false, spec.kind, ["output is not a JSON object"]);
    }
    const object = parsed as Record<string, unknown>;

    if (spec.kind === "extraction" || spec.kind === "tool-arguments") {
      const requiredKeys = spec.kind === "extraction" ? spec.requiredFields : spec.requiredKeys;
      const present = requiredKeys.filter((key) => object[key] != null).length;
      const score = requiredKeys.length === 0 ? 1 : present / requiredKeys.length;
      return deterministic(score, score === 1, spec.kind, score === 1 ? [] : ["required fields are incomplete"]);
    }

    const requiredKeys = spec.requiredKeys ?? [];
    const missing = requiredKeys.filter((key) => object[key] == null);
    const typeIssues = Object.entries(spec.propertyTypes ?? {}).filter(([key, expected]) => {
      if (object[key] == null) return false;
      if (expected === "array") return !Array.isArray(object[key]);
      if (expected === "object") return typeof object[key] !== "object" || Array.isArray(object[key]);
      return typeof object[key] !== expected;
    });
    const checks = requiredKeys.length + Object.keys(spec.propertyTypes ?? {}).length;
    const failures = missing.length + typeIssues.length;
    const score = checks === 0 ? 1 : Math.max(0, (checks - failures) / checks);
    return deterministic(score, failures === 0, "json-schema", [
      ...missing.map((key) => `missing key: ${key}`),
      ...typeIssues.map(([key, expected]) => `invalid type for ${key}; expected ${expected}`)
    ]);
  }
}

function heuristicEvaluation(task: IntelligenceTask, output: string): Evaluation {
  const normalized = output.trim();
  if (!normalized) {
    return { score: 0, passed: false, confidence: 0.95, method: "structural-heuristic", issues: ["empty output"] };
  }

  let score = 0.35;
  const criteria: Record<string, number | boolean | string> = { nonEmpty: true };
  if (normalized.length >= 12) {
    score += 0.2;
    criteria.minimumLength = true;
  }
  const hasFailureMarker = /\b(error|failed|unable|cannot|exception)\b/i.test(normalized);
  if (!hasFailureMarker) {
    score += 0.2;
    criteria.noFailureMarker = true;
  }
  if (task.type === "classification") {
    if (normalized.split(/\s+/).length <= 8) score += 0.15;
  } else if (task.type === "extraction") {
    if (/[:{},\[\]]/.test(normalized)) score += 0.15;
  } else if (task.type === "coding") {
    if (/\b(function|class|interface|const|let|test|typescript|javascript|code)\b/i.test(normalized)) score += 0.15;
  } else {
    score += 0.15;
  }
  score = Math.min(1, score);
  return {
    score,
    passed: score >= 0.6,
    confidence: 0.7,
    method: "structural-heuristic",
    criteria,
    issues: hasFailureMarker ? ["failure marker detected"] : []
  };
}

function deterministic(score: number, passed: boolean, method: string, issues: string[]): Evaluation {
  return {
    score: Number(score.toFixed(6)),
    passed,
    confidence: 1,
    method,
    issues,
    criteria: { deterministic: true }
  };
}

function parseJson(output: string): unknown | null {
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}
