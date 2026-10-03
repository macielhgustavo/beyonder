import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import path from "node:path";
import type { DashboardDataSource } from "./source";
import type {
  AuditEventView,
  AuditQuery,
  EconomyPoint,
  MemoryKind,
  MemoryQuery,
  MemoryView,
  ModelDecisionView,
  PageQuery
} from "./types";
import { redactText, safeJsonObject } from "./redact";

interface LedgerRow {
  type: string;
  amount_usd: number;
  created_at: string;
}

interface MemoryRow {
  id: string;
  kind: string;
  content: string;
  importance: number;
  confidence: number;
  utility: number;
  created_at: string;
  last_accessed_at: string | null;
  access_count: number;
  source: string | null;
  task_id: string | null;
  keywords: string;
}

interface AuditRow {
  id: string;
  level: string;
  event: string;
  details: string;
  created_at: string;
}

interface RouterDecisionSnapshot {
  decisions: ModelDecisionView[];
  effectiveResourceCost: number | null;
  modelUsage: Array<{ label: string; value: number }>;
}

type DecisionFactorCandidate =
  | { label: string; value: number }
  | { label: string; value: string };

export class LocalDashboardDataSource implements DashboardDataSource {
  readonly provenance = "local" as const;
  private readonly dbPath: string;

  constructor(dbPath = resolveDashboardDbPath()) {
    this.dbPath = dbPath;
  }

  async getOverview() {
    if (!this.isAvailable()) return emptyOverview();
    const economy = await this.getEconomy();
    const db = this.open();
    try {
      const memoryCount = tableExists(db, "memories")
        ? (db.prepare("SELECT COUNT(*) AS count FROM memories").get() as { count: number }).count
        : null;
      const recentErrors = tableExists(db, "audit_events")
        ? await this.getAuditEvents({ level: "error", limit: 5 })
        : [];
      const router = tableExists(db, "audit_events")
        ? readRouterDecisionSnapshot(db)
        : emptyRouterDecisionSnapshot();

      return {
        // A readable database is not a runtime heartbeat. Stay UNKNOWN until a
        // stable health/heartbeat contract exists instead of inferring ONLINE.
        runtimeStatus: "unknown" as const,
        economicState: economy.economicState,
        capitalUsd: economy.capitalUsd,
        balanceUsd: economy.balanceUsd,
        readyProviders: 0,
        totalProviders: 0,
        currentTask: null,
        requestsToday: null,
        monetaryCostUsd: economy.monetarySpendUsd,
        effectiveResourceCost: router.effectiveResourceCost,
        memoryCount,
        successRate: null,
        freeResources: null,
        recentDecisions: router.decisions,
        recentErrors,
        modelUsage: router.modelUsage,
        provenance: this.provenance
      };
    } finally {
      db.close();
    }
  }

  async getEconomy() {
    if (!this.isAvailable()) return emptyEconomy();
    const db = this.open();
    try {
      if (!tableExists(db, "ledger_entries")) return emptyEconomy("local");
      const rows = db.prepare("SELECT type, amount_usd, created_at FROM ledger_entries ORDER BY created_at ASC").all() as LedgerRow[];
      let capitalUsd = 0;
      let revenueUsd = 0;
      let expensesUsd = 0;
      let adjustmentsUsd = 0;
      const history: EconomyPoint[] = [];

      for (const row of rows) {
        if (row.type === "capital") capitalUsd += row.amount_usd;
        if (row.type === "revenue") revenueUsd += row.amount_usd;
        if (row.type === "expense") expensesUsd += row.amount_usd;
        if (row.type === "adjustment") adjustmentsUsd += row.amount_usd;
        history.push({
          at: row.created_at,
          balanceUsd: capitalUsd + revenueUsd - expensesUsd + adjustmentsUsd,
          revenueUsd,
          expensesUsd
        });
      }

      return {
        balanceUsd: capitalUsd + revenueUsd - expensesUsd + adjustmentsUsd,
        capitalUsd,
        revenueUsd,
        expensesUsd,
        runwayDays: null,
        monetarySpendUsd: expensesUsd,
        shadowSpend: null,
        quotas: [],
        economicState: "unknown" as const,
        history: history.slice(-100),
        provenance: this.provenance
      };
    } finally {
      db.close();
    }
  }

  async getProviders(_query?: PageQuery) { return []; }
  async getModels(_query?: PageQuery) { return []; }
  async getTasks(_query?: PageQuery) { return []; }

