import { nanoid } from "nanoid";

export interface WorkingMemoryRecord {
  id: string;
  kind: "working";
  content: string;
  importance: number;
  confidence: number;
  utility: number;
  createdAt: string;
  lastAccessedAt: string;
  accessCount: number;
  source?: string;
  taskId?: string;
  keywords: string[];
  metadata: Record<string, unknown>;
}

export class WorkingMemory {
  private readonly records = new Map<string, WorkingMemoryRecord>();

  remember(content: string, importance = 1, options: Partial<Omit<WorkingMemoryRecord, "id" | "kind" | "content" | "importance" | "createdAt" | "lastAccessedAt" | "accessCount">> = {}) {
    const now = new Date().toISOString();
    const record: WorkingMemoryRecord = {
      id: `working_${nanoid()}`,
      kind: "working",
      content,
      importance,
      confidence: options.confidence ?? 1,
      utility: options.utility ?? 0.5,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      source: options.source,
      taskId: options.taskId,
      keywords: options.keywords ?? [],
      metadata: options.metadata ?? {}
    };
    this.records.set(record.id, record);
    return record;
  }

  all(): WorkingMemoryRecord[] {
    return [...this.records.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  touch(ids: string[]) {
    const now = new Date().toISOString();
    for (const id of ids) {
      const record = this.records.get(id);
      if (!record) continue;
      record.accessCount += 1;
      record.lastAccessedAt = now;
    }
  }

  clear() {
    this.records.clear();
  }

  get size() {
    return this.records.size;
  }
}
