import type { StateStore } from "../memory/state-store.js";
import type { Opportunity, OpportunityStatus } from "./contracts.js";

export interface OpportunityStore {
  upsert(opportunity: Opportunity): Promise<Opportunity>;
  get(id: string): Promise<Opportunity | undefined>;
  list(status?: OpportunityStatus): Promise<Opportunity[]>;
  updateStatus(id: string, status: OpportunityStatus): Promise<Opportunity | undefined>;
}

const INDEX_KEY = "opportunities:index";
const ITEM_PREFIX = "opportunity:item:";

export class StateOpportunityStore implements OpportunityStore {
  constructor(private readonly state: StateStore) {}

  async upsert(opportunity: Opportunity): Promise<Opportunity> {
    const index = await this.state.get<string[]>(INDEX_KEY, []);
    const ids = index.includes(opportunity.id) ? index : [...index, opportunity.id];
    await this.state.set(INDEX_KEY, ids);
    await this.state.set(`${ITEM_PREFIX}${opportunity.id}`, opportunity);
    return opportunity;
  }

  async get(id: string): Promise<Opportunity | undefined> {
    return this.state.get<Opportunity | undefined>(`${ITEM_PREFIX}${id}`, undefined);
  }

  async list(status?: OpportunityStatus): Promise<Opportunity[]> {
    const index = await this.state.get<string[]>(INDEX_KEY, []);
    const opportunities: Opportunity[] = [];
    for (const id of index) {
      const item = await this.get(id);
      if (item && (!status || item.status === status)) opportunities.push(item);
    }
    return opportunities.sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt));
  }

  async updateStatus(id: string, status: OpportunityStatus): Promise<Opportunity | undefined> {
    const current = await this.get(id);
    if (!current) return undefined;
    return this.upsert({ ...current, status });
  }
}
