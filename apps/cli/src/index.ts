#!/usr/bin/env node
import { Command } from "commander";
import { existsSync } from "node:fs";
import { classifyEconomicState, createRuntime, loadConfig, type IntelligenceTaskType } from "@beyonder/runtime";
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
import {
  BENCHMARK_CATEGORIES,
  BenchmarkStore,
  BibModelCapabilitySource,
  formatBenchmarkReport,
  formatRanking,
  OpenAiCompatibleBenchmarkClient,
  runBenchmark,
  selectFreeModelTargets,
  type BenchmarkCategory,
  type BenchmarkMode,
  type TelemetrySink
} from "@beyonder/benchmark";

const program = new Command();

program.name("beyonder").description("Beyonder autonomous economic agent").version("0.2.0");

program
  .command("run")
  .description("Run the Beyonder loop once or for a bounded number of steps")
  .argument("[objective]", "objective to execute", "Verify the runtime is alive and preserve capital.")
  .option("-s, --steps <steps>", "number of loop steps")
  .action(async (objective: string, options: { steps?: string }) => {
    const config = loadConfig();
    const runtime = createBeyonderRuntime(config);
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
    const runtime = createBeyonderRuntime(config);
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

const economy = program.command("economy").description("Inspect ledger and shadow-economy state");

economy.action(async () => {
  const config = loadConfig();
  const runtime = createBeyonderRuntime(config);
  await runtime.ledger.initialize(config.startingCapitalUsd);
  const summary = await runtime.ledger.summary(config.monthlyFixedCostUsd);
  const entries = await runtime.ledger.latest();
  console.log(JSON.stringify({ economicState: classifyEconomicState(summary), summary, entries }, null, 2));
  runtime.sqlite.close();
});

economy
  .command("quotas")
  .description("Print known and unknown provider quota signals used by shadow-cost accounting")
  .action(async () => {
    const runtime = createBeyonderRuntime(loadConfig());
    console.log(JSON.stringify(await runtime.modelRouter.quotas(), null, 2));
    runtime.sqlite.close();
  });

const memory = program.command("memory").description("Inspect Beyonder memory");

memory
  .command("stats")
  .description("Print memory counts by category")
  .action(async () => {
    const runtime = createBeyonderRuntime(loadConfig());
    console.log(JSON.stringify(await runtime.memory.stats(), null, 2));
    runtime.sqlite.close();
  });

memory
  .command("search")
  .description("Search memory using lexical, recency, importance, and utility scoring")
  .argument("<query>", "memory query")
  .option("-l, --limit <limit>", "maximum memories to return", "6")
  .action(async (query: string, options: { limit: string }) => {
    const runtime = createBeyonderRuntime(loadConfig());
    const results = await runtime.memory.retrieve({ query, limit: Number(options.limit) });
    console.log(
      JSON.stringify(
        results.map((entry) => ({
          id: entry.id,
          type: entry.kind,
          score: entry.score,
          importance: entry.importance,
          utility: entry.utility,
          accessCount: entry.accessCount,
          content: entry.content
        })),
        null,
        2
      )
    );
    runtime.sqlite.close();
  });

const intelligence = program.command("intelligence").description("Inspect Intelligence Layer decisions without executing a model");

intelligence
  .command("inspect")
  .argument("<taskText>", "task text to classify")
  .description("Classify a task, estimate complexity, and retrieve relevant memory")
  .action(async (taskText: string) => {
    const runtime = createBeyonderRuntime(loadConfig());
    const inspection = await runtime.intelligence.inspect(taskText);
    console.log(
      JSON.stringify(
        {
          type: inspection.task.type,
          complexity: inspection.task.complexity,
          risk: inspection.task.risk,
          estimatedTokens: inspection.task.estimatedTokens,
          requirements: inspection.task.requirements,
          relevantMemories: inspection.relevantMemories.length
        },
        null,
        2
      )
    );
    runtime.sqlite.close();
  });

intelligence
  .command("route")
  .argument("<taskText>", "task text to route without inference")
  .description("Dry-run adaptive routing and explain candidate utility")
  .action(async (taskText: string) => {
    const config = loadConfig();
    const runtime = createBeyonderRuntime(config);
    await runtime.ledger.initialize(config.startingCapitalUsd);
    const summary = await runtime.ledger.summary(config.monthlyFixedCostUsd);
    const economicState = classifyEconomicState(summary);
    const inspection = await runtime.intelligence.inspect(taskText);
    const route = await runtime.modelRouter.route(inspection.task, economicState);
    console.log(JSON.stringify(routeView(route), null, 2));
    runtime.sqlite.close();
  });

const benchmark = intelligence.command("benchmark").description("Run or inspect Beyonder Intelligence Benchmark results");

benchmark
  .option("--smoke", "run the tiny, cheap benchmark set")
  .option("--standard", "run the broader economical benchmark set")
  .option("--db <path>", "benchmark SQLite path")
  .action(async (options: { smoke?: boolean; standard?: boolean; db?: string }, command: Command) => {
    const mode = benchmarkMode(options);
    const config = loadConfig();
    const state = await new AutopilotStateStore(config.model.providerStatePath).read();
    const broker = await credentialBroker();
    const targets = selectFreeModelTargets(state, broker);
    if (!targets.length) {
      console.log("MODEL PERFORMANCE\n\nNo READY zero-cost benchmark models available. monetary cost: $0.00");
      return;
    }

    const results = await runBenchmark({
      mode,
      targets,
      client: new OpenAiCompatibleBenchmarkClient(),
      telemetry: new StderrTelemetrySink()
    });
    const store = new BenchmarkStore(resolveBenchmarkDbPath(options, command));
    store.saveResults(results);
    store.close();
    console.log(formatBenchmarkReport(results));
    console.log("");
    console.log(`models tested: ${targets.map((target) => `${target.model}/${target.provider}`).join(", ")}`);
  });

benchmark
  .command("report")
  .description("Print historical benchmark report")
  .option("--db <path>", "benchmark SQLite path")
  .action((options: { db?: string }, command: Command) => {
    const store = new BenchmarkStore(resolveBenchmarkDbPath(options, command));
    console.log(formatBenchmarkReport(store.summaries()));
    store.close();
  });

benchmark
  .command("rank")
  .argument("<category>", "benchmark category")
  .option("--db <path>", "benchmark SQLite path")
  .description("Rank models by benchmark-only capability")
  .action((category: string, options: { db?: string }, command: Command) => {
    const parsed = parseBenchmarkCategory(category);
    const store = new BenchmarkStore(resolveBenchmarkDbPath(options, command));
    console.log(formatRanking(parsed, store.summaries()));
    store.close();
  });

const models = program.command("models").description("Inspect adaptive model rankings and historical performance");

models
  .command("rank")
  .argument("<taskType>", "task type to rank")
  .description("Rank available models for a task type without inference")
  .action(async (taskTypeRaw: string) => {
    const taskType = parseTaskType(taskTypeRaw);
    const config = loadConfig();
    const runtime = createBeyonderRuntime(config);
    await runtime.ledger.initialize(config.startingCapitalUsd);
    const summary = await runtime.ledger.summary(config.monthlyFixedCostUsd);
    const economicState = classifyEconomicState(summary);
    const inspection = await runtime.intelligence.inspect(`Rank available intelligence for ${taskType} work`);
    const task = { ...inspection.task, type: taskType };
    const route = await runtime.modelRouter.route(task, economicState);
    console.log(JSON.stringify(routeView(route), null, 2));
    runtime.sqlite.close();
  });

models
  .command("inspect")
  .argument("<providerModel>", "provider/model reference")
  .option("-t, --task-type <taskType>", "task type for historical capability", "chat")
  .description("Inspect quota and real-outcome performance for one provider/model")
  .action(async (providerModel: string, options: { taskType: string }) => {
    const [provider, ...modelParts] = providerModel.split("/");
    const model = modelParts.join("/");
    if (!provider || !model) throw new Error("Expected provider/model.");
    const taskType = parseTaskType(options.taskType);
    const runtime = createBeyonderRuntime(loadConfig());
    const quotas = await runtime.modelRouter.quotas();
    const performance = await runtime.modelRouter.performanceFor(provider, model, taskType);
    console.log(JSON.stringify({
      provider,
      model,
      taskType,
      quota: quotas.find((entry) => entry.provider === provider) ?? null,
      performance
    }, null, 2));
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

function createBeyonderRuntime(config: ReturnType<typeof loadConfig>) {
  if (!existsSync(config.model.benchmarkDbPath)) return createRuntime(config);
  const benchmarkStore = new BenchmarkStore(config.model.benchmarkDbPath);
  return createRuntime(config, { capabilitySource: new BibModelCapabilitySource(benchmarkStore) });
}

function printProviderProgress(results: Array<{ state: string; providerId: string; humanGate?: { kind: string; action: string }; lastError?: string }>) {
  for (const result of results) {
    const gate = result.humanGate ? ` - ${result.humanGate.kind}: ${result.humanGate.action}` : "";
    const error = result.lastError ? ` - ${redact(result.lastError)}` : "";
    console.log(`${result.state.padEnd(18)} ${result.providerId}${gate}${error}`);
  }
}

function parseTaskType(value: string): IntelligenceTaskType {
  const valid: IntelligenceTaskType[] = [
    "chat", "reasoning", "coding", "research", "extraction", "classification", "planning", "tool-use", "browser", "memory", "compression"
  ];
  if (!valid.includes(value as IntelligenceTaskType)) throw new Error(`Unknown task type: ${value}`);
  return value as IntelligenceTaskType;
}

function routeView(route: Awaited<ReturnType<ReturnType<typeof createRuntime>["modelRouter"]["route"]>>) {
  return {
    task: {
      type: route.task.type,
      complexity: route.task.complexity,
      risk: route.task.risk,
      estimatedTokens: route.task.estimatedTokens
    },
    economicState: route.economicState,
    candidates: route.candidates.map((candidate, index) => ({
      rank: index + 1,
      provider: candidate.provider,
      model: candidate.model,
      utility: candidate.utility,
      predictedQuality: candidate.predictedQuality,
      capabilityEvidence: candidate.capabilityEvidence,
      historicalSuccess: candidate.historicalSuccess,
      monetaryCostUsd: candidate.monetaryCostUsd,
      shadowCostUsd: candidate.shadowCostUsd,
      effectiveResourceCost: candidate.effectiveResourceCost,
      explanation: candidate.explanation
    })),
    selected: route.selected ? {
      provider: route.selected.provider,
      model: route.selected.model,
      utility: route.selected.utility
    } : null,
    explored: route.explored,
    reason: route.reason
  };
}

function benchmarkMode(options: { smoke?: boolean; standard?: boolean }): BenchmarkMode {
  if (options.standard) return "standard";
  return "smoke";
}

function parseBenchmarkCategory(category: string): BenchmarkCategory {
  if (BENCHMARK_CATEGORIES.includes(category as BenchmarkCategory)) return category as BenchmarkCategory;
  throw new Error(`Unknown benchmark category "${category}". Use one of: ${BENCHMARK_CATEGORIES.join(", ")}`);
}

function resolveBenchmarkDbPath(options: { db?: string }, command: Command): string {
  return options.db ?? (command.parent?.opts() as { db?: string }).db ?? loadConfig().model.benchmarkDbPath;
}

class StderrTelemetrySink implements TelemetrySink {
  emit(event: string, details: Record<string, unknown>): void {
    process.stderr.write(`${JSON.stringify({ event, details, timestamp: new Date().toISOString() })}\n`);
  }
}

await program.parseAsync();
