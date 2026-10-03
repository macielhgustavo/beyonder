import { providers } from "./catalog.js";
import { CredentialBroker } from "./broker.js";
import type { ProviderCatalogEntry, ProviderStatus } from "./types.js";

export function getStatuses(broker: CredentialBroker): ProviderStatus[] {
  return providers.map((provider) => getProviderStatus(provider, broker));
}

export function getProviderStatus(provider: ProviderCatalogEntry, broker: CredentialBroker): ProviderStatus {
  if (provider.authType === "keyless") {
    return {
      provider,
      credentialStatus: "keyless",
      validationStatus: "not-run",
      missingEnvVars: [],
      needsHumanStep: provider.classification !== "KEYLESS" && provider.automationStatus !== "automatable"
    };
  }

  const secrets = broker.getProviderSecrets(provider.id);
  const missingEnvVars = provider.credentialEnvVars.filter((envVar) => !broker.getSecret(provider.id, envVar));
  const source = secrets.some((secret) => secret.source === "env") ? "present-env" : secrets.length ? "present-vault" : "missing";
  const requiresAll = provider.authType === "account-id-and-token";
  const hasEnough = requiresAll
    ? missingEnvVars.length === 0
    : secrets.length > 0;

  return {
    provider,
    credentialStatus: hasEnough ? source : "missing",
    validationStatus: "not-run",
    missingEnvVars: hasEnough && !requiresAll ? [] : missingEnvVars,
    needsHumanStep: provider.automationStatus === "human-step" || provider.automationStatus === "manual-only"
  };
}
