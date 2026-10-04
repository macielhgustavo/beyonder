import { openDatabase } from "../db/client.js";
import { StateStore } from "../memory/state-store.js";
import { StateTaskExecutionLeaseStore } from "./execution-lease.js";

const [path, taskId] = process.argv.slice(2);
if (!path || !taskId) throw new Error("database path and task id required");
const database = openDatabase(path);
const leases = new StateTaskExecutionLeaseStore(new StateStore(database.db));
await leases.acquire(taskId, "child-execution");
process.stdout.write("LEASE_ACQUIRED\n");
setInterval(() => undefined, 1_000);

