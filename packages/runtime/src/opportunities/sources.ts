import type { OpportunitySource, OpportunityDiscoveryResult, OpportunitySourceContext, RawOpportunity } from "./contracts.js";

export class DeterministicFixtureOpportunitySource implements OpportunitySource {
  readonly id = "fixture";

  async discover(context: OpportunitySourceContext = {}): Promise<OpportunityDiscoveryResult> {
    const discoveredAt = context.now ?? new Date().toISOString();
    const items: RawOpportunity[] = [
      {
        source: this.id,
        sourceItemId: "task-a",
        sourceUrl: "https://fixture.invalid/task-a",
        title: "Extract project details from a public page",
        description: "Read a public page and return structured project information.",
        type: "RESEARCH",
        reward: { amount: 10, currency: "USD", type: "FIXED" },
        requiredCapabilities: ["browser.read", "structured extraction"]
      },
      {
        source: this.id,
        sourceItemId: "task-b",
        sourceUrl: "https://fixture.invalid/task-b",
        title: "Fix a small TypeScript bug",
        description: "Implement and test a small coding change in a local fixture.",
        type: "CODING",
        reward: { amount: 2, currency: "USD", type: "FIXED" },
        requiredCapabilities: ["coding"]
      },
      {
        source: this.id,
        sourceItemId: "task-c",
        sourceUrl: "https://fixture.invalid/task-c",
        title: "High reward task with account and payment requirement",
        description: "Create an account and pay an entry fee before completing the task.",
        type: "SERVICE_REQUEST",
        reward: { amount: 100, currency: "USD", type: "FIXED" },
        requiredCapabilities: ["browser.read"],
        metadata: { requiresAccount: true, requiresPayment: true, requiredCapitalUsd: 20 }
      }
    ];
    return { sourceId: this.id, discoveredAt, items: items.slice(0, context.limit ?? items.length), errors: [] };
  }
}

export interface GitHubIssueSourceOptions {
  apiBaseUrl?: string;
  repository?: string;
  fetchImpl?: typeof fetch;
}

export class GitHubPublicOpportunitySource implements OpportunitySource {
  readonly id = "github-public";
  private readonly apiBaseUrl: string;
  private readonly repository?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GitHubIssueSourceOptions = {}) {
    this.apiBaseUrl = options.apiBaseUrl ?? "https://api.github.com";
    this.repository = options.repository;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async discover(context: OpportunitySourceContext = {}): Promise<OpportunityDiscoveryResult> {
    const discoveredAt = context.now ?? new Date().toISOString();
    const path = this.repository ? `/repos/${this.repository}/issues?state=open&per_page=${Math.min(context.limit ?? 20, 50)}` : "/issues?state=open&per_page=20";
    try {
      const response = await this.fetchImpl(`${this.apiBaseUrl.replace(/\/$/, "")}${path}`, {
        headers: { accept: "application/vnd.github+json", "user-agent": "beyonder-opportunity-readonly" },
        signal: context.signal
      });
      if (!response.ok) return { sourceId: this.id, discoveredAt, items: [], errors: [`GitHub returned HTTP ${response.status}.`] };
      const issues = await response.json() as Array<{ id?: unknown; html_url?: unknown; title?: unknown; body?: unknown; labels?: Array<{ name?: unknown }>; pull_request?: unknown }>;
      const items = issues
        .filter((issue) => !issue.pull_request && typeof issue.title === "string" && typeof issue.id !== "undefined")
        .map((issue) => githubIssueToRaw(issue, this.id))
        .filter((issue): issue is RawOpportunity => issue !== undefined);
      return { sourceId: this.id, discoveredAt, items, errors: [] };
    } catch (error) {
      return { sourceId: this.id, discoveredAt, items: [], errors: [error instanceof Error ? error.message : String(error)] };
    }
  }
}

