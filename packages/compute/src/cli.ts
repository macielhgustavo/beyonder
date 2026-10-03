#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface, emitKeypressEvents } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { getProvider, providers } from "./catalog.js";
import { CredentialBroker } from "./broker.js";
import { getStatuses } from "./status.js";
import { validateProvider } from "./validation.js";
import { Vault, type VaultData } from "./vault.js";
import { ProviderAutopilotOrchestrator } from "./autopilot.js";
import { AutopilotStateStore } from "./state-store.js";
import { discoverProviders } from "./discovery.js";
import { buildComputeInventory } from "./inventory.js";
import { redact } from "./redaction.js";

async function main(): Promise<void> {
  const [command = "status", maybeProvider] = process.argv.slice(2);
  const vault = new Vault();
  const vaultData = await loadVaultIfConfigured(vault);
  const broker = new CredentialBroker(vaultData);

  switch (command) {
    case "catalog":
      printCatalog();
      break;
    case "status":
      await printStatuses(getStatuses(broker));
      break;
    case "autopilot":
      await autopilot(maybeProvider, broker, { resumeOnly: false });
      break;
    case "resume":
      await autopilot(maybeProvider, broker, { resumeOnly: true });
      break;
    case "setup":
      await setup(maybeProvider, broker);
      break;
    case "validate":
      await validate(maybeProvider, broker);
      break;
    case "vault:set":
      await vaultSet(maybeProvider, vault);
      break;
    case "discover":
      await discover();
      break;
    case "inventory":
      await inventory();
      break;
    default:
      usage();
      process.exitCode = 1;
  }
}

function printCatalog(): void {
  for (const provider of providers) {
    console.log(`${provider.id} | ${provider.name}`);
    console.log(`  signup: ${provider.signupUrl}`);
    console.log(`  key: ${provider.apiKeyUrl ?? "n/a"}`);
    console.log(`  auth: ${provider.authType}`);
    console.log(`  endpoint: ${provider.openAiCompatibleEndpoint ?? "n/a"}`);
    console.log(`  automation: ${provider.automationStatus}`);
    console.log(`  free tier: ${provider.freeTier}`);
    console.log("");
  }
}

async function printStatuses(statuses: ReturnType<typeof getStatuses>): Promise<void> {
  const autopilotState = await new AutopilotStateStore().read();
  for (const status of statuses) {
    const provider = status.provider;
    const progress = autopilotState.providers[provider.id];
    const state = progress?.state ?? (provider.authType === "keyless" ? "DISCOVERED" : "CREDENTIAL_CHECK");
    const wait = progress?.state === "HUMAN_GATE" ? ` — ${progress.humanGate?.kind ?? "UNKNOWN"}` : "";
    const human = status.needsHumanStep ? "needs-human-step" : "no-human-step";
    const missing = status.missingEnvVars.length ? ` missing=${status.missingEnvVars.join(",")}` : "";
    console.log(`${state.padEnd(18)} ${provider.id.padEnd(24)} ${status.credentialStatus.padEnd(13)} ${(provider.classification ?? "UNREVIEWED").padEnd(22)} ${human}${wait}${missing}`);
  }
  const state = await new AutopilotStateStore().read();
  const counts = Object.values(state.providers).reduce<Record<string, number>>((acc, progress) => {
    acc[progress.state] = (acc[progress.state] ?? 0) + 1;
    return acc;
  }, {});
  if (Object.keys(counts).length) {
    console.log("\nSummary:");
    for (const [stateName, count] of Object.entries(counts).sort()) {
      console.log(`${count} ${stateName}`);
    }
  }
}

async function autopilot(
  providerId: string | undefined,
  broker: CredentialBroker,
  options: { resumeOnly: boolean }
): Promise<void> {
  const liveSignup = process.env.PROVIDER_BOOTSTRAPPER_LIVE_SIGNUP === "1";
  const orchestrator = new ProviderAutopilotOrchestrator(broker);
  const results = await orchestrator.run({ providerId, dryRun: !liveSignup, resumeOnly: options.resumeOnly });
  for (const result of results) {
    const gate = result.humanGate ? ` — ${result.humanGate.kind}: ${result.humanGate.action}` : "";
    const error = result.lastError ? ` — ${redact(result.lastError)}` : "";
    console.log(`${result.state.padEnd(18)} ${result.providerId}${gate}${error}`);
  }
}

