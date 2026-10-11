/**
 * Resource envelope seam (v0.6 integration).
 *
 * The Mission kernel does NOT know about token prices, provider budgets
 * or the SpendGovernor. It asks an abstract authority whether a resource
 * is available. v0.6 plugs its economic governor behind this interface;
 * the v0.7 foundation ships a permissive local implementation bounded
 * by mission contract constraints only.
 */
export type ResourceRequestKind = "TIME" | "COMPUTE" | "MONEY" | "TOOL" | "EXTERNAL_ACTION";

export type ResourceDecision =
  | { status: "AUTHORIZED" }
  | { status: "DENIED"; reason: string }
  | { status: "WAIT"; reason: string }
  | { status: "DEGRADED"; reason: string };

export interface ResourceRequest {
  missionId: string;
  nodeId: string;
  kind: ResourceRequestKind;
  estimatedAmount?: number;
  /** Capability or tool identity when relevant. */
  target?: string;
  sideEffectLevel?: string;
}

export interface ResourceAuthority {
  authorize(request: ResourceRequest): Promise<ResourceDecision>;
}

/** Permissive stand-in until v0.6's economic governor plugs in. */
export class UnboundedLocalResourceAuthority implements ResourceAuthority {
  async authorize(request: ResourceRequest): Promise<ResourceDecision> {
    return { status: "AUTHORIZED" };
  }
}

/** Time-only authority: enforces mission deadlines without economic knowledge. */
export class DeadlineResourceAuthority implements ResourceAuthority {
  constructor(
    private readonly deadlineAt: string,
    private readonly fallback: ResourceAuthority = new UnboundedLocalResourceAuthority()
  ) {}

  async authorize(request: ResourceRequest): Promise<ResourceDecision> {
    if (new Date(this.deadlineAt).getTime() <= Date.now()) {
      return { status: "DENIED", reason: "Mission deadline has passed." };
    }
    return this.fallback.authorize(request);
  }
}
