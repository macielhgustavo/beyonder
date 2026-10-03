import type { OpportunityDiscoveryContext, Opportunity, OpportunitySource, OpportunityTelemetry } from "./contracts.js";
import { normalizeOpportunity } from "./normalizer.js";
import type { OpportunityStore } from "./store.js";
import { SourceReliabilityStore, sourceHealthFromError } from "./source-health.js";

export class OpportunityEngine {
  constructor(
    private readonly sources: readonly OpportunitySource[],
    private readonly store: OpportunityStore,
    private readonly telemetry?: OpportunityTelemetry,
    private readonly reliability?: SourceReliabilityStore
  ) {}

  async discover(context: OpportunityDiscoveryContext = {}): Promise<{ opportunities: Opportunity[]; errors: string[] }> {
    const sources = context.source ? this.sources.filter((source) => source.id === context.source) : this.sources;
    const discovered: Opportunity[] = [];
    const errors: string[] = [];
    for (const source of sources) {
      const started = Date.now();
      const result = await source.discover({ limit: context.limit, signal: context.signal });
      errors.push(...result.errors);
      await this.reliability?.record(source.id, { status: sourceHealthFromError(result.errors[0]), latencyMs: Date.now() - started, discovered: result.items.length, error: result.errors[0], malformed: result.errors.some((error) => /malformed/i.test(error)) });
      await this.telemetry?.record("info", "opportunity.discovery.completed", { source: source.id, count: result.items.length, errors: result.errors.length });
      for (const raw of result.items) {
        const opportunity = normalizeOpportunity(raw, result.discoveredAt);
        const existing = await this.store.get(opportunity.id);
        const canonical = existing ?? opportunity;
        await this.store.upsert(canonical);
        discovered.push(canonical);
        await this.telemetry?.record("info", existing ? "opportunity.deduplicated" : "opportunity.normalized", { opportunityId: canonical.id, source: canonical.source });
      }
    }
    return { opportunities: deduplicate(discovered), errors };
  }

  async list(status?: Opportunity["status"]): Promise<Opportunity[]> {
    return this.store.list(status);
  }

  async inspect(id: string): Promise<Opportunity | undefined> {
    return this.store.get(id);
  }
}

function deduplicate(opportunities: Opportunity[]): Opportunity[] {
  return [...new Map(opportunities.map((opportunity) => [opportunity.fingerprint, opportunity])).values()];
}
