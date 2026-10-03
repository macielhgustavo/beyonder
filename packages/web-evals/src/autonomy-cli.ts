import { runAutonomySmoke } from "./autonomy.js";

const suite = await runAutonomySmoke();
console.log(JSON.stringify(suite, null, 2));
if (suite.failed > 0) process.exitCode = 1;
