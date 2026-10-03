import { describe, expect, it } from "vitest";
import type { IntelligenceTask } from "./contracts.js";
import { EvaluationLayer } from "./evaluation-layer.js";

const task: IntelligenceTask = {
  id: "task-eval",
  input: "Return structured output",
  type: "extraction",
  complexity: 0.4,
  risk: 0.1,
  estimatedTokens: 200,
  requirements: {}
};

describe("EvaluationLayer", () => {
  const evaluator = new EvaluationLayer();

  it("validates exact output and classification labels deterministically", () => {
    expect(evaluator.evaluate({ task, output: "ok", spec: { kind: "exact", expected: "ok" } }).passed).toBe(true);
    expect(evaluator.evaluate({
      task: { ...task, type: "classification" },
      output: "safe",
      spec: { kind: "classification", allowedLabels: ["safe", "unsafe"], expectedLabel: "safe" }
    }).score).toBe(1);
  });

  it("validates JSON schema and extraction completeness", () => {
    const json = evaluator.evaluate({
      task,
      output: JSON.stringify({ name: "Beyonder", count: 2 }),
      spec: { kind: "json-schema", requiredKeys: ["name", "count"], propertyTypes: { name: "string", count: "number" } }
    });
    expect(json.passed).toBe(true);

    const incomplete = evaluator.evaluate({
      task,
      output: JSON.stringify({ name: "Beyonder" }),
      spec: { kind: "extraction", requiredFields: ["name", "count"] }
    });
    expect(incomplete.passed).toBe(false);
    expect(incomplete.score).toBe(0.5);
  });

  it("uses structural heuristics for open tasks without calling a judge model", () => {
    const result = evaluator.evaluate({
      task: { ...task, type: "planning" },
      output: "Create a bounded plan, validate the result, and preserve zero-cost constraints."
    });
    expect(result.method).toBe("structural-heuristic");
    expect(result.passed).toBe(true);
    expect(result.confidence).toBeLessThan(1);
  });
});
