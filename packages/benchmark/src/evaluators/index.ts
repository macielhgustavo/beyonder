import vm from "node:vm";
import type { BenchmarkCase, EvaluationResult } from "../types.js";

export function evaluateCase(testCase: BenchmarkCase, output: string): EvaluationResult {
  switch (testCase.evaluator) {
    case "exact":
      return exact(output, String(testCase.expected ?? ""));
    case "contains":
      return contains(output, toStringArray(testCase.expected));
    case "json-schema":
      return jsonSchema(output, testCase.expected);
    case "code-test":
      return codeTest(output, testCase.expected);
    case "heuristic":
      return heuristic(output, testCase.expected);
  }
}

function exact(output: string, expected: string): EvaluationResult {
  const normalizedOutput = normalize(output).replace(/[.。]$/, "");
  const normalizedExpected = normalize(expected);
  return result(normalizedOutput === normalizedExpected ? 1 : 0, { expected, actual: output.trim() });
}

function contains(output: string, expectedTerms: string[]): EvaluationResult {
  const haystack = output.toLowerCase();
  const hits = expectedTerms.filter((term) => haystack.includes(term.toLowerCase()));
  return result(expectedTerms.length === 0 ? 1 : hits.length / expectedTerms.length, { expectedTerms, hits });
}

function jsonSchema(output: string, expected: unknown): EvaluationResult {
  const required = expected && typeof expected === "object" && "required" in expected ? toStringArray((expected as { required: unknown }).required) : [];
  const parsed = parseJsonObject(output);
  if (!parsed) return result(0, { error: "invalid-json" });
  const hits = required.filter((key) => key in parsed);
  return result(required.length === 0 ? 1 : hits.length / required.length, { required, hits });
}

function codeTest(output: string, expected: unknown): EvaluationResult {
  const spec = expected as { functionName?: string; tests?: Array<[unknown[], unknown]> };
  if (!spec.functionName || !Array.isArray(spec.tests)) return result(0, { error: "invalid-code-spec" });
  try {
    const script = new vm.Script(`${stripCodeFence(output)}\n${spec.functionName};`);
    const context = vm.createContext({});
    const fn = script.runInContext(context, { timeout: 500 }) as unknown;
    if (typeof fn !== "function") return result(0, { error: "function-not-found" });
    let passed = 0;
    const failures: Array<{ args: unknown[]; expected: unknown; actual: unknown }> = [];
    for (const [args, expectedValue] of spec.tests) {
      const actual = fn(...args);
      if (deepEqual(actual, expectedValue)) {
        passed += 1;
      } else {
        failures.push({ args, expected: expectedValue, actual });
      }
    }
    return result(spec.tests.length === 0 ? 1 : passed / spec.tests.length, { passed, total: spec.tests.length, failures });
  } catch (error) {
    return result(0, { error: error instanceof Error ? error.message : String(error) });
  }
}

function heuristic(output: string, expected: unknown): EvaluationResult {
  const spec = expected as { mustContain?: unknown; mustNotContain?: unknown };
  const mustContain = toStringArray(spec?.mustContain);
  const mustNotContain = toStringArray(spec?.mustNotContain);
  const lower = output.toLowerCase();
  const present = mustContain.filter((term) => lower.includes(term.toLowerCase()));
  const absent = mustNotContain.filter((term) => !lower.includes(term.toLowerCase()));
  const denominator = mustContain.length + mustNotContain.length;
  return result(denominator === 0 ? 1 : (present.length + absent.length) / denominator, { present, absent });
}

function result(quality: number, details: Record<string, unknown>): EvaluationResult {
  const bounded = Math.max(0, Math.min(1, quality));
  return { quality: bounded, success: bounded >= 0.8, details };
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, " ");
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function parseJsonObject(output: string): Record<string, unknown> | null {
  const trimmed = stripCodeFence(output).trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function stripCodeFence(output: string): string {
  return output.replace(/^```[a-zA-Z0-9_-]*\s*/m, "").replace(/```\s*$/m, "").trim();
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
