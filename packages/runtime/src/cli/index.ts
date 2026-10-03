#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig } from "../config/env.js";
import { createRuntime } from "../runtime.js";
import { classifyEconomicState } from "../economy/economic-state.js";

const program = new Command();

program.name("econ-agent").description("Simulated economic runtime for autonomous agents").version("0.1.0");

program
  .command("init")
  .description("Initialize the local SQLite runtime")
  .action(async () => {
    const config = loadConfig();
    const runtime = createRuntime(config);
    await runtime.agent.initialize();
    console.log(`Initialized ${config.agentName} with $${config.startingCapitalUsd.toFixed(2)} simulated/runtime capital.`);
    runtime.sqlite.close();
  });

program
  .command("status")
  .description("Print current economic status")
  .action(async () => {
    const config = loadConfig();
    const runtime = createRuntime(config);
    await runtime.ledger.initialize(config.startingCapitalUsd);
    const summary = await runtime.ledger.summary(config.monthlyFixedCostUsd);
    console.log(
      JSON.stringify(
        {
          agent: config.agentName,
          economicState: classifyEconomicState(summary),
          summary
        },
        null,
        2
      )
    );
    runtime.sqlite.close();
  });

program
  .command("run")
  .description("Run the agent loop")
  .option("-s, --steps <steps>", "number of loop steps")
  .action(async (options: { steps?: string }) => {
    const config = loadConfig();
    const runtime = createRuntime(config);
    const results = await runtime.agent.run(options.steps ? Number(options.steps) : config.maxSteps);
    console.log(JSON.stringify(results, null, 2));
    runtime.sqlite.close();
  });

program
  .command("ledger")
  .description("Print recent ledger entries")
  .action(async () => {
    const config = loadConfig();
    const runtime = createRuntime(config);
    const entries = await runtime.ledger.latest();
    console.log(JSON.stringify(entries, null, 2));
    runtime.sqlite.close();
  });

await program.parseAsync();
