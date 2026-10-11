import type { BudgetAccountant } from "../../economy/budget-accountant.js";
import type { Microdollars } from "../../economy/money.js";
import type { ResourceAuthority, ResourceRequest, ResourceDecision } from "./resource-authority.js";

/**
 * v0.6 → v0.7 integration: mission resource requests backed by the real
 * compute economy. MONEY requests route through BudgetAccountant.canAfford
 * with worst-case microdollars; zero-cost work is always authorized
 * (Invariant 6: free routes never consult the budget).
 *
 * This is the seam the architecture doc promises: the kernel does not
 * know about token prices — only that it can ask an authority.
 */
export interface BudgetBackedResourceAuthorityOptions {
  /** Maps a resource request's estimatedAmount (USD) to microdollars. */
  usdToMicros?: (usd: number) => Microdollars;
  /** Optional fallback consulted for non-MONEY kinds. */
  fallback?: ResourceAuthority;
}

export class BudgetBackedResourceAuthority implements ResourceAuthority {
  private readonly fallback: ResourceAuthority | undefined;
  private readonly usdToMicros: (usd: number) => Microdollars;

  constructor(
    private readonly accountant: BudgetAccountant,
    options: BudgetBackedResourceAuthorityOptions = {}
  ) {
    this.fallback = options.fallback;
    this.usdToMicros = options.usdToMicros ?? ((usd) => Math.round(usd * 1_000_000) as Microdollars);
  }

  async authorize(request: ResourceRequest): Promise<ResourceDecision> {
    if (request.kind !== "MONEY") {
      if (this.fallback) return this.fallback.authorize(request);
      return { status: "AUTHORIZED" };
    }

    const estimatedUsd = request.estimatedAmount ?? 0;
    const worstCaseMicros = this.usdToMicros(estimatedUsd);

    // Free work never consults the budget (Invariant 6).
    if (worstCaseMicros === 0) return { status: "AUTHORIZED" };

    const affordable = this.accountant.canAfford(
      { objectiveId: request.missionId },
      worstCaseMicros
    );

    if (affordable) return { status: "AUTHORIZED" };
    return {
      status: "DENIED",
      reason: `Budget cannot cover worst-case ${estimatedUsd} USD for node '${request.nodeId}'.`
    };
  }
}