export interface AgentWorkOpportunitySourceOptions {
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface OpenBountyOpportunitySourceOptions { apiBaseUrl?: string; fetchImpl?: typeof fetch; }
export class OpenBountyPublicOpportunitySource implements OpportunitySource {
  readonly id = "openbounty-public";
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  constructor(options: OpenBountyOpportunitySourceOptions = {}) { this.apiBaseUrl = (options.apiBaseUrl ?? "https://www.openbounty.app/api/v1").replace(/\/$/, ""); this.fetchImpl = options.fetchImpl ?? fetch; }
  async discover(context: OpportunitySourceContext = {}): Promise<OpportunityDiscoveryResult> {
    const discoveredAt = context.now ?? new Date().toISOString();
    try {
      const response = await this.fetchImpl(`${this.apiBaseUrl}/bounties?limit=${Math.min(context.limit ?? 20, 100)}`, { headers: { accept: "application/json", "user-agent": "beyonder-opportunity-readonly" }, signal: context.signal });
      if (!response.ok) return { sourceId: this.id, discoveredAt, items: [], errors: [`Open Bounty returned HTTP ${response.status}.`] };
      const payload = await response.json() as unknown;
      if (!payload || typeof payload !== "object" || !Array.isArray((payload as { data?: unknown }).data)) return { sourceId: this.id, discoveredAt, items: [], errors: ["Open Bounty returned a malformed payload."] };
      const items = (payload as { data: unknown[] }).data.map((item) => openBountyToRaw(item, this.id)).filter((item): item is RawOpportunity => item !== undefined);
      return { sourceId: this.id, discoveredAt, items, errors: [] };
    } catch (error) { return { sourceId: this.id, discoveredAt, items: [], errors: [error instanceof Error ? error.message : String(error)] }; }
  }
}

function openBountyToRaw(value: unknown, source: string): RawOpportunity | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>; const title = typeof item.title === "string" ? item.title.trim() : ""; if (!title) return undefined;
  const reward = typeof item.rewardUsdc === "string" && Number.isFinite(Number(item.rewardUsdc)) ? { amount: Number(item.rewardUsdc), currency: "USDC", type: "FIXED" as const } : typeof item.price === "number" ? { amount: item.price, currency: "USDC", type: "FIXED" as const } : { type: "UNKNOWN" as const };
  const description = [item.description, item.completionCriteria].filter((x): x is string => typeof x === "string").join("\n\n");
  return { source, sourceItemId: item.id === undefined ? undefined : String(item.id), sourceUrl: typeof item.id === "number" || typeof item.id === "string" ? `https://www.openbounty.app/bounties/${item.id}` : "https://www.openbounty.app/bounties", title, description, type: /code|software|api|research|data/i.test(`${title} ${description}`) ? "RESEARCH" : "BOUNTY", reward, deadline: typeof item.expiresAt === "string" ? item.expiresAt : undefined, requiredCapabilities: [typeof item.category === "string" ? item.category.toLowerCase() : "research"], metadata: { marketplace: "Open Bounty", requiresApplication: true, requiresProposal: true, requiresAccount: true, requiresAuthentication: true, requiresIdentity: true, requiresSubmission: true, requiresWallet: true, requiresOnchainAction: true, paymentNetwork: typeof item.paymentNetwork === "string" ? item.paymentNetwork : "eip155:8453", paymentMetadata: item.payment } };
}

/** Public, read-only AgentWork catalog adapter. It never registers, applies, messages, or pays. */
export class AgentWorkPublicOpportunitySource implements OpportunitySource {
  readonly id = "agentwork-public";
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AgentWorkOpportunitySourceOptions = {}) {
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://agentwork.app/api").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async discover(context: OpportunitySourceContext = {}): Promise<OpportunityDiscoveryResult> {
    const discoveredAt = context.now ?? new Date().toISOString();
    try {
      const response = await this.fetchImpl(`${this.apiBaseUrl}/gigs?status=open`, {
        headers: { accept: "application/json", "user-agent": "beyonder-opportunity-readonly" }, signal: context.signal
      });
      if (!response.ok) return { sourceId: this.id, discoveredAt, items: [], errors: [`AgentWork returned HTTP ${response.status}.`] };
      const payload = await response.json() as unknown;
      const records = Array.isArray(payload) ? payload : (payload && typeof payload === "object" && Array.isArray((payload as { gigs?: unknown }).gigs) ? (payload as { gigs: unknown[] }).gigs : []);
      const items = records.map((record) => agentWorkToRaw(record, this.id)).filter((item): item is RawOpportunity => item !== undefined);
      return { sourceId: this.id, discoveredAt, items: items.slice(0, context.limit ?? items.length), errors: [] };
    } catch (error) {
      return { sourceId: this.id, discoveredAt, items: [], errors: [error instanceof Error ? error.message : String(error)] };
    }
  }
}

