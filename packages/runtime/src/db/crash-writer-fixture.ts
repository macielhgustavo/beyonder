import { openDatabase } from "./client.js";
import { StateStore } from "../memory/state-store.js";

const path = process.argv[2];
if (!path) throw new Error("database path required");
const runtime = openDatabase(path);
const state = new StateStore(runtime.db);
await state.set("crash:terminal", { state: "COMPLETED", acknowledgedAt: new Date().toISOString() });
process.stdout.write("ACK\n");
setInterval(() => {
  void state.set("crash:heartbeat", { at: new Date().toISOString() });
}, 10);

