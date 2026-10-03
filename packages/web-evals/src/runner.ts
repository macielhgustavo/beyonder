import { evaluateWebCase } from "./evaluator.js";
import { startFixtureServer, WEB_EVAL_FIXTURE_VERSION } from "./fixture-server.js";
import { getWebEvalCases } from "./suites.js";
import type { WebEvalDriver, WebEvalMetrics, WebEvalResult, WebEvalSuiteRun, WebEvalSuiteSummary } from "./types.js";

export interface RunWebEvalSuiteOptions {
  suite: "smoke" | "standard";
  driver?: WebEvalDriver;
  fixtureBaseUrl?: string;
  startLocalFixtureServer?: boolean;
}

export async function runWebEvalSuite(options: RunWebEvalSuiteOptions): Promise<WebEvalSuiteRun> {
  const cases = getWebEvalCases(options.suite);
  const shouldStartServer = options.startLocalFixtureServer !== false && options.fixtureBaseUrl == null;
  const fixtureServer = shouldStartServer ? await startFixtureServer() : undefined;
  const fixtureBaseUrl = options.fixtureBaseUrl ?? fixtureServer?.baseUrl;
  const results: WebEvalResult[] = [];

  try {
    for (const testCase of cases) {
      results.push(await evaluateWebCase(testCase, options.driver, {
        fixtureBaseUrl,
        fixtureVersion: WEB_EVAL_FIXTURE_VERSION
      }));
    }
  } finally {
    await fixtureServer?.close();
  }

  return {
    results,
    summary: summarizeWebEvalResults(options.suite, results)
  };
}

export function summarizeWebEvalResults(
  suite: "smoke" | "standard",
  results: WebEvalResult[]
): WebEvalSuiteSummary {
  return {
    suite,
    cases: results.length,
    pass: results.filter((result) => result.status === "PASS").length,
    fail: results.filter((result) => result.status === "FAIL").length,
    notEvaluated: results.filter((result) => result.status === "NOT_EVALUATED").length,
    timeout: results.filter((result) => result.status === "TIMEOUT").length,
    metrics: {
      toolSelectionAccuracy: averageMetric(results, "toolSelectionAccuracy"),
      argumentValidity: averageMetric(results, "argumentValidity"),
      executionSuccess: averageMetric(results, "executionSuccess"),
      taskCompletion: averageMetric(results, "taskCompletion"),
      policyCompliance: averageMetric(results, "policyCompliance"),
      steps: sumMetric(results, "steps"),
      latency: sumMetric(results, "latency"),
      monetaryCost: sumMetric(results, "monetaryCost"),
      shadowCost: sumMetric(results, "shadowCost")
    }
  };
}

function averageMetric(
  results: WebEvalResult[],
  key: keyof Pick<WebEvalMetrics, "toolSelectionAccuracy" | "argumentValidity" | "executionSuccess" | "taskCompletion" | "policyCompliance">
): number | null {
  const values = results
    .map((result) => result.metrics[key])
    .filter((value): value is number => value != null);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sumMetric(
  results: WebEvalResult[],
  key: keyof Pick<WebEvalMetrics, "steps" | "latency" | "monetaryCost" | "shadowCost">
): number {
  return results.reduce((sum, result) => sum + result.metrics[key], 0);
}
