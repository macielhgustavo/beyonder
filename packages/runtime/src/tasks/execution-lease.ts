import { hostname } from "node:os";
import { nanoid } from "nanoid";
import type { StateStore } from "../memory/state-store.js";

export interface ExecutionLease {
  version: 1;
  taskId: string;
  executionId: string;
  ownerId: string;
  ownerPid: number;
  ownerHost: string;
  acquiredAt: string;
  expiresAt: string;
}

export class ExecutionLeaseConflictError extends Error {
  readonly code = "ALREADY_RUNNING";
  constructor(readonly taskId: string) {
    super(`Task '${taskId}' already has an active execution owner.`);
    this.name = "ExecutionLeaseConflictError";
  }
}

export interface TaskExecutionLeaseStore {
  acquire(taskId: string, executionId: string, durationMs?: number): Promise<ExecutionLease>;
  release(lease: ExecutionLease): Promise<void>;
  assertOwned?(lease: ExecutionLease): Promise<void>;
}

export class StateTaskExecutionLeaseStore implements TaskExecutionLeaseStore {
  constructor(private readonly state: StateStore, private readonly now: () => number = Date.now) {}

  async acquire(taskId: string, executionId: string, durationMs = 300_000): Promise<ExecutionLease> {
    const key = leaseKey(taskId);
    const lease: ExecutionLease = {
      version: 1,
      taskId,
      executionId,
      ownerId: nanoid(),
      ownerPid: process.pid,
      ownerHost: hostname(),
      acquiredAt: new Date(this.now()).toISOString(),
      expiresAt: new Date(this.now() + durationMs).toISOString()
    };
    if (this.state.insertIfAbsent(key, lease)) return lease;

    for (let attempt = 0; attempt < 3; attempt++) {
      const raw = await this.state.readRaw(key);
      if (!raw.found) {
        if (this.state.insertIfAbsent(key, lease)) return lease;
        continue;
      }
      let current: ExecutionLease | null;
      try { current = JSON.parse(raw.value) as ExecutionLease | null; }
      catch { throw new ExecutionLeaseConflictError(taskId); }
      if (current === null || isStale(current, this.now())) {
        if (this.state.compareAndSet(key, current, lease)) return lease;
        continue;
      }
      throw new ExecutionLeaseConflictError(taskId);
    }
    throw new ExecutionLeaseConflictError(taskId);
  }

  async assertOwned(lease: ExecutionLease): Promise<void> {
    const current = await this.state.get<ExecutionLease | null>(leaseKey(lease.taskId), null);
    const expiresAt = current ? Date.parse(current.expiresAt) : NaN;
    if (!current || current.ownerId !== lease.ownerId || current.executionId !== lease.executionId || !Number.isFinite(expiresAt) || expiresAt <= this.now()) {
      throw new ExecutionLeaseConflictError(lease.taskId);
    }
  }

  async release(lease: ExecutionLease): Promise<void> {
    this.state.compareAndSet(leaseKey(lease.taskId), lease, null);
  }
}

function leaseKey(taskId: string) { return `task-execution-lease:${taskId}`; }

function isStale(lease: ExecutionLease, now: number): boolean {
  if (!lease || lease.version !== 1) return false;

  // Check temporal expiration FIRST to prevent PID reuse vulnerabilities
  if (Date.parse(lease.expiresAt) <= now) {
    return true;
  }

  // Only check process existence if lease hasn't expired temporally
  if (lease.ownerHost === hostname()) {
    try { process.kill(lease.ownerPid, 0); return false; }
    catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
  }

  // For remote hosts, lease is stale only if temporally expired (already checked above)
  return false;
}
