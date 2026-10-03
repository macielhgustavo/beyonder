#!/usr/bin/env node
import { Command } from "commander";
import { classifyEconomicState, createRuntime, loadConfig } from "@beyonder/runtime";
import {
  AutopilotStateStore,
  buildComputeInventory,
  CredentialBroker,
  discoverProviders,
  getStatuses,
  ProviderAutopilotOrchestrator,
  redact,
  Vault
} from "@beyonder/compute";

const program = new Command();

program.name("beyonder").description("Beyonder autonomous economic agent").version("0.1.0");

program
  .command("run")
  .description("Run the Beyonder loop once or for a bounded number of steps")
  .argument("[objective]", "objective to execute", "Verify the runtime is alive and preserve capital.")
  .option("-s, --steps <steps>", "number of loop steps")
  .action(async (objective: string, options: { steps?: string }) => {
    const config = loadConfig();
    const runtime = createRuntime(config);
    const steps = options.steps ? Number(options.steps) : config.maxSteps;
    const results = await runtime.agent.run(steps, objective);
    console.log(JSON.stringify(results, null, 2));
    runtime.sqlite.close();
  });

program
  .command("status")
  .description("Print current runtime, economy, and compute status")
  .action(async () => {
    const config = loadConfig();
    const runtime = createRuntime(config);
    await runtime.ledger.initialize(config.startingCapitalUsd);
    const summary = await runtime.ledger.summary(config.monthlyFixedCostUsd);
    const state = await new AutopilotStateStore(config.model.providerStatePath).read();
    const inventory = buildComputeInventory(state);
    console.log(
      JSON.stringify(
        {
          agent: config.agentName,
          economicState: classifyEconomicState(summary),
          modelProvider: config.model.provider,
          readyCompute: inventory.filter((entry) => ["healthy", "keyless"].includes(entry.status)),
          summary
        },
        null,
        2
      )
    );
    runtime.sqlite.close();
  });

program
  .command("economy")
  .description("Print ledger summary and recent entries")
  .action(async () => {
    const config = loadConfig();
    const runtime = createRuntime(config);
    await runtime.ledger.initialize(config.startingCapitalUsd);
    const summary = await runtime.ledger.summary(config.monthlyFixedCostUsd);
    const entries = await runtime.ledger.latest();
    console.log(JSON.stringify({ economicState: classifyEconomicState(summary), summary, entries }, null, 2));
    runtime.sqlite.close();
  });

const providers = program.command("providers").description("Manage compute providers");

providers
  .command("autopilot [providerId]")
  .description("Discover, validate, and register free compute providers in dry-run mode by default")
  .option("--live-signup", "allow live signup attempts; human gates still stop safely")
  .action(async (providerId: string | undefined, options: { liveSignup?: boolean }) => {
    const broker = await credentialBroker();
    const orchestrator = new ProviderAutopilotOrchestrator(broker);
    const results = await orchestrator.run({ providerId, dryRun: !options.liveSignup, resumeOnly: false });
    printProviderProgress(results);
  });

providers
  .command("resume [providerId]")
  .description("Resume providers that are waiting, failed, or discovered")
  .action(async (providerId: string | undefined) => {
    const broker = await credentialBroker();
    const orchestrator = new ProviderAutopilotOrchestrator(broker);
    const results = await orchestrator.run({ providerId, dryRun: true, resumeOnly: true });
    printProviderProgress(results);
  });

providers
  .command("inventory")
  .description("Print compute inventory")
  .action(async () => {
    const config = loadConfig();
    const state = await new AutopilotStateStore(config.model.providerStatePath).read();
    console.log(JSON.stringify(buildComputeInventory(state), null, 2));
  });

providers
  .command("discover")
  .description("Discover the current FreeLLMAPI registry")
  .action(async () => {
    const result = await discoverProviders();
    console.log(JSON.stringify(result, null, 2));
  });

providers
  .command("status")
  .description("Print provider credential and validation status")
  .action(async () => {
    const broker = await credentialBroker();
    console.log(JSON.stringify(getStatuses(broker), null, 2));
  });

async function credentialBroker(): Promise<CredentialBroker> {
  const vault = new Vault();
  if (!(await vault.exists())) return new CredentialBroker();
  const password = process.env.PROVIDER_BOOTSTRAPPER_MASTER_PASSWORD;
  if (!password) return new CredentialBroker();
  return new CredentialBroker(await vault.read(password));
}

function printProviderProgress(results: Array<{ state: string; providerId: string; humanGate?: { kind: string; action: string }; lastError?: string }>) {
  for (const result of results) {
    const gate = result.humanGate ? ` - ${result.humanGate.kind}: ${result.humanGate.action}` : "";
    const error = result.lastError ? ` - ${redact(result.lastError)}` : "";
    console.log(`${result.state.padEnd(18)} ${result.providerId}${gate}${error}`);
  }
}

await program.parseAsync();
