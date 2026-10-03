import type { ToolContext, ToolDefinition, ToolDescriptor, ToolPolicy } from "./contracts.js";
import { normalizeSideEffects } from "./policy.js";

export class ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>();

  register<TInput, TOutput>(definition: ToolDefinition<TInput, TOutput>): this {
    if (!definition.id.trim()) throw new Error("Tool id must not be empty.");
    if (this.definitions.has(definition.id)) {
      throw new Error(`Tool '${definition.id}' is already registered.`);
    }
    this.definitions.set(definition.id, definition as ToolDefinition);
    return this;
  }

  registerMany(definitions: readonly ToolDefinition[]): this {
    for (const definition of definitions) this.register(definition);
    return this;
  }

  get(id: string): ToolDefinition | undefined {
    return this.definitions.get(id);
  }

  has(id: string): boolean {
    return this.definitions.has(id);
  }

  list(): readonly ToolDefinition[] {
    return [...this.definitions.values()];
  }

  capabilities(): readonly string[] {
    return [...new Set(this.list().flatMap((definition) => definition.capabilities ?? []))].sort();
  }

  async isAvailable(id: string, context: ToolContext = {}): Promise<boolean> {
    const definition = this.get(id);
    if (!definition) return false;
    return resolveAvailability(definition, context);
  }

  async getAvailableTools(context: ToolContext = {}, policy?: ToolPolicy): Promise<readonly ToolDescriptor[]> {
    const available: ToolDescriptor[] = [];
    for (const definition of this.list()) {
      if (!(await resolveAvailability(definition, context))) continue;
      if (policy && !(await policy.evaluate(definition, context)).allowed) continue;
      available.push(toDescriptor(definition));
    }
    return available;
  }
}

export function toDescriptor(definition: ToolDefinition): ToolDescriptor {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    ...(definition.inputSchema.jsonSchema === undefined ? {} : { inputSchema: definition.inputSchema.jsonSchema }),
    risk: definition.risk,
    sideEffects: normalizeSideEffects(definition.sideEffects),
    capabilities: [...(definition.capabilities ?? [])],
    ...(definition.timeoutMs === undefined ? {} : { timeoutMs: definition.timeoutMs }),
    ...(definition.cost === undefined ? {} : { cost: { ...definition.cost } }),
    ...(definition.metadata === undefined ? {} : { metadata: definition.metadata })
  };
}

async function resolveAvailability(definition: ToolDefinition, context: ToolContext): Promise<boolean> {
  try {
    if (definition.availability === undefined) return true;
    if (typeof definition.availability === "boolean") return definition.availability;
    return Boolean(await definition.availability(context));
  } catch {
    return false;
  }
}
