import type {
  ApprovalView,
  AuditEventView,
  AuditQuery,
  DashboardDataSource,
  MemoryQuery,
  MemoryView,
  ModelDecisionView,
  PageQuery,
  ProviderView,
  TaskView
} from "./types";

const now = Date.now();
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

const tasks: TaskView[] = [{
  id: "demo-task",
  title: "Procure oportunidades de programacao que valham a pena.",
  humanStatus: "Concluido. Encontrou uma oportunidade interessante.",
  status: "succeeded",
  result: "1 oportunidade parece valer analise humana.",
  provider: "Groq",
  model: "Qwen",
  costUsd: 0,
  shadowCostUsd: 0.01,
  durationMs: 8200,
  startedAt: iso(12),
  completedAt: iso(10),
  steps: [
    { label: "Entender objetivo", state: "complete" },
    { label: "Pesquisar fontes", detail: "GitHub e marketplaces publicos", state: "complete" },
    { label: "Avaliar custo e risco", state: "complete" },
    { label: "Preparar proxima decisao", state: "complete" }
  ],
  why: ["Qwen/Groq foi selecionado por bom historico em coding e custo monetario zero."],
  technicalId: "task_demo_01",
  provenance: "mock"
}];

const opportunities = [{
  id: "demo-opp",
  title: "Corrigir parser TypeScript",
  source: "GitHub",
  rewardLabel: "$25.00",
  deadlineLabel: "Hoje",
  feasibility: "Executavel",
  estimatedSuccessLabel: "82%",
  estimatedCostLabel: "$0.00",
  riskLabel: "Baixo",
  decisionLabel: "Vale a pena analisar.",
  confidenceLabel: "80%",
  humanSummary: "Recompensa explicita, custo monetario zero e boa compatibilidade com coding.",
  why: ["recompensa explicita de $25", "alta compatibilidade com coding", "nenhuma acao externa sem aprovacao"],
  canPrepareApplication: true,
  technicalId: "opp_demo_01",
  provenance: "mock" as const
}];

const approvals: ApprovalView[] = [{
  id: "demo-approval",
  title: "Enviar candidatura",
  destination: "GitHub",
  opportunityTitle: "Corrigir parser TypeScript",
  rewardLabel: "$25.00",
  payloadPreview: "Proposta curta explicando abordagem, prazo e criterios de aceite.",
  riskLabel: "Baixo",
  risks: ["acao externa limitada a esta candidatura"],
  status: "PENDING",
  createdAt: iso(9),
  expiresAt: null,
  authorizationScope: [
    "Autoriza apenas esta candidatura.",
    "Nao autoriza submissao do trabalho.",
    "Nao autoriza pagamentos ou criacao de conta."
  ],
  technicalId: "approval_demo_01",
  provenance: "mock"
}];

const providers: ProviderView[] = [
  { id: "groq", name: "Groq", status: "READY", runway: { state: "ESTIMATED", label: "quota disponivel" }, latencyMs: 180, health: 1, configured: true, lastCheckAt: iso(2), provenance: "mock" },
  { id: "gemini", name: "Gemini", status: "READY", runway: { state: "UNKNOWN", label: "quota atual nao conhecida" }, latencyMs: null, health: 1, configured: true, lastCheckAt: iso(4), provenance: "mock" },
  { id: "nvidia", name: "NVIDIA NIM", status: "UNKNOWN", runway: { state: "UNKNOWN", label: "nao conectado" }, latencyMs: null, health: null, configured: false, lastCheckAt: null, provenance: "mock" }
];

const decisions: ModelDecisionView[] = [{
  id: "decision-demo",
  selectedLabel: "Qwen / Groq",
  utility: 0.87,
  reasons: [{ label: "capability fit", value: 0.91 }, { label: "monetary cost", value: "$0.00" }],
  penalties: [{ label: "shadow/resource cost", value: 0.01 }],
  alternatives: [{ label: "Gemini / Google", utility: 0.8 }],
  decidedAt: iso(11),
  taskId: "task_demo_01",
  humanWhy: ["Bom historico em coding.", "Custo monetario zero.", "Provider disponivel."],
  provenance: "mock"
}];