async function setup(providerId: string | undefined, broker: CredentialBroker): Promise<void> {
  const selected = providerId ? [mustProvider(providerId)] : providers;
  for (const provider of selected) {
    const hasCredential = provider.authType === "keyless" || broker.hasProviderCredential(provider.id);
    console.log(`\n${provider.name}`);
    console.log(`  status: ${hasCredential ? "credential present or keyless" : "missing credential"}`);
    console.log(`  automation: ${provider.automationStatus}`);
    console.log(`  human requirements: ${provider.humanRequirements.join("; ") || "none listed"}`);
    console.log(`  signup: ${provider.signupUrl}`);
    if (provider.apiKeyUrl) {
      console.log(`  api key page: ${provider.apiKeyUrl}`);
    }
    if (provider.automationStatus === "automatable") {
      console.log("  action: no account automation required.");
      continue;
    }
    console.log("  action: open the provider page, complete only legitimate account steps, then store the API key with providers:vault:set.");
    console.log("  stop if asked for CAPTCHA, 2FA, phone, payment, or consent; finish that step yourself before continuing.");
    if (process.env.PROVIDER_BOOTSTRAPPER_OPEN_BROWSER === "1") {
      openUrl(provider.apiKeyUrl ?? provider.dashboardUrl ?? provider.signupUrl);
    }
  }
}

async function validate(providerId: string | undefined, broker: CredentialBroker): Promise<void> {
  const selected = providerId ? [mustProvider(providerId)] : providers;
  for (const provider of selected) {
    const status = await validateProvider(provider, broker);
    console.log(`${provider.id.padEnd(24)} ${status.validationStatus.padEnd(10)} ${status.validationMessage ?? ""}`);
  }
}

async function discover(): Promise<void> {
  const result = await discoverProviders();
  for (const provider of result.discovered) {
    console.log(`${provider.status.padEnd(10)} ${provider.id.padEnd(24)} ${provider.name}`);
  }
}

async function inventory(): Promise<void> {
  const state = await new AutopilotStateStore().read();
  const entries = buildComputeInventory(state);
  for (const entry of entries) {
    console.log(`${entry.status.padEnd(22)} ${entry.providerId.padEnd(24)} cost=${entry.cost.padEnd(12)} models=${entry.models.slice(0, 3).join(",")}`);
  }
}

async function vaultSet(providerId: string | undefined, vault: Vault): Promise<void> {
  if (!providerId) {
    throw new Error("Usage: pnpm providers:vault:set <provider-id> [ENV_VAR]");
  }
  const provider = mustProvider(providerId);
  if (provider.credentialEnvVars.length === 0) {
    throw new Error(`${provider.id} is keyless and does not need vault storage.`);
  }
  const envVar = process.argv[4] ?? provider.credentialEnvVars[0];
  if (!provider.credentialEnvVars.includes(envVar)) {
    throw new Error(`${envVar} is not a declared credential variable for ${provider.id}.`);
  }
  const password = await getVaultPassword(true);
  const value = await readSecret(`Enter ${envVar} for ${provider.id}: `);
  await vault.set(provider.id, envVar, value, password);
  console.log(`Stored ${envVar} for ${provider.id} in encrypted local vault.`);
}

async function loadVaultIfConfigured(vault: Vault): Promise<VaultData> {
  if (!(await vault.exists())) {
    return {};
  }
  const password = process.env.PROVIDER_BOOTSTRAPPER_MASTER_PASSWORD;
  if (!password) {
    return {};
  }
  return vault.read(password);
}

async function getVaultPassword(required: boolean): Promise<string> {
  const password = process.env.PROVIDER_BOOTSTRAPPER_MASTER_PASSWORD;
  if (password) {
    return password;
  }
  if (!required) {
    return "";
  }
  return readSecret("Vault password (min 12 chars): ");
}

function mustProvider(providerId: string) {
  const provider = getProvider(providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  return provider;
}

function openUrl(url: string): void {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(opener, args, { detached: true, stdio: "ignore" });
  child.unref();
}

async function readSecret(prompt: string): Promise<string> {
  if (!input.isTTY || !output.isTTY) {
    const rl = createInterface({ input, output });
    return new Promise((resolve) => rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    }));
  }

  output.write(prompt);
  emitKeypressEvents(input);
  input.setRawMode(true);
  let value = "";
  return new Promise((resolve, reject) => {
    const onKeypress = (_str: string, key: { name?: string; ctrl?: boolean; sequence?: string }) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Interrupted."));
        return;
      }
      if (key.name === "return") {
        cleanup();
        output.write("\n");
        resolve(value.trim());
        return;
      }
      if (key.name === "backspace") {
        value = value.slice(0, -1);
        return;
      }
      if (key.sequence && key.sequence >= " ") {
        value += key.sequence;
      }
    };
    const cleanup = () => {
      input.off("keypress", onKeypress);
      input.setRawMode(false);
    };
    input.on("keypress", onKeypress);
  });
}

function usage(): void {
  console.log(`Provider Bootstrapper

Commands:
  pnpm providers:status
  pnpm providers:autopilot [provider-id]
  pnpm providers:resume [provider-id]
  pnpm providers:setup [provider-id]
  pnpm providers:validate [provider-id]
  pnpm providers:discover
  pnpm providers:inventory
  pnpm providers:vault:set <provider-id> [ENV_VAR]

Set PROVIDER_BOOTSTRAPPER_MASTER_PASSWORD to read/write the encrypted local vault non-interactively.
Set PROVIDER_BOOTSTRAPPER_OPEN_BROWSER=1 to let setup open provider pages.`);
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
