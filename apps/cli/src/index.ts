#!/usr/bin/env node
import { Command } from "commander";
import { existsSync } from "node:fs";
import {
  DEFAULT_TASK_BUDGET,
  inspectTaskTrace,
  classifyFailure,
  classifyEconomicState,
  createRuntime,
  loadConfig,
  OpportunityEvaluator,
  validatePlan,
  type IntelligenceTaskType
} from "@beyonder/runtime";
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
          goalContract: inspection.task.goalContract,
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
  .option("--provider <id>", "qualify one configured provider")
  .option("--models <ids>", "comma-separated explicit live model ids; zero-price eligibility still applies")
  .option("--categories <names>", "comma-separated capability categories to measure")
  .option("--reasoning-mode <mode>", "qualify low or disabled optional reasoning; scores remain specific to the measured profile")
  .action(async (options: { smoke?: boolean; standard?: boolean; db?: string; provider?: string; models?: string; categories?: string; reasoningMode?: string }, command: Command) => {
    const mode = benchmarkMode(options);
    if (options.reasoningMode && !["low", "disabled"].includes(options.reasoningMode)) throw new Error("reasoning-mode must be low or disabled.");
    const config = loadConfig();
    const state = await new AutopilotStateStore(config.model.providerStatePath).read();
    const broker = await credentialBroker();
    const targets = selectFreeModelTargets(state, broker, { provider: options.provider, models: options.models?.split(",").map(model => model.trim()).filter(Boolean), reasoningMode: options.reasoningMode as "low" | "disabled" | undefined });
    if (!targets.length) {
      console.log("MODEL PERFORMANCE\n\nNo READY zero-cost benchmark models available. monetary cost: $0.00");
      return;
    }

    const results = await runBenchmark({
      mode,
      targets,
      categories: options.categories?.split(",").map(category => parseBenchmarkCategory(category.trim())),
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

const taskCommand = program.command("task").description("Run and inspect autonomous task executions");

taskCommand
  .command("run")
  .argument("<objective>", "objective to execute")
  .description("Run a bounded v0.4 task execution using the routed structured planner")
  .action(async (objective: string) => {
    const config = loadConfig();
    const runtime = createBeyonderRuntime(config);
    await runtime.ledger.initialize(config.startingCapitalUsd);
    const summary = await runtime.ledger.summary(config.monthlyFixedCostUsd);
    const economicState = classifyEconomicState(summary);
    const inspection = await runtime.intelligence.inspect(objective);
    try {
    const availableTools = await runtime.getAvailableTools({ taskId: inspection.task.id, economicState });
    const plan = await runtime.planner.createPlan({
      objective,
      task: inspection.task,
      memoryContext: inspection.relevantMemories,
      availableTools,
      budget: DEFAULT_TASK_BUDGET,
      economicState
    });
    const validation = validatePlan(plan, { availableTools, budget: DEFAULT_TASK_BUDGET });
    if (!validation.valid) {
      console.log(JSON.stringify({ status: "INVALID_PLAN", issues: validation.issues }, null, 2));
      runtime.sqlite.close();
      return;
    }
    const outcome = await runtime.taskExecutor.execute({
      task: inspection.task,
      plan: validation.plan,
      initialUsage: { monetaryCostUsd: runtime.planner.lastResult?.monetaryCostUsd ?? 0, shadowCostUsd: runtime.planner.lastResult?.shadowCostUsd ?? 0 },
      economicState
    });
    console.log(JSON.stringify({
      taskId: inspection.task.id,
      executionId: outcome.execution.id,
      status: outcome.status,
      failureReason: outcome.failureReason,
      failureClass: outcome.execution.failure?.failureClass,
      phase: outcome.execution.failure?.phase,
      lastProvider: outcome.execution.attempts?.filter((a) => a.phase !== "TOOL_EXECUTION").at(-1)?.provider,
      lastModel: outcome.execution.attempts?.filter((a) => a.phase !== "TOOL_EXECUTION").at(-1)?.model,
      attemptCount: outcome.execution.attempts?.length ?? 0,
      planner: runtime.planner.lastResult ? {
        provider: runtime.planner.lastResult.provider,
        model: runtime.planner.lastResult.model,
        usedFallback: runtime.planner.lastResult.usedFallback,
        revision: outcome.execution.plan.revision
      } : undefined,
      result: outcome.result,
      stepsExecuted: outcome.execution.usage.steps,
      toolInvocations: outcome.execution.usage.toolInvocations,
      checkpoints: outcome.execution.checkpoints.length,
      monetaryCostUsd: outcome.execution.usage.monetaryCostUsd,
      shadowCostUsd: outcome.execution.usage.shadowCostUsd
    }, null, 2));
    } catch (error) {
      const attempts = await runtime.modelRouter.attemptsFor(inspection.task.id);
      const last = attempts.at(-1);
      const failure = classifyFailure(error);
      console.log(JSON.stringify({ taskId: inspection.task.id, status: "FAILED", failureReason: failure.message, failureClass: failure.failureClass, phase: last?.phase ?? "PLANNING", lastProvider: last?.provider, lastModel: last?.model, attemptCount: attempts.length }, null, 2));
    } finally { await runtime.browser.closeAll(); if (runtime.sqlite.open) runtime.sqlite.close(); }
  });

taskCommand
  .command("resume")
  .argument("<task-id>", "task id to resume from its latest checkpoint")
  .description("Resume a non-terminal task without repeating completed steps")
  .action(async (taskId: string) => {
    const config = loadConfig();
    const runtime = createBeyonderRuntime(config);
    const checkpoint = await runtime.checkpoints.get(taskId);
    if (!checkpoint) {
      console.log(JSON.stringify({ taskId, status: "CHECKPOINT_NOT_FOUND" }, null, 2));
      runtime.sqlite.close();
      return;
    }
    const summary = await runtime.ledger.summary(config.monthlyFixedCostUsd);
    const outcome = await runtime.taskExecutor.resume({
      execution: checkpoint,
      economicState: classifyEconomicState(summary)
    });
    console.log(JSON.stringify({
      taskId,
      executionId: outcome.execution.id,
      status: outcome.status,
      result: outcome.result,
      completedSteps: outcome.execution.plan.steps.filter((step) => step.status === "COMPLETED").map((step) => step.id),
      toolInvocations: outcome.execution.usage.toolInvocations,
      retries: outcome.execution.usage.retries,
      replans: outcome.execution.usage.replans,
      monetaryCostUsd: outcome.execution.usage.monetaryCostUsd,
      shadowCostUsd: outcome.execution.usage.shadowCostUsd
    }, null, 2));
    runtime.sqlite.close();
  });

taskCommand
  .command("inspect")
  .argument("<taskId>", "task id to inspect")
  .description("Inspect persisted execution, plan, attempts, routes, tools, checkpoints and memory")
  .action(async (taskId: string) => {
    const runtime = createBeyonderRuntime(loadConfig());
    console.log(JSON.stringify(await inspectTaskTrace(runtime, taskId), null, 2));
    runtime.sqlite.close();
  });
const providers = program.command("providers").description("Manage compute providers");

const opportunities = program.command("opportunities").description("Discover and inspect economic opportunities without taking external action");

const work = program.command("work").description("Manage persistent real-work runs without bypassing approval gates");

work.command("list").description("List work runs").action(async () => { const runtime = createBeyonderRuntime(loadConfig()); console.log(JSON.stringify(await runtime.workRunManager.list(), null, 2)); runtime.sqlite.close(); });
work.command("inspect").argument("<work-run-id>").description("Inspect one work run").action(async (id: string) => { const runtime = createBeyonderRuntime(loadConfig()); console.log(JSON.stringify(await runtime.workRunManager.inspect(id) ?? { id, status: "NOT_FOUND" }, null, 2)); runtime.sqlite.close(); });
work.command("status").argument("<work-run-id>").description("Show current work-run state").action(async (id: string) => { const runtime = createBeyonderRuntime(loadConfig()); const run = await runtime.workRunManager.inspect(id); console.log(JSON.stringify(run ? { id: run.id, state: run.state, opportunityId: run.opportunityId, taskId: run.taskId, estimatedRewardUsd: run.estimatedRewardUsd, simulatedRewardUsd: run.simulatedRewardUsd ?? 0, realizedRewardUsd: run.realizedRewardUsd, monetaryCostUsd: run.monetaryCostUsd, shadowCostUsd: run.shadowCostUsd } : { id, status: "NOT_FOUND" }, null, 2)); runtime.sqlite.close(); });
work.command("start").argument("<opportunity-id>").description("Create a work run and prepare its application").action(async (opportunityId: string) => { const runtime = createBeyonderRuntime(loadConfig()); const created = await runtime.workRunManager.start(opportunityId); const run = await runtime.workRunManager.prepareApplication(created.id); console.log(JSON.stringify(run, null, 2)); runtime.sqlite.close(); });
work.command("send-application").argument("<work-run-id>").description("Send an approved application through the configured adapter").action(async (id: string) => { const runtime = createBeyonderRuntime(loadConfig()); console.log(JSON.stringify(await runtime.workRunManager.sendApplication(id), null, 2)); runtime.sqlite.close(); });
work.command("settlement").argument("<work-run-id>").description("Inspect settlement state and realized revenue").action(async (id: string) => { const runtime = createBeyonderRuntime(loadConfig()); const run = await runtime.workRunManager.inspect(id); console.log(JSON.stringify({ workRunId: id, state: run?.state, settlement: run?.settlement, realizedRewardUsd: run?.realizedRewardUsd ?? 0 }, null, 2)); runtime.sqlite.close(); });
work.command("record-settlement").argument("<work-run-id>").requiredOption("--amount <amount>", "explicit settled amount").requiredOption("--currency <currency>", "USD or USDC").option("--source <source>", "provenance source").option("--reference <reference>", "external payment reference").option("--observed-at <timestamp>", "observation timestamp").description("Record explicit settlement evidence; never mark paid without provenance").action(async (id: string, options: { amount: string; currency: string; source?: string; reference?: string; observedAt?: string }) => { const runtime = createBeyonderRuntime(loadConfig()); const run = await runtime.workRunManager.recordSettlement(id, { type: options.reference ? "EXTERNAL_REFERENCE" : "MANUAL_CONFIRMED", amount: Number(options.amount), currency: options.currency, source: options.source, externalReference: options.reference, observedAt: options.observedAt ?? new Date().toISOString() }); console.log(JSON.stringify(run, null, 2)); runtime.sqlite.close(); });

economy.command("revenue").description("Report realized versus simulated revenue from persistent work runs").action(async () => { const runtime = createBeyonderRuntime(loadConfig()); const runs = await runtime.workRunManager.list(); console.log(JSON.stringify({ realizedRevenueUsd: runs.reduce((sum, run) => sum + run.realizedRewardUsd, 0), simulatedRevenueUsd: runs.reduce((sum, run) => sum + (run.simulatedRewardUsd ?? 0), 0), activeWork: runs.filter((run) => !["COMPLETED", "FAILED", "CANCELLED", "EXPIRED"].includes(run.state)).length, awaitingApproval: runs.filter((run) => ["AWAITING_APPLICATION_APPROVAL", "AWAITING_SUBMISSION_APPROVAL"].includes(run.state)).length, awaitingSettlement: runs.filter((run) => run.state === "AWAITING_SETTLEMENT").length, totalRealMonetaryCostUsd: runs.reduce((sum, run) => sum + run.monetaryCostUsd, 0) }, null, 2)); runtime.sqlite.close(); });

const approvals = program.command("approvals").description("Inspect and decide explicit, single-use external-action approvals");

approvals
  .command("list")
  .description("List approval requests")
  .action(async () => {
    const runtime = createBeyonderRuntime(loadConfig());
    console.log(JSON.stringify(await runtime.approvals.list(), null, 2));
    runtime.sqlite.close();
  });

approvals
  .command("inspect")
  .argument("<approval-id>", "approval id")
  .description("Inspect one approval request")
  .action(async (approvalId: string) => {
    const runtime = createBeyonderRuntime(loadConfig());
    console.log(JSON.stringify(await runtime.approvals.inspect(approvalId) ?? { approvalId, status: "NOT_FOUND" }, null, 2));
    runtime.sqlite.close();
  });

approvals
  .command("approve")
  .argument("<approval-id>", "approval id")
  .description("Approve exactly one pending external action")
  .action(async (approvalId: string) => {
    const runtime = createBeyonderRuntime(loadConfig());
    console.log(JSON.stringify(await runtime.approvals.approve(approvalId), null, 2));
    runtime.sqlite.close();
  });

approvals
  .command("reject")
  .argument("<approval-id>", "approval id")
  .option("--reason <reason>", "human reason")
  .description("Reject exactly one pending external action")
  .action(async (approvalId: string, options: { reason?: string }) => {
    const runtime = createBeyonderRuntime(loadConfig());
    console.log(JSON.stringify(await runtime.approvals.reject(approvalId, options.reason), null, 2));
    runtime.sqlite.close();
  });

opportunities
  .command("discover")
  .option("-s, --source <source>", "source id", "fixture")
  .option("-l, --limit <limit>", "maximum opportunities", "20")
  .description("Discover and normalize read-only opportunities")
  .action(async (options: { source: string; limit: string }) => {
    const runtime = createBeyonderRuntime(loadConfig());
    const result = await runtime.opportunities.discover({ source: options.source, limit: Number(options.limit) });
    console.log(JSON.stringify(result, null, 2));
    runtime.sqlite.close();
  });

opportunities
  .command("list")
  .option("--status <status>", "filter by lifecycle status")
  .description("List persisted opportunities")
  .action(async (options: { status?: string }) => {
    const runtime = createBeyonderRuntime(loadConfig());
    console.log(JSON.stringify(await runtime.opportunities.list(options.status as never), null, 2));
    runtime.sqlite.close();
  });

opportunities
  .command("inspect")
  .argument("<id>", "opportunity id")
  .description("Inspect one persisted opportunity")
  .action(async (id: string) => {
    const runtime = createBeyonderRuntime(loadConfig());
    console.log(JSON.stringify(await runtime.opportunities.inspect(id), null, 2));
    runtime.sqlite.close();
  });

opportunities
  .command("evaluate")
  .argument("<id>", "opportunity id")
  .description("Evaluate value, feasibility, risk, and economic decision without external action")
  .action(async (id: string) => {
    const config = loadConfig();
    const runtime = createBeyonderRuntime(config);
    const opportunity = await runtime.opportunities.inspect(id);
    if (!opportunity) {
      console.log(JSON.stringify({ id, status: "NOT_FOUND" }, null, 2));
      runtime.sqlite.close();
      return;
    }
    await runtime.ledger.initialize(config.startingCapitalUsd);
    const summary = await runtime.ledger.summary(config.monthlyFixedCostUsd);
    const evaluation = await new OpportunityEvaluator({
      memory: runtime.memory,
      economicState: classifyEconomicState(summary)
    }, runtime.opportunityStore).evaluate(opportunity);
    console.log(JSON.stringify(evaluation, null, 2));
    runtime.sqlite.close();
  });

opportunities
  .command("health")
  .description("Show operational health and reliability history for discovery sources")
  .action(async () => {
    const runtime = createBeyonderRuntime(loadConfig());
    console.log(JSON.stringify(await runtime.sourceReliability.all(), null, 2));
    runtime.sqlite.close();
  });

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
  return new CredentialBroker().prepare();
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
