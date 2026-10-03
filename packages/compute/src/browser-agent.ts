import { spawn } from "node:child_process";
import type { HumanGateKind, ProviderCatalogEntry } from "./types.js";

export interface BrowserHumanGate {
  kind: HumanGateKind;
  reason: string;
  action: string;
  url?: string;
}

export interface BrowserAgent {
  open(provider: ProviderCatalogEntry, url: string): Promise<void>;
  attemptSignup(provider: ProviderCatalogEntry): Promise<{ status: "opened" | "human-gate" | "unsupported"; gate?: BrowserHumanGate }>;
  attemptApiKeyCreation(provider: ProviderCatalogEntry): Promise<{ status: "captured" | "human-gate" | "unsupported"; key?: string; gate?: BrowserHumanGate }>;
  waitForHumanGateResolution(provider: ProviderCatalogEntry, gate: BrowserHumanGate): Promise<"resolved" | "still-blocked">;
}

export class SystemBrowserAgent implements BrowserAgent {
  constructor(private readonly allowBrowser = process.env.PROVIDER_BOOTSTRAPPER_OPEN_BROWSER === "1") {}

  async open(_provider: ProviderCatalogEntry, url: string): Promise<void> {
    if (!this.allowBrowser) return;
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(opener, args, { detached: true, stdio: "ignore" });
    child.unref();
  }

  async attemptSignup(provider: ProviderCatalogEntry) {
    const url = provider.apiKeyUrl ?? provider.dashboardUrl ?? provider.signupUrl;
    await this.open(provider, url);
    const blocker = provider.onboarding?.blockers[0] ?? "UNKNOWN";
    return {
      status: "human-gate" as const,
      gate: {
        kind: blocker,
        reason: `Provider signup/key generation for ${provider.name} requires user-controlled account interaction.`,
        action: humanActionFor(blocker),
        url
      }
    };
  }

  async attemptApiKeyCreation(provider: ProviderCatalogEntry) {
    const url = provider.apiKeyUrl ?? provider.dashboardUrl ?? provider.signupUrl;
    await this.open(provider, url);
    const blocker = provider.onboarding?.blockers[0] ?? "UNKNOWN";
    return {
      status: "human-gate" as const,
      gate: {
        kind: blocker,
        reason: `API key creation for ${provider.name} is not safely automatable without observing the live dashboard.`,
        action: `Create the API key in the opened page, then store it with pnpm providers:vault:set ${provider.id}.`,
        url
      }
    };
  }

  async waitForHumanGateResolution(): Promise<"resolved" | "still-blocked"> {
    return "still-blocked";
  }
}

function humanActionFor(kind: HumanGateKind): string {
  switch (kind) {
    case "CAPTCHA":
      return "Resolve the CAPTCHA in the opened browser window.";
    case "CLOUDFLARE_CHALLENGE":
      return "Complete the Cloudflare/browser challenge in the opened window.";
    case "TWO_FACTOR":
      return "Complete the 2FA/TOTP challenge yourself.";
    case "SMS_OR_PHONE":
      return "Complete the phone/SMS verification yourself.";
    case "OAUTH_CONSENT":
      return "Review and approve the OAuth consent yourself if you agree.";
    case "EMAIL_CONFIRMATION":
      return "Confirm the signup email, or connect an EmailVerificationBroker.";
    case "KYC":
      return "Complete identity verification manually; autopilot will not automate KYC.";
    case "PAYMENT_METHOD":
      return "Payment method is required; autopilot will not continue without explicit approval.";
    case "TERMS_CONSENT":
      return "Review the terms/consent screen yourself.";
    default:
      return "Complete the required human account step in the opened browser window.";
  }
}
