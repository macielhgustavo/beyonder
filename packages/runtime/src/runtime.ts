import { BrowserAgent, PlaywrightBrowserSessionFactory, createBrowserToolDefinitions } from "@beyonder/browser-agent";
import { AuditLog } from "./audit/audit-log.js";
import type { AppConfig } from "./config/env.js";
import type Database from "better-sqlite3";
import { openDatabase, type Db } from "./db/client.js";
import { EconomicLedger } from "./economy/ledger.js";
import { IntelligenceLayer } from "./intelligence/intelligence-layer.js";
import { AdaptiveExecutionController } from "./intelligence/adaptive-execution-controller.js";
import { EvaluationLayer } from "./intelligence/evaluation-layer.js";
import { MemoryEngine } from "./memory/memory-engine.js";
import { MemoryStore } from "./memory/memory-store.js";
import { StateStore } from "./memory/state-store.js";
import { ModelRouter } from "./models/model-router.js";
import { MemoryPerformanceRepository } from "./models/performance-repository.js";
import type { ModelCapabilitySource } from "./models/capability-source.js";
import { AgentLoop } from "./agent/agent-loop.js";
import { createRuntimeToolExecutor, createRuntimeToolRegistry } from "./tools/runtime-tools.js";
import { AutonomousTaskExecutor } from "./tasks/task-executor.js";
import { LlmPlanner } from "./tasks/llm-planner.js";
import { ModelObjectiveVerifier } from "./tasks/model-objective-verifier.js";
import { createActionPlanner } from "./tasks/action-planner.js";
import { StateTaskCheckpointStore } from "./tasks/checkpoints.js";
import { StateTaskExecutionLeaseStore } from "./tasks/execution-lease.js";
import { StateOpportunityStore } from "./opportunities/store.js";
import { OpportunityEngine } from "./opportunities/engine.js";
import { DeterministicFixtureOpportunitySource, GitHubPublicOpportunitySource, AgentWorkPublicOpportunitySource, OpenBountyPublicOpportunitySource } from "./opportunities/sources.js";
import { OpportunityEvaluator, OpportunityQueue } from "./opportunities/evaluator.js";
import { ApprovalGate } from "./opportunities/approval.js";
import { FixtureApplicationAdapter, FixtureSubmissionAdapter, ManualApplicationAdapter, ManualSubmissionAdapter, OpportunityBridge } from "./opportunities/bridge.js";
import { SourceReliabilityStore } from "./opportunities/source-health.js";
import { StateWorkRunStore, WorkRunManager } from "./opportunities/work-run.js";
import type { ToolContext, ToolDescriptor, ToolExecutor, ToolRegistry } from "@beyonder/tools";

export interface BeyonderRuntime {
  browser: BrowserAgent;
  sqlite: Database.Database;
  db: Db;
  ledger: EconomicLedger;
  state: StateStore;
  memory: MemoryEngine;
  memoryStore: MemoryStore;
  intelligence: IntelligenceLayer;
  evaluation: EvaluationLayer;
  performance: MemoryPerformanceRepository;
  modelRouter: ModelRouter;
  adaptiveExecution: AdaptiveExecutionController;
  audit: AuditLog;
  tools: ToolRegistry;
  toolExecutor: ToolExecutor;
  getAvailableTools(context?: ToolContext): Promise<readonly ToolDescriptor[]>;
  taskExecutor: AutonomousTaskExecutor;
  planner: LlmPlanner;
  checkpoints: StateTaskCheckpointStore;
  opportunities: OpportunityEngine;
  opportunityStore: StateOpportunityStore;
  opportunityEvaluator: OpportunityEvaluator;
  opportunityQueue: OpportunityQueue;
  approvals: ApprovalGate;
  opportunityBridge: OpportunityBridge;
  sourceReliability: SourceReliabilityStore;
  workRuns: StateWorkRunStore;
  workRunManager: WorkRunManager;
  agent: AgentLoop;
}

export interface RuntimeOptions {
  economicEvidence?: import('./models/model-router.js').ModelRouterOptions['economicEvidence'];
  fixture?: boolean;
  onProgress?: (execution: import("./tasks/contracts.js").TaskExecution) => Promise<void>;
  beforeStep?: () => Promise<void>;
  isPaused?: () => Promise<boolean>;
  capabilitySource?: ModelCapabilitySource;
}

