import type { ProviderCatalogEntry } from "./types.js";

export interface FreeLlmApiRegistrationResult {
  status: "not-configured" | "registered" | "skipped" | "failed";
  message?: string;
}

export class FreeLlmApiIntegrator {
  constructor(private readonly baseUrl = process.env.FREELLMAPI_BASE_URL) {}

  async registerProvider(provider: ProviderCatalogEntry): Promise<FreeLlmApiRegistrationResult> {
    if (!this.baseUrl) {
      return { status: "not-configured", message: "FREELLMAPI_BASE_URL not set; registration skipped." };
    }
    if (provider.classification === "PAID_ONLY" || provider.billingRisk) {
      return { status: "skipped", message: "Provider has billing risk; explicit approval required before gateway registration." };
    }
    return { status: "skipped", message: "No official FreeLLMAPI key-registration API configured for this local package." };
  }
}
