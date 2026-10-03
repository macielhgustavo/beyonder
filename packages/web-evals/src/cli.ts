import { RealBrowserWebEvalDriver } from "./browser-tool-driver.js";
import { runWebEvalSuite } from "./runner.js";

const suite = process.argv[2] === "standard" ? "standard" : "smoke";
const result = await runWebEvalSuite({
  suite,
  driver: new RealBrowserWebEvalDriver(),
  startLocalFixtureServer: true
});

console.log(JSON.stringify(result.summary, null, 2));

if (result.summary.fail > 0 || result.summary.notEvaluated > 0 || result.summary.timeout > 0) {
  console.log(JSON.stringify(result.results.map((item) => ({
    caseId: item.caseId,
    status: item.status,
    details: item.details
  })), null, 2));
}

process.exitCode = result.summary.fail > 0 || result.summary.notEvaluated > 0 || result.summary.timeout > 0 ? 1 : 0;