  async getMemories(query: MemoryQuery = {}): Promise<MemoryView[]> {
    if (!this.isAvailable()) return [];
    const db = this.open();
    try {
      if (!tableExists(db, "memories")) return [];
      const { limit, offset } = page(query);
      const where: string[] = [];
      const args: Array<string | number> = [];
      if (query.kind && query.kind !== "all") {
        where.push("kind = ?");
        args.push(query.kind);
      }
      if (query.search?.trim()) {
        where.push("(content LIKE ? OR keywords LIKE ? OR source LIKE ?)");
        const pattern = `%${query.search.trim()}%`;
        args.push(pattern, pattern, pattern);
      }
      const sql = `SELECT id, kind, content, importance, confidence, utility, created_at, last_accessed_at, access_count, source, task_id, keywords FROM memories ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      args.push(limit, offset);
      const rows = db.prepare(sql).all(...args) as MemoryRow[];
      return rows.flatMap((row) => {
        const kind = normalizeMemoryKind(row.kind);
        if (!kind) return [];
        return [{
          id: row.id,
          kind,
          content: redactText(row.content),
          importance: row.importance,
          utility: row.utility,
          confidence: row.confidence,
          createdAt: row.created_at,
          lastAccessedAt: row.last_accessed_at,
          accessCount: row.access_count,
          source: row.source ? redactText(row.source) : undefined,
          taskId: row.task_id ?? undefined,
          keywords: parseKeywords(row.keywords).map(redactText),
          provenance: this.provenance
        }];
      });
    } finally {
      db.close();
    }
  }

  async getAuditEvents(query: AuditQuery = {}): Promise<AuditEventView[]> {
    if (!this.isAvailable()) return [];
    const db = this.open();
    try {
      if (!tableExists(db, "audit_events")) return [];
      const { limit, offset } = page(query);
      const where: string[] = [];
      const args: Array<string | number> = [];
      if (query.level && query.level !== "all") {
        where.push("level = ?");
        args.push(query.level);
      }
      if (query.search?.trim()) {
        where.push("(event LIKE ? OR details LIKE ?)");
        const pattern = `%${query.search.trim()}%`;
        args.push(pattern, pattern);
      }
      const sql = `SELECT id, level, event, details, created_at FROM audit_events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      args.push(limit, offset);
      return (db.prepare(sql).all(...args) as AuditRow[]).map((row) => ({
        id: row.id,
        level: normalizeAuditLevel(row.level),
        event: redactText(row.event),
        details: safeJsonObject(row.details),
        createdAt: row.created_at,
        provenance: this.provenance
      }));
    } finally {
      db.close();
    }
  }

  private isAvailable() {
    return existsSync(this.dbPath);
  }

  private open() {
    return new Database(this.dbPath, { readonly: true, fileMustExist: true });
  }
}

export function resolveDashboardDbPath(): string {
  const repoRoot = path.resolve(process.cwd(), "../..");
  const configured = process.env.BEYONDER_DB_PATH ?? "./data/beyonder.sqlite";
  return path.isAbsolute(configured) ? configured : path.resolve(repoRoot, configured);
}

function page(query: PageQuery) {
  return {
    limit: Math.min(100, Math.max(1, query.limit ?? 50)),
    offset: Math.max(0, query.offset ?? 0)
  };
}

function tableExists(db: Database.Database, table: string) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function readRouterDecisionSnapshot(db: Database.Database): RouterDecisionSnapshot {
  const selectedRows = db.prepare(
    "SELECT id, level, event, details, created_at FROM audit_events WHERE event = 'router.selected' ORDER BY created_at DESC LIMIT 500"
  ).all() as AuditRow[];

  if (selectedRows.length === 0) return emptyRouterDecisionSnapshot();

  // Candidate and shadow-cost telemetry is bounded. It is only needed to
  // reconstruct explanations for the handful of most recent selections.
  const candidateRows = db.prepare(
    "SELECT id, level, event, details, created_at FROM audit_events WHERE event = 'router.candidate_scored' ORDER BY created_at DESC LIMIT 250"
  ).all() as AuditRow[];
  const shadowRows = db.prepare(
    "SELECT id, level, event, details, created_at FROM audit_events WHERE event = 'shadow_cost.calculated' ORDER BY created_at DESC LIMIT 250"
  ).all() as AuditRow[];

  const parsedCandidates = candidateRows.map((row) => ({ row, details: safeJsonObject(row.details) }));
  const parsedShadows = shadowRows.map((row) => ({ row, details: safeJsonObject(row.details) }));
  const parsedSelected = selectedRows.map((row) => ({ row, details: safeJsonObject(row.details) }));

  const decisions = parsedSelected.slice(0, 5).flatMap(({ row, details }) => {
    const provider = textField(details, "provider");
    const model = textField(details, "model");
    if (!provider || !model) return [];

    const taskId = textField(details, "taskId");
    const matchingCandidates = taskId
      ? parsedCandidates.filter((candidate) => textField(candidate.details, "taskId") === taskId)
      : [];
    const matchingShadow = taskId
      ? parsedShadows.find((shadow) =>
          textField(shadow.details, "taskId") === taskId &&
          textField(shadow.details, "provider") === provider &&
          textField(shadow.details, "model") === model
        )
      : undefined;

    const reasons = [
      factor("predicted capability", numberField(details, "predictedQuality")),
      factor("historical success", numberField(details, "historicalSuccess")),
      factor("reliability", numberField(details, "reliability")),
      moneyFactor("monetary cost", numberField(details, "monetaryCostUsd"))
    ].filter(isFactor);

    const penalties = [
      factor("quota scarcity", matchingShadow ? numberField(matchingShadow.details, "scarcity") : null),
      factor("shadow cost", numberField(details, "shadowCostUsd")),
      factor("latency", numberField(details, "latencyPenalty")),
      factor("failure risk", numberField(details, "failureRisk"))
    ].filter(isFactor);

    const alternatives = uniqueAlternatives(matchingCandidates, provider, model).slice(0, 5);

    return [{
      id: row.id,
      selectedLabel: `${model} / ${provider}`,
      utility: numberField(details, "utility"),
      reasons,
      penalties,
      alternatives,
      decidedAt: row.created_at,
      taskId: taskId ?? undefined,
      provenance: "local" as const
    }];
  });

  const usageCounts = new Map<string, number>();
  for (const { details } of parsedSelected) {
    const provider = textField(details, "provider");
    const model = textField(details, "model");
    if (!provider || !model) continue;
    const label = `${model} / ${provider}`;
    usageCounts.set(label, (usageCounts.get(label) ?? 0) + 1);
  }
  const usageTotal = [...usageCounts.values()].reduce((sum, count) => sum + count, 0);
  const modelUsage = [...usageCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, count]) => ({ label, value: usageTotal ? Math.round((count / usageTotal) * 100) : 0 }));

  return {
    decisions,
    effectiveResourceCost: numberField(parsedSelected[0].details, "effectiveResourceCost"),
    modelUsage
  };
}