function agentWorkToRaw(value: unknown, source: string): RawOpportunity | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const title = typeof item.title === "string" ? item.title.trim() : "";
  if (!title) return undefined;
  const description = typeof item.description === "string" ? item.description : "";
  const id = item.id ?? item.gigId ?? item.slug;
  const skills = Array.isArray(item.skillsRequired) ? item.skillsRequired.filter((x): x is string => typeof x === "string") : [];
  const budget = typeof item.budgetUsd === "number" ? item.budgetUsd : typeof item.budgetUsd === "string" && Number.isFinite(Number(item.budgetUsd)) ? Number(item.budgetUsd) : undefined;
  return {
    source, sourceItemId: id === undefined ? undefined : String(id),
    sourceUrl: typeof item.url === "string" ? item.url : typeof item.slug === "string" ? `https://agentwork.app/gigs/${item.slug}` : "https://agentwork.app/gigs",
    title, description, type: /code|software|typescript|api/i.test(`${title} ${description}`) ? "CODING" : /research|analysis/i.test(`${title} ${description}`) ? "RESEARCH" : "JOB",
    reward: budget === undefined ? { type: "UNKNOWN" } : { amount: budget, currency: "USD", type: "FIXED" },
    requiredCapabilities: skills.length ? skills : ["research"],
    deadline: typeof item.deadline === "string" ? item.deadline : undefined,
    metadata: { marketplace: "AgentWork", requiresApplication: true, requiresProposal: true, requiresAccount: true, requiresAuthentication: true, requiresSubmission: true, rewardExplicit: budget !== undefined, paymentMethod: "USDC", sourceApi: `${thisSourceBase(source)}/gigs` }
  };
}

function thisSourceBase(source: string): string { return source === "agentwork-public" ? "https://agentwork.app/api" : source; }

function githubIssueToRaw(issue: { id?: unknown; html_url?: unknown; title?: unknown; body?: unknown; labels?: Array<{ name?: unknown }> }, source: string): RawOpportunity | undefined {
  const title = typeof issue.title === "string" ? issue.title.trim() : "";
  if (!title) return undefined;
  const description = typeof issue.body === "string" ? issue.body : "";
  const reward = extractReward(description);
  const labels = (issue.labels ?? []).map((label) => typeof label.name === "string" ? label.name : "").filter(Boolean);
  if (!reward && !labels.some((label) => /bounty|reward|paid/i.test(label)) && !/\b(?:bounty|reward|paid|usd|\$\d+)/i.test(description)) return undefined;
  return {
    source,
    sourceItemId: String(issue.id),
    sourceUrl: typeof issue.html_url === "string" ? issue.html_url : undefined,
    title,
    description,
    type: /bug|code|typescript|javascript|implement/i.test(`${title} ${description}`) ? "CODING" : "OTHER",
    reward,
    requiredCapabilities: ["research", "browser.read"],
    metadata: { labels, rewardEvidence: Boolean(reward) }
  };
}

function extractReward(input: string) {
  const match = input.match(/\$\s?(\d+(?:\.\d{1,2})?)/i) ?? input.match(/(\d+(?:\.\d{1,2})?)\s?(?:USD|US\$)/i);
  if (!match) return undefined;
  return { amount: Number(match[1]), currency: "USD", type: "FIXED" as const };
}
