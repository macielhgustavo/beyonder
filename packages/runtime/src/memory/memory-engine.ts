import type { MemoryStore, MemoryKind } from "./memory-store.js";

export interface RetrievedMemory {
  kind: MemoryKind;
  content: string;
  importance: number;
  score: number;
  createdAt: string;
}

export class MemoryEngine {
  constructor(private readonly store: MemoryStore) {}

  async remember(kind: MemoryKind, content: string, importance = 1) {
    await this.store.remember(kind, content, importance);
  }

  async retrieve(query: string, limit = 6): Promise<RetrievedMemory[]> {
    const queryTerms = tokenize(query);
    const memories = await this.store.all();
    return memories
      .map((memory) => {
        const contentTerms = tokenize(memory.content);
        const overlap = [...queryTerms].filter((term) => contentTerms.has(term)).length;
        const kindBoost = memory.kind === "working" ? 1 : memory.kind === "procedural" ? 0.6 : 0;
        return {
          kind: memory.kind as MemoryKind,
          content: memory.content,
          importance: memory.importance,
          createdAt: memory.createdAt,
          score: overlap + memory.importance * 0.2 + kindBoost
        };
      })
      .filter((memory) => memory.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async contextSummary(query: string, maxChars = 1200): Promise<string> {
    const retrieved = await this.retrieve(query);
    if (retrieved.length === 0) return "No relevant prior memory.";
    const lines = retrieved.map((memory) => `${memory.kind}: ${memory.content}`);
    return compact(lines.join("\n"), maxChars);
  }
}

function tokenize(input: string): Set<string> {
  return new Set(input.toLowerCase().match(/[a-z0-9_.$-]{3,}/g) ?? []);
}

function compact(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  const head = input.slice(0, Math.floor(maxChars * 0.7)).trim();
  const tail = input.slice(-Math.floor(maxChars * 0.25)).trim();
  return `${head}\n...\n${tail}`;
}
