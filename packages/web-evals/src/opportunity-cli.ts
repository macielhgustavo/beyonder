import { runOpportunitySmoke } from "./opportunity.js";

const result = await runOpportunitySmoke();
console.log(JSON.stringify(result, null, 2));
if (result.results.some((item) => item.status === "FAIL") || result.taskStatus !== "COMPLETED") process.exitCode = 1;
