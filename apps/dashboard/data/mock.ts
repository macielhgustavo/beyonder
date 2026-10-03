import type { DashboardDataSource } from "./source";
import type { AuditEventView, AuditQuery, MemoryQuery, MemoryView, PageQuery, TaskView } from "./types";

const now = Date.now();
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

const tasks: TaskView[] = [
  {
    id: "task_demo_01",
    title: "Analyze provider availability and route a coding task",
    type: "coding",
    complexity: "medium",
    provider: "Groq",
    model: "Qwen 3 Coder",
    attempts: 1,
    evaluation: 0.91,
    costUsd: 0,
    durationMs: 1840,
    status: "succeeded",
    createdAt: iso(7),
    provenance: "mock",
    steps: [
      { label: "Objective", detail: "Route a coding task", state: "complete" },
      { label: "Classification", detail: "coding · medium", state: "complete" },
      { label: "Memory retrieved", detail: "3 relevant memories", state: "complete" },
      { label: "Plan", detail: "single-model execution", state: "complete" },
      { label: "Model selected", detail: "Qwen 3 Coder / Groq", state: "complete" },
      { label: "Execution", detail: "1 attempt", state: "complete" },
      { label: "Evaluation", detail: "0.91", state: "complete" },
      { label: "Outcome", detail: "stored", state: "complete" }
    ]
  }
];

const memories: MemoryView[] = [
  { id: "mem_demo_01", kind: "episodic", content: "A zero-cost coding route completed successfully with one attempt.", importance: 4, utility: 0.84, confidence: 0.95, createdAt: iso(8), lastAccessedAt: iso(3), accessCount: 2, source: "task-outcome", taskId: "task_demo_01", keywords: ["coding", "zero-cost", "routing"], provenance: "mock" },
  { id: "mem_demo_02", kind: "semantic", content: "Provider health should be checked before model utility is compared.", importance: 5, utility: 0.91, confidence: 0.9, createdAt: iso(94), lastAccessedAt: iso(12), accessCount: 7, source: "consolidation", keywords: ["provider", "health"], provenance: "mock" },
  { id: "mem_demo_03", kind: "economic", content: "Prefer resources with zero monetary spend while economic state is constrained.", importance: 5, utility: 0.88, confidence: 0.92, createdAt: iso(160), lastAccessedAt: iso(20), accessCount: 5, source: "policy-observation", keywords: ["economy", "cost"], provenance: "mock" },
  { id: "mem_demo_04", kind: "procedural", content: "Classify, retrieve context, select provider/model, execute, evaluate, persist outcome.", importance: 5, utility: 0.93, confidence: 0.96, createdAt: iso(260), lastAccessedAt: iso(40), accessCount: 13, source: "runtime", keywords: ["workflow"], provenance: "mock" }
];

const audit: AuditEventView[] = [
  { id: "audit_demo_01", level: "info" as const, event: "task.created", details: { taskId: "task_demo_01" }, createdAt: iso(8), provenance: "mock" as const },
  { id: "audit_demo_02", level: "info" as const, event: "task.classified", details: { type: "coding", complexity: "medium" }, createdAt: iso(7.8), provenance: "mock" as const },
  { id: "audit_demo_03", level: "info" as const, event: "memory.retrieved", details: { count: 3 }, createdAt: iso(7.5), provenance: "mock" as const },
  { id: "audit_demo_04", level: "info" as const, event: "router.selected", details: { provider: "Groq", model: "Qwen 3 Coder", utility: 0.87 }, createdAt: iso(7.2), provenance: "mock" as const },
  { id: "audit_demo_05", level: "info" as const, event: "evaluation.completed", details: { score: 0.91 }, createdAt: iso(6.6), provenance: "mock" as const },
  { id: "audit_demo_06", level: "warn" as const, event: "provider.rate_limit.near", details: { provider: "Kilo", remainingPercent: 12 }, createdAt: iso(38), provenance: "mock" as const }
];

export class MockDashboardDataSource implements DashboardDataSource {
  readonly provenance = "mock" as const;

  async getOverview() {
    return {
      runtimeStatus: "online" as const,
      economicState: "survival" as const,
      capitalUsd: 0,
      balanceUsd: 0,
      readyProviders: 4,
      totalProviders: 5,
      currentTask: null,
      requestsToday: 38,
      monetaryCostUsd: 0,
      effectiveResourceCost: 0.17,
      memoryCount: 128,
      successRate: 0.92,
      freeResources: 4,
      recentDecisions: [{
        id: "decision_demo_01",
        selectedLabel: "Qwen 3 Coder / Groq",
        utility: 0.87,
        reasons: [
          { label: "coding capability", value: 0.91 },
          { label: "historical success", value: 0.86 },
          { label: "monetary cost", value: "$0" },
          { label: "provider health", value: "healthy" }
        ],
        penalties: [
          { label: "quota scarcity", value: 0.07 },
          { label: "latency", value: 0.03 }
        ],
        alternatives: [
          { label: "Llama / Kilo", utility: 0.82 },
          { label: "Mistral / OVH", utility: 0.74 }
        ],
        decidedAt: iso(7.2),
        taskId: "task_demo_01",
        provenance: "mock" as const
      }],
      recentErrors: audit.filter((event) => event.level === "warn" || event.level === "error"),
      modelUsage: [
        { label: "Qwen / Groq", value: 48 },
        { label: "Llama / Kilo", value: 28 },
        { label: "Mistral / OVH", value: 16 },
        { label: "AI Horde", value: 8 }
      ],
      provenance: this.provenance
    };
  }

