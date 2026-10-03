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
import { StateTaskCheckpointStore } from "./tasks/checkpoints.js";
import { StateOpportunityStore } from "./opportunities/store.js";
import { OpportunityEngine } from "./opportunities/engine.js";
import { DeterministicFixtureOpportunitySource, GitHubPublicOpportunitySource, AgentWorkPublicOpportunitySource } from "./opportunities/sources.js";
import { OpportunityEvaluator, OpportunityQueue } from "./opportunities/evaluator.js";
import { ApprovalGate } from "./opportunities/approval.js";
import { FixtureApplicationAdapter, FixtureSubmissionAdapter, OpportunityBridge } from "./opportunities/bridge.js";
import type { ToolContext, ToolDescriptor, ToolExecutor, ToolRegistry } from "@beyonder/tools";

export interface BeyonderRuntime {
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
  agent: AgentLoop;
}

export interface RuntimeOptions {
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
  const performance = new MemoryPerformanceRepository(memoryStore);
  const audit = new AuditLog(db);
  const modelRouter = new ModelRouter(config.model, { performanceRepository: performance, capabilitySource: options.capabilitySource, telemetry: audit });
  const adaptiveExecution = new AdaptiveExecutionController(modelRouter, evaluation, audit);
  const tools = createRuntimeToolRegistry(config.tools);
  const toolExecutor = createRuntimeToolExecutor(tools, audit);
  const getAvailableTools = (context: ToolContext = {}) => tools.getAvailableTools(context, toolExecutor.policy);
  const checkpoints = new StateTaskCheckpointStore(state);
  const planner = new LlmPlanner({ modelRouter, memory });
  const opportunityStore = new StateOpportunityStore(state);
  const opportunities = new OpportunityEngine([
    new DeterministicFixtureOpportunitySource(),
    new GitHubPublicOpportunitySource(),
    new AgentWorkPublicOpportunitySource()
  ], opportunityStore, audit);
  const opportunityEvaluator = new OpportunityEvaluator({ memory }, opportunityStore);
  const opportunityQueue = new OpportunityQueue(opportunityStore);
  const approvals = new ApprovalGate(state, audit);
  const opportunityBridge = new OpportunityBridge(approvals, new FixtureApplicationAdapter(), new FixtureSubmissionAdapter(), audit);
  const taskExecutorWithPlanner = new AutonomousTaskExecutor({
    memory,
    modelRouter,
    toolExecutor,
    getAvailableTools,
    telemetry: audit,
    planner,
    checkpointStore: checkpoints
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
    agent
  };
}