export function createRuntime(config: AppConfig, options: RuntimeOptions = {}): BeyonderRuntime {
  const { db, sqlite } = openDatabase(config.dbPath);
  const ledger = new EconomicLedger(db);
  const state = new StateStore(db);
  const memoryStore = new MemoryStore(db);
  const memory = new MemoryEngine(memoryStore);
  const intelligence = new IntelligenceLayer(memory);
  const evaluation = new EvaluationLayer();
  const performance = new MemoryPerformanceRepository(memoryStore, async taskId => {
    try {
      const checkpoint = await state.get<{ execution?: { objectiveStatus?: string; objectiveVerification?: { objectiveStatus?: string } } } | null>(`task-checkpoint:${taskId}`, null);
      return checkpoint?.execution?.objectiveVerification?.objectiveStatus ?? checkpoint?.execution?.objectiveStatus;
    } catch { return undefined; }
  });
  const audit = new AuditLog(db);
  const modelRouter = new ModelRouter(config.model, { state, performanceRepository: performance, capabilitySource: options.capabilitySource, economicEvidence: options.economicEvidence, telemetry: audit });
  const adaptiveExecution = new AdaptiveExecutionController(modelRouter, evaluation, audit);
  const browser = new BrowserAgent({ sessionFactory: new PlaywrightBrowserSessionFactory(), telemetry: { emit: async (event) => { await audit.record("info", event.name, event.details); } } });
  const tools = createRuntimeToolRegistry(config.tools, options.fixture === true);
  if (!options.fixture && config.tools.browser) tools.registerMany(createBrowserToolDefinitions(browser).filter((tool) => tool.sideEffects === "READ" || tool.sideEffects === "NONE"));
  const toolExecutor = createRuntimeToolExecutor(tools, audit);
  const getAvailableTools = (context: ToolContext = {}) => tools.getAvailableTools(context, toolExecutor.policy);
  const checkpoints = new StateTaskCheckpointStore(state);
  const executionLeases = new StateTaskExecutionLeaseStore(state);
  const planner = new LlmPlanner({ modelRouter, memory, allowDeterministicFallback: options.fixture === true });
  const opportunityStore = new StateOpportunityStore(state);
  const sourceReliability = new SourceReliabilityStore(state);
  const opportunities = new OpportunityEngine([
    ...(options.fixture ? [new DeterministicFixtureOpportunitySource()] : []),
    new GitHubPublicOpportunitySource(),
    new AgentWorkPublicOpportunitySource(),
    new OpenBountyPublicOpportunitySource()
  ], opportunityStore, audit, sourceReliability);
  const opportunityEvaluator = new OpportunityEvaluator({ memory }, opportunityStore);
  const opportunityQueue = new OpportunityQueue(opportunityStore);
  const approvals = new ApprovalGate(state, audit);
  const opportunityBridge = new OpportunityBridge(approvals, options.fixture ? new FixtureApplicationAdapter() : new ManualApplicationAdapter(), options.fixture ? new FixtureSubmissionAdapter() : new ManualSubmissionAdapter(), audit);
  const workRuns = new StateWorkRunStore(state);
  const workRunManager = new WorkRunManager(workRuns, opportunityStore, opportunityBridge, approvals, audit, memory);
  const taskExecutorWithPlanner = new AutonomousTaskExecutor({
    memory,
    modelRouter,
    toolExecutor,
    getAvailableTools,
    telemetry: audit,
    planner,
    onProgress: options.onProgress,
    beforeStep: options.beforeStep,
    isPaused: options.isPaused,
    actionPlanner: createActionPlanner(modelRouter, tools),
    checkpointStore: checkpoints,
    executionLeaseStore: executionLeases,
    completionEvaluator: options.fixture ? undefined : new ModelObjectiveVerifier(modelRouter)
  });
  const agent = new AgentLoop(
    config,
    ledger,
    state,
    memory,
    intelligence,
    modelRouter,
    adaptiveExecution,
    evaluation,
    audit,
    toolExecutor
  );

  return {
    browser,
    sqlite,
    db,
    ledger,
    state,
    memory,
    memoryStore,
    intelligence,
    evaluation,
    performance,
    modelRouter,
    adaptiveExecution,
    audit,
    tools,
    toolExecutor,
    getAvailableTools,
    taskExecutor: taskExecutorWithPlanner,
    planner,
    checkpoints,
    opportunities,
    opportunityStore,
    opportunityEvaluator,
    opportunityQueue,
    approvals,
    opportunityBridge,
    sourceReliability,
    workRuns,
    workRunManager,
    agent
  };
}
