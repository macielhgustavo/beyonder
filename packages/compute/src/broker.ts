import { providers } from "./catalog.js";
import type { SecretRecord } from "./types.js";
import type { VaultData } from "./vault.js";

export class CredentialBroker {
  private readonly secrets = new Map<string, Map<string, SecretRecord>>();

  constructor(vaultData: VaultData = {}, env: NodeJS.ProcessEnv = process.env) {
    for (const provider of providers) {
      for (const envVar of provider.credentialEnvVars) {
        const envValue = env[envVar];
        if (envValue) {
          this.add({ providerId: provider.id, envVar, value: envValue, source: "env" });
          continue;
        }
        const vaultValue = provider.id === "__meta" ? undefined : vaultData[provider.id]?.[envVar];
        if (vaultValue) {
          this.add({ providerId: provider.id, envVar, value: vaultValue, source: "vault" });
        }
      }
    }
  }

  hasProviderCredential(providerId: string): boolean {
    return Boolean(this.secrets.get(providerId)?.size);
  }

  getProviderSecrets(providerId: string): SecretRecord[] {
    return [...(this.secrets.get(providerId)?.values() ?? [])];
  }

  getSecret(providerId: string, envVar: string): string | undefined {
    return this.secrets.get(providerId)?.get(envVar)?.value;
  }

  redactedSummary(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [providerId, records] of this.secrets) {
      out[providerId] = [...records.values()].map((record) => `${record.envVar}:${record.source}`);
    }
    return out;
  }

  private add(record: SecretRecord): void {
    const providerMap = this.secrets.get(record.providerId) ?? new Map<string, SecretRecord>();
    providerMap.set(record.envVar, record);
    this.secrets.set(record.providerId, providerMap);
  }
}
