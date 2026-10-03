import { describe, expect, it } from "vitest";
import { runWebEvalSuite } from "./runner.js";
import { countCasesByCategory, getWebEvalCases, WEB_EVAL_CASES } from "./suites.js";

describe("web eval suites", () => {
  it("contains exactly 10 smoke cases and 40 standard cases", () => {
    expect(getWebEvalCases("smoke")).toHaveLength(10);
    expect(getWebEvalCases("standard")).toHaveLength(40);
  });

  it("keeps four cases in each initial category", () => {
    expect(Object.values(countCasesByCategory())).toEqual(Array(10).fill(4));
  });

  it("has unique case ids", () => {
    const ids = WEB_EVAL_CASES.map((testCase) => testCase.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("marks the suite NOT_EVALUATED when infrastructure is absent instead of scoring zero", async () => {
    const run = await runWebEvalSuite({
      suite: "smoke",
      driver: undefined,
      startLocalFixtureServer: false
    });
    expect(run.summary.notEvaluated).toBe(10);
    expect(run.summary.fail).toBe(0);
    expect(run.summary.metrics.taskCompletion).toBeNull();
    expect(run.summary.metrics.toolSelectionAccuracy).toBeNull();
  });
});
