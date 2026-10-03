import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getProvider } from "./catalog.js";
import { AutopilotStateStore } from "./state-store.js";

test("state store clears stale errors and gates when provider becomes ready", async () => {
  const dir = await mkdtemp(join(tmpdir(), "provider-state-"));
  const store = new AutopilotStateStore(join(dir, "state.json"));
  const provider = getProvider("nvidia-nim");
  assert.ok(provider);
  await store.update(provider, "HUMAN_GATE", {
    lastError: "old failure",
    humanGate: { kind: "TWO_FACTOR", reason: "old gate", action: "old action" }
  });
  const ready = await store.update(provider, "READY", {
    validation: { status: "validated", message: "HTTP 200", models: ["meta/llama-3.3-70b-instruct"] }
  });
  assert.equal(ready.lastError, undefined);
  assert.equal(ready.humanGate, undefined);
});
