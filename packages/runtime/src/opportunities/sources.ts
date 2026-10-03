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