function uniqueAlternatives(
  candidates: Array<{ row: AuditRow; details: Record<string, unknown> }>,
  selectedProvider: string,
  selectedModel: string
): ModelDecisionView["alternatives"] {
  const byLabel = new Map<string, number | null>();
  for (const candidate of candidates) {
    const provider = textField(candidate.details, "provider");
    const model = textField(candidate.details, "model");
    if (!provider || !model || (provider === selectedProvider && model === selectedModel)) continue;
    const label = `${model} / ${provider}`;
    const utility = numberField(candidate.details, "utility");
    const previous = byLabel.get(label);
    if (previous === undefined || (utility != null && (previous == null || utility > previous))) {
      byLabel.set(label, utility);
    }
  }
  return [...byLabel.entries()]
    .map(([label, utility]) => ({ label, utility }))
    .sort((a, b) => (b.utility ?? -Infinity) - (a.utility ?? -Infinity));
}

function textField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === "string" && field.trim() ? redactText(field) : null;
}

function numberField(value: Record<string, unknown>, key: string): number | null {
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : null;
}

function factor(label: string, value: number | null): DecisionFactorCandidate | null {
  return value == null ? null : { label, value };
}

function moneyFactor(label: string, value: number | null): DecisionFactorCandidate | null {
  return value == null ? null : { label, value: `$${value.toFixed(4).replace(/\.?0+$/, "") || "0"}` };
}

function isFactor(value: DecisionFactorCandidate | null): value is DecisionFactorCandidate {
  return value !== null;
}

function emptyRouterDecisionSnapshot(): RouterDecisionSnapshot {
  return { decisions: [], effectiveResourceCost: null, modelUsage: [] };
}

function normalizeMemoryKind(kind: string): MemoryKind | null {
  if (["working", "episodic", "semantic", "procedural", "economic"].includes(kind)) return kind as MemoryKind;
  if (kind === "decision") return "episodic";
  return null;
}

function normalizeAuditLevel(level: string): AuditEventView["level"] {
  return ["debug", "info", "warn", "error"].includes(level) ? level as AuditEventView["level"] : "unknown";
}

function parseKeywords(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function emptyOverview() {
  return {
    runtimeStatus: "unknown" as const,
    economicState: "unknown" as const,
    capitalUsd: null,
    balanceUsd: null,
    readyProviders: 0,
    totalProviders: 0,
    currentTask: null,
    requestsToday: null,
    monetaryCostUsd: null,
    effectiveResourceCost: null,
    memoryCount: null,
    successRate: null,
    freeResources: null,
    recentDecisions: [],
    recentErrors: [],
    modelUsage: [],
    provenance: "local" as const
  };
}

function emptyEconomy(provenance: "local" | "empty" = "local") {
  return {
    balanceUsd: null,
    capitalUsd: null,
    revenueUsd: null,
    expensesUsd: null,
    runwayDays: null,
    monetarySpendUsd: null,
    shadowSpend: null,
    quotas: [],
    economicState: "unknown" as const,
    history: [],
    provenance
  };
}
