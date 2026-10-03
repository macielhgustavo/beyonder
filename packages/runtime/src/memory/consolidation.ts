import type { MemoryRecord, PersistentMemoryKind } from "./memory-store.js";

export interface ConsolidationCandidate {
  sourceIds: string[];
  proposedType: Extract<PersistentMemoryKind, "semantic" | "procedural">;
  content: string;
  confidence: number;
  rationale: string;
}

export interface ConsolidationContext {
  memories: MemoryRecord[];
  taskType?: string;
}

export interface MemoryConsolidator {
  propose(context: ConsolidationContext): Promise<ConsolidationCandidate[]>;
}

export class NoopMemoryConsolidator implements MemoryConsolidator {
  async propose(_context: ConsolidationContext): Promise<ConsolidationCandidate[]> {
    return [];
  }
}