const memories: MemoryView[] = [
  { id: "mem-economic", kind: "economic", content: "Tarefas de coding com reward explicito e custo monetario zero tendem a ser priorizadas.", importance: 5, utility: 0.86, confidence: 0.8, createdAt: iso(70), lastAccessedAt: iso(10), accessCount: 3, source: "economic-memory", keywords: ["coding", "reward"], provenance: "mock" },
  { id: "mem-procedural", kind: "procedural", content: "Antes de qualquer acao externa, criar approval especifica, single-use e vinculada a oportunidade.", importance: 5, utility: 0.95, confidence: 0.98, createdAt: iso(90), lastAccessedAt: iso(9), accessCount: 6, source: "approval-gate", keywords: ["approval", "external"], provenance: "mock" }
];

const audit: AuditEventView[] = [
  { id: "audit-1", level: "info", event: "control.objective.started", humanEvent: "Objetivo iniciado.", details: {}, createdAt: iso(12), category: "jobs", provenance: "mock" },
  { id: "audit-2", level: "warn", event: "source.health_updated", humanEvent: "AgentWork nao respondeu; Beyonder continuou com outras fontes.", details: { source: "AgentWork", status: "UNAVAILABLE" }, createdAt: iso(11), category: "opportunities", provenance: "mock" },
  { id: "audit-3", level: "info", event: "approval.requested", humanEvent: "Uma decisao precisa da sua aprovacao.", details: {}, createdAt: iso(9), category: "decisions", provenance: "mock" }
];

export class MockDashboardDataSource implements DashboardDataSource {
  readonly provenance = "mock" as const;
  async getWorkRuns() { return []; }
  async getSourceHealth() { return []; }
  async isDeveloperMode() { return false; }

  async getHome() {
    return {
      status: { global: "WAITING_FOR_YOU" as const, heartbeat: "ONLINE" as const, label: "Esperando voce", detail: "Preciso de uma decisao.", lastHeartbeatAt: iso(0), currentActivity: null },
      healthChecks: [
        { label: "Banco de dados", status: "pass" as const, detail: "Demo local carregada." },
        { label: "Runtime", status: "pass" as const, detail: "Heartbeat ativo." },
        { label: "Browser", status: "pass" as const, detail: "Disponivel quando necessario." },
        { label: "Compute", status: "pass" as const, detail: "2 providers prontos." }
      ],
      needsYouCount: 1,
      activeTask: null,
      today: { completedTasks: 1, realMoneySpentUsd: 0, realRevenueUsd: 0, simulatedRevenueUsd: 3 },
      economy: await this.getEconomySummary(),
      firstRun: false,
      recentAudit: audit,
      provenance: this.provenance
    };
  }
  async getRuntimeStatus() { return (await this.getHome()).status; }
  async getTasks(query?: PageQuery) { return paginate(tasks, query); }
  async getOpportunities(query?: PageQuery) { return paginate(opportunities, query); }
  async getApprovals(query?: PageQuery) { return paginate(approvals, query); }
  async getProviders(query?: PageQuery) { return paginate(providers, query); }
  async getModelDecisions(query?: PageQuery) { return paginate(decisions, query); }
  async getMemories(query?: MemoryQuery) { return paginate(memories.filter((memory) => !query?.kind || query.kind === "all" || memory.kind === query.kind), query); }
  async getAuditEvents(query?: AuditQuery) { return paginate(audit.filter((event) => !query?.level || query.level === "all" || event.level === query.level), query); }
  async getEconomySummary() { return { realMoneySpentUsd: 0, realRevenueUsd: 0, simulatedRevenueUsd: 3, shadowCostUsd: 0.04, computeConsumed: "fixture", monetaryCostTodayUsd: 0 }; }
}

function paginate<T>(items: T[], query: PageQuery = {}) {
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.min(100, Math.max(1, query.limit ?? 50));
  return items.slice(offset, offset + limit);
}