  async getEconomy() {
    return {
      balanceUsd: 0,
      capitalUsd: 0,
      revenueUsd: 0,
      expensesUsd: 0,
      runwayDays: null,
      monetarySpendUsd: 0,
      shadowSpend: 6.41,
      quotas: [
        { label: "Groq daily requests", used: 38, limit: 1000, unit: "req" },
        { label: "Kilo daily requests", used: 44, limit: 50, unit: "req" },
        { label: "OVH daily requests", used: 11, limit: 100, unit: "req" }
      ],
      economicState: "survival" as const,
      history: [
        { at: iso(1440 * 6), balanceUsd: 0, revenueUsd: 0, expensesUsd: 0 },
        { at: iso(1440 * 5), balanceUsd: 0, revenueUsd: 0, expensesUsd: 0 },
        { at: iso(1440 * 4), balanceUsd: 0, revenueUsd: 0, expensesUsd: 0 },
        { at: iso(1440 * 3), balanceUsd: 0, revenueUsd: 0, expensesUsd: 0 },
        { at: iso(1440 * 2), balanceUsd: 0, revenueUsd: 0, expensesUsd: 0 },
        { at: iso(1440), balanceUsd: 0, revenueUsd: 0, expensesUsd: 0 },
        { at: iso(0), balanceUsd: 0, revenueUsd: 0, expensesUsd: 0 }
      ],
      provenance: this.provenance
    };
  }

  async getProviders(query: PageQuery = {}) {
    return paginate([
      { id: "groq", name: "Groq", status: "READY" as const, models: 6, quota: "healthy", latencyMs: 182, health: 0.99, auth: "key" as const, lastCheckAt: iso(2), provenance: "mock" as const },
      { id: "kilo", name: "Kilo", status: "RATE_LIMITED" as const, models: 4, quota: "12% left", latencyMs: 420, health: 0.82, auth: "key" as const, lastCheckAt: iso(3), note: "Approaching request quota", provenance: "mock" as const },
      { id: "ovh", name: "OVH", status: "READY" as const, models: 3, quota: "89% left", latencyMs: 690, health: 0.95, auth: "key" as const, lastCheckAt: iso(4), provenance: "mock" as const },
      { id: "ai-horde", name: "AI Horde", status: "KEYLESS" as const, models: 11, quota: "community", latencyMs: 1800, health: 0.71, auth: "keyless" as const, lastCheckAt: iso(6), provenance: "mock" as const },
      { id: "manual", name: "Manual provider", status: "HUMAN_GATE" as const, models: null, quota: null, latencyMs: null, health: null, auth: "unknown" as const, lastCheckAt: iso(61), provenance: "mock" as const }
    ], query);
  }

  async getModels(query: PageQuery = {}) {
    return paginate([
      { id: "qwen-groq", name: "Qwen 3 Coder", provider: "Groq", capabilities: { coding: 0.91, reasoning: 0.79, structured: 0.88, extraction: 0.84 }, usage: 48, latencyMs: 182, successRate: 0.94, effectiveCost: 0.08, benchmarkAvailable: false, provenance: "mock" as const },
      { id: "llama-kilo", name: "Llama", provider: "Kilo", capabilities: { coding: 0.82, reasoning: 0.85, planning: 0.8, "tool-use": 0.77 }, usage: 28, latencyMs: 420, successRate: 0.9, effectiveCost: 0.14, benchmarkAvailable: false, provenance: "mock" as const },
      { id: "mistral-ovh", name: "Mistral", provider: "OVH", capabilities: { reasoning: 0.8, structured: 0.91, compression: 0.86 }, usage: 16, latencyMs: 690, successRate: 0.87, effectiveCost: 0.2, benchmarkAvailable: false, provenance: "mock" as const }
    ], query);
  }

  async getTasks(query: PageQuery = {}) { return paginate(tasks, query); }

  async getMemories(query: MemoryQuery = {}) {
    const search = query.search?.trim().toLowerCase();
    const filtered = memories.filter((memory) => (query.kind && query.kind !== "all" ? memory.kind === query.kind : true))
      .filter((memory) => search ? `${memory.content} ${memory.keywords.join(" ")}`.toLowerCase().includes(search) : true);
    return paginate(filtered, query);
  }

  async getAuditEvents(query: AuditQuery = {}) {
    const search = query.search?.trim().toLowerCase();
    const filtered = audit.filter((event) => (query.level && query.level !== "all" ? event.level === query.level : true))
      .filter((event) => search ? `${event.event} ${JSON.stringify(event.details)}`.toLowerCase().includes(search) : true);
    return paginate(filtered, query);
  }
}

function paginate<T>(items: T[], query: PageQuery): T[] {
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.min(100, Math.max(1, query.limit ?? 50));
  return items.slice(offset, offset + limit);
}
