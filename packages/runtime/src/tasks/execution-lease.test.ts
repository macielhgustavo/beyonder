import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openDatabase } from "../db/client.js";
import { StateStore } from "../memory/state-store.js";
import { StateTaskExecutionLeaseStore } from "./execution-lease.js";

it("recovers an expired persisted lease after restart even with a live PID and fences stale release", async () => {
  const directory = mkdtempSync(join(tmpdir(), "lease-restart-"));
  const path = join(directory, "runtime.sqlite");
  let now = Date.now();
  const first = openDatabase(path);
  const old = await new StateTaskExecutionLeaseStore(new StateStore(first.db), () => now).acquire("task", "first", 100);
  first.sqlite.close(); // crash simulation: no release
  const second = openDatabase(path);
  try {
    const leases = new StateTaskExecutionLeaseStore(new StateStore(second.db), () => now);
    await expect(leases.acquire("task", "premature")).rejects.toMatchObject({ code: "ALREADY_RUNNING" });
    now += 101;
    const recovered = await leases.acquire("task", "recovered");
    expect(recovered.ownerId).not.toBe(old.ownerId);
    expect(recovered.ownerPid).toBe(old.ownerPid); // expiration beats PID liveness
    await expect(leases.assertOwned(old)).rejects.toMatchObject({ code: "ALREADY_RUNNING" });
    await expect(leases.assertOwned(recovered)).resolves.toBeUndefined();
    await leases.release(old);
    await expect(leases.acquire("task", "third")).rejects.toMatchObject({ code: "ALREADY_RUNNING" });
    await leases.release(recovered);
    await expect(leases.acquire("task", "next")).resolves.toMatchObject({ executionId: "next" });
  } finally { second.sqlite.close(); rmSync(directory, { recursive: true, force: true }); }
});
