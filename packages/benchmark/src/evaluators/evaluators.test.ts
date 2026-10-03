import { describe, expect, it } from "vitest";
import { evaluateCase } from "./index.js";
import type { BenchmarkCase } from "../types.js";

describe("benchmark evaluators", () => {
  it("scores exact answers deterministically", () => {
    expect(evaluateCase(testCase("exact", "42"), " 42. ").success).toBe(true);
  });

  it("scores required terms", () => {
    const result = evaluateCase(testCase("contains", ["alpha", "beta"]), "alpha only");
    expect(result.quality).toBe(0.5);
    expect(result.success).toBe(false);
  });

  it("validates JSON keys", () => {
    const result = evaluateCase(testCase("json-schema", { required: ["ok", "count"] }), '{"ok":true,"count":2}');
    expect(result.success).toBe(true);
  });

  it("runs small code tests", () => {
    const result = evaluateCase(
      testCase("code-test", { functionName: "double", tests: [[ [2], 4 ]] }),
      "function double(n) { return n * 2; }"
    );
    expect(result.success).toBe(true);
  });

  it("scores heuristic facts", () => {
    const result = evaluateCase(testCase("heuristic", { mustContain: ["zero-cost", "router"] }), "zero-cost routing");
    expect(result.quality).toBe(0.5);
  });
});

function testCase(evaluator: BenchmarkCase["evaluator"], expected: unknown): BenchmarkCase {
  return { id: "case", category: "reasoning", prompt: "prompt", difficulty: 1, evaluator, expected };
}
