import type { ToolRisk, ToolSideEffect } from "@beyonder/tools";

/**
 * Capability abstraction: semantic ability, separated from tool
 * implementation (docs/v07-autonomy-kernel-architecture.md).
 *
 * SEND_MESSAGE as a capability can be implemented by Gmail, Slack,
 * Discord or HTTP tools. Planners reference capabilities; the runtime
 * resolves implementations.
 */
export const CAPABILITY_SCHEMA_VERSION = 1;

export type CapabilityAvailability =
  | "AVAILABLE"
  | "DEGRADED"
  | "UNAVAILABLE"
  | "WAITING_CREDENTIAL"
  | "WAITING_APPROVAL";

export type Reversibility = "IRREVERSIBLE" | "COMPENSATABLE" | "REVERSIBLE";

export interface CapabilityContract {
  schemaVersion: number;
  id: string;
  description: string;
  /** Human-meaningful category, e.g. web.read, message.send, code.execute */
  category: string;
  inputs?: Record<string, string>;
  outputs?: Record<string, string>;
  sideEffectLevel: ToolSideEffect;
  risk: ToolRisk;
  requiresApproval: boolean;
  idempotencySupport: "NATIVE" | "KEYED" | "NONE";
  reversibility: Reversibility;
  credentialsRequired?: string[];
  verificationMethod?: string;
}

export interface CapabilityImplementation {
  /** Capability this implementation provides. */
  capabilityId: string;
  /** Concrete implementation identity, e.g. tool id "browser.click". */
  implementationId: string;
  implementationKind: "TOOL" | "BROWSER" | "MODEL" | "INTERNAL";
}

export interface ResolvedCapability {
  contract: CapabilityContract;
  availability: CapabilityAvailability;
  implementations: readonly CapabilityImplementation[];
}

export interface CapabilityResolver {
  /** All capabilities known to the runtime with current availability. */
  list(): Promise<ResolvedCapability[]>;
  resolve(capabilityId: string): Promise<ResolvedCapability | undefined>;
  /** Capability ids available for planning right now. */
  availableCapabilityIds(): Promise<string[]>;
}

/** Registry over existing ToolRegistry: capabilities derive from tool capabilities declared in ToolDefinition. */
export class ToolBackedCapabilityResolver implements CapabilityResolver {
  constructor(
    private readonly tools: {
      list(): readonly { capabilities?: readonly string[]; risk: unknown; sideEffects: readonly ToolSideEffect[] }[];
    },
    private readonly extras: CapabilityContract[] = []
  ) {}

  list(): Promise<ResolvedCapability[]> {
    const map = new Map<string, CapabilityContract>();
    for (const tool of this.tools.list()) {
      for (const capability of tool.capabilities ?? []) {
        if (!map.has(capability)) {
          map.set(capability, {
            schemaVersion: CAPABILITY_SCHEMA_VERSION,
            id: capability,
            description: `Capability provided by tool runtime: ${capability}`,
            category: capability.split(".")[0] ?? capability,
            sideEffectLevel: tool.sideEffects[0] ?? "NONE",
            risk: (tool.risk as ToolRisk) ?? "LOW",
            requiresApproval: tool.sideEffects.some((effect) => effect === "EXTERNAL_ACTION" || effect === "FINANCIAL"),
            idempotencySupport: "NONE",
            reversibility: "IRREVERSIBLE"
          });
        }
      }
    }
    for (const extra of this.extras) map.set(extra.id, extra);

    return Promise.resolve(
      [...map.values()].map((contract) => ({
        contract,
        availability: "AVAILABLE" as const,
        implementations: [{ capabilityId: contract.id, implementationId: `tool:${contract.id}`, implementationKind: "TOOL" as const }]
      }))
    );
  }

  async resolve(capabilityId: string): Promise<ResolvedCapability | undefined> {
    return (await this.list()).find((capability) => capability.contract.id === capabilityId);
  }

  async availableCapabilityIds(): Promise<string[]> {
    return (await this.list()).map((capability) => capability.contract.id);
  }
}
