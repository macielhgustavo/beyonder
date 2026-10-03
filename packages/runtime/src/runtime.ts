import { AuditLog } from "./audit/audit-log.js";
import type { AppConfig } from "./config/env.js";
import type Database from "better-sqlite3";
import { openDatabase, type Db } from "./db/client.js";
import { EconomicLedger } from "./economy/ledger.js";
import { MemoryEngine } from "./memory/memory-engine.js";
import { MemoryStore } from "./memory/memory-store.js";
import { StateStore } from "./memory/state-store.js";
import { ModelRouter } from "./models/model-router.js";
import { AgentLoop } from "./agent/agent-loop.js";
import { createToolRegistry } from "./tools/tool-registry.js";

export interface BeyonderRuntime {
  sqlite: Database.Database;
  db: Db;
  ledger: EconomicLedger;
  state: StateStore;
  memory: MemoryEngine;
  memoryStore: MemoryStore;
  modelRouter: ModelRouter;
  audit: AuditLog;
  tools: ReturnType<typeof createToolRegistry>;
  agent: AgentLoop;
}

export function createRuntime(config: AppConfig): BeyonderRuntime {
  const { db, sqlite } = openDatabase(config.dbPath);
  const ledger = new EconomicLedger(db);
  const state = new StateStore(db);
  const memoryStore = new MemoryStore(db);
  const memory = new MemoryEngine(memoryStore);
  const modelRouter = new ModelRouter(config.model);
  const audit = new AuditLog(db);
  const tools = createToolRegistry(config.tools);
  const agent = new AgentLoop(config, ledger, state, memory, modelRouter, audit, tools);

  return { sqlite, db, ledger, state, memory, memoryStore, modelRouter, audit, tools, agent };
}
