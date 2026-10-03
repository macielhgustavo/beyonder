import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProviderAutopilotOrchestrator } from "./autopilot.js";
import { CredentialBroker } from "./broker.js";
import { AutopilotStateStore } from "./state-store.js";
import { providers } from "./catalog.js";

test("autopilot marks keyless provider ready without credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "provider-autopilot-"));
  const store = new AutopilotStateStore(join(dir, "state.json"));
  const orchestrator = new ProviderAutopilotOrchestrator(new CredentialBroker({}, {}), store);
  const [result] = await orchestrator.run({ providerId: "ai-horde" });
  assert.equal(result.state, "READY");
  await rm(dir, { recursive: true, force: true });
});

test("autopilot pauses missing credential provider at human gate in dry-run", async () => {
  const dir = await mkdtemp(join(tmpdir(), "provider-autopilot-"));
  const store = new AutopilotStateStore(join(dir, "state.json"));
  const orchestrator = new ProviderAutopilotOrchestrator(new CredentialBroker({}, {}), store);
  const [result] = await orchestrator.run({ providerId: "groq" });
  assert.equal(result.state, "HUMAN_GATE");
  assert.equal(result.humanGate?.kind, "CAPTCHA");
  await rm(dir, { recursive: true, force: true });
});

test("autopilot skips paid-only providers idempotently", async () => {
  const dir = await mkdtemp(join(tmpdir(), "provider-autopilot-"));
  const store = new AutopilotStateStore(join(dir, "state.json"));
  const orchestrator = new ProviderAutopilotOrchestrator(new CredentialBroker({}, {}), store);
  const first = await orchestrator.run({ providerId: "reka" });
  const second = await orchestrator.run({ providerId: "reka" });
  assert.equal(first[0].state, "SKIPPED");
  assert.equal(second[0].state, "SKIPPED");
  await rm(dir, { recursive: true, force: true });
});

test("priority providers are classified for autopilot", () => {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  assert.equal(byId.get("kilo-gateway")?.classification, "KEYLESS");
  assert.equal(byId.get("ovh")?.classification, "KEYLESS");
  assert.equal(byId.get("groq")?.classification, "AUTO_WITH_HUMAN_GATE");
  assert.equal(byId.get("sambanova")?.classification, "RETIRED");
  assert.equal(byId.get("modelscope")?.classification, "MANUAL_REQUIRED");
});
