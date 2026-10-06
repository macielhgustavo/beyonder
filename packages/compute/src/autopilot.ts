import { providers } from "./catalog.js";
import { CredentialBroker } from "./broker.js";
import { validateProviderDetailed } from "./validation.js";
import { AutopilotStateStore } from "./state-store.js";
import { SystemBrowserAgent, type BrowserAgent } from "./browser-agent.js";
import { NoopEmailVerificationBroker, type EmailVerificationBroker } from "./email-broker.js";
import { FreeLlmApiIntegrator } from "./freellmapi.js";
import type { AutopilotProviderProgress, ProviderCatalogEntry } from "./types.js";
import { redact } from "./redaction.js";

export interface AutopilotOptions {
  providerId?: string;
  dryRun?: boolean;
  resumeOnly?: boolean;
}

export class ProviderAutopilotOrchestrator {
  constructor(
    private readonly broker: CredentialBroker,
    private readonly store = new AutopilotStateStore(),
    private readonly browser: BrowserAgent = new SystemBrowserAgent(),
    private readonly emailBroker: EmailVerificationBroker = new NoopEmailVerificationBroker(),
    private readonly freeLlmApi = new FreeLlmApiIntegrator()
  ) {}

  async run(options: AutopilotOptions = {}): Promise<AutopilotProviderProgress[]> {
    const state = await this.store.read();
    const selected = providers
      .filter((provider) => !options.providerId || provider.id === options.providerId)
      .filter((provider) => !options.resumeOnly || ["HUMAN_GATE", "FAILED", "DISCOVERED"].includes(state.providers[provider.id]?.state ?? "DISCOVERED"));
    const results: AutopilotProviderProgress[] = [];
    for (const provider of selected) {
      results.push(await this.runProvider(provider, options));
    }
    return results;
  }

  private async runProvider(provider: ProviderCatalogEntry, options: AutopilotOptions): Promise<AutopilotProviderProgress> {
    await this.store.update(provider, "DISCOVERED");

    if (provider.classification === "RETIRED" || provider.classification === "PAID_ONLY" || provider.classification === "UNSUPPORTED") {
      return this.store.update(provider, "SKIPPED", {
        lastError: `${provider.classification}: ${provider.notes.join(" ")}`
      });
    }
    if (provider.billingRisk && process.env.PROVIDER_BOOTSTRAPPER_ALLOW_BILLING_RISK !== "1") {
      return this.store.update(provider, "SKIPPED", {
        lastError: "BILLING_RISK=true; set PROVIDER_BOOTSTRAPPER_ALLOW_BILLING_RISK=1 only after explicit approval."
      });
    }

    await this.store.update(provider, "CREDENTIAL_CHECK");
    if (provider.authType === "keyless") {
      return this.validateAndRegister(provider);
    }

    if (this.broker.hasProviderCredential(provider.id)) {
      return this.validateAndRegister(provider);
    }

    if (!provider.onboarding?.canAttemptSignup || provider.classification === "MANUAL_REQUIRED") {
      return this.store.update(provider, "HUMAN_GATE", {
        humanGate: {
          kind: provider.onboarding?.blockers[0] ?? "UNKNOWN",
          reason: `${provider.name} requires manual account or token decisions.`,
          action: `Complete provider setup manually, then store the key with pnpm providers:vault:set ${provider.id}.`,
          url: provider.apiKeyUrl ?? provider.dashboardUrl ?? provider.signupUrl
        }
      });
    }

    await this.store.update(provider, "SIGNUP");
    if (options.dryRun !== false) {
      return this.store.update(provider, "HUMAN_GATE", {
        humanGate: {
          kind: provider.onboarding.blockers[0] ?? "UNKNOWN",
          reason: "Dry-run autopilot stops before live signup/account mutation.",
          action: `Run with PROVIDER_BOOTSTRAPPER_LIVE_SIGNUP=1 and complete any human gates, or store an existing key with pnpm providers:vault:set ${provider.id}.`,
          url: provider.apiKeyUrl ?? provider.dashboardUrl ?? provider.signupUrl
        }
      });
    }

    const signup = await this.browser.attemptSignup(provider);
    if (signup.status === "human-gate" && signup.gate) {
      return this.store.update(provider, "HUMAN_GATE", { humanGate: signup.gate });
    }

    await this.store.update(provider, "EMAIL_VERIFICATION");
    const link = await this.emailBroker.findVerificationLink(provider.id, new Date(Date.now() - 15 * 60_000));
    if (provider.onboarding.blockers.includes("EMAIL_CONFIRMATION") && !link) {
      return this.store.update(provider, "HUMAN_GATE", {
        humanGate: {
          kind: "EMAIL_CONFIRMATION",
          reason: "Email verification is required and no EmailVerificationBroker is connected.",
          action: "Confirm the email manually, then rerun pnpm providers:resume.",
          url: provider.dashboardUrl ?? provider.signupUrl
        }
      });
    }

    await this.store.update(provider, "DASHBOARD");
    await this.store.update(provider, "KEY_CREATION");
    const key = await this.browser.attemptApiKeyCreation(provider);
    if (key.status === "human-gate" && key.gate) {
      return this.store.update(provider, "HUMAN_GATE", { humanGate: key.gate });
    }
    if (key.status !== "captured" || !key.key) {
      return this.store.update(provider, "FAILED", { lastError: "API key was not captured." });
    }
    return this.store.update(provider, "VAULT_STORE", {
      lastError: "Live key capture is disabled unless a provider-specific safe adapter supplies the secret directly to Vault."
    });
  }

  private async validateAndRegister(provider: ProviderCatalogEntry): Promise<AutopilotProviderProgress> {
    await this.store.update(provider, "VALIDATION");
    try {
      const report = await validateProviderDetailed(provider, this.broker);
      const validation = {
        status: report.status.validationStatus,
        message: report.status.validationMessage,
        latencyMs: report.latencyMs,
        modelCount: report.modelCount,
        models: report.models,
        modelMetadata: report.modelMetadata,
        rateLimitHeaders: report.rateLimitHeaders
      };
      if (report.status.validationStatus === "failed") {
        return this.store.update(provider, "FAILED", {
          validation,
          lastError: redact(report.status.validationMessage ?? "validation failed")
        });
      }
      await this.store.update(provider, "FREELLM_REGISTRATION", { validation });
      const freeLlmApi = await this.freeLlmApi.registerProvider(provider);
      await this.store.update(provider, "HEALTH_CHECK", { validation, freeLlmApi });
      return this.store.update(provider, "READY", { validation, freeLlmApi });
    } catch (error) {
      return this.store.update(provider, "FAILED", {
        lastError: redact(error instanceof Error ? error.message : String(error))
      });
    }
  }
}
