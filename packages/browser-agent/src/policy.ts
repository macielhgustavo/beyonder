import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import type {
  BrowserAction,
  BrowserAuthorizationVerifier,
  BrowserElementInfo,
  BrowserPolicy,
  BrowserPolicyDecision
} from "./types.js";

export const DEFAULT_BROWSER_POLICY: BrowserPolicy = {
  allowDomains: [],
  denyDomains: [],
  allowNavigation: true,
  allowFormFill: true,
  allowDownload: false,
  allowUpload: false,
  allowSubmit: false,
  allowInternalNetwork: false
};

const EXECUTABLE_EXTENSIONS = /\.(?:exe|msi|msp|msix|dmg|pkg|appimage|deb|rpm|apk|bat|cmd|com|scr|ps1|psm1|sh|bash|zsh|fish|bin|jar)(?:$|[?#])/i;
const PAYMENT_PATTERN = /\b(?:pay|payment|billing|credit\s*card|debit\s*card|card\s*number|cvv|cvc|checkout|stripe|paypal)\b/i;
const PURCHASE_PATTERN = /\b(?:buy|purchase|place\s*order|complete\s*order|order\s*now|add\s*to\s*cart|subscribe\s*now)\b/i;
const ACCOUNT_CREATION_PATTERN = /\b(?:sign\s*up|signup|register|create\s+(?:an?\s+)?account|new\s+account)\b/i;
const VERIFICATION_BYPASS_PATTERN = /\b(?:captcha|2fa|two[-\s]*factor|one[-\s]*time\s*(?:code|password)|otp|authenticator|verification\s*code|kyc|identity\s*verification|passport)\b/i;
const POTENTIAL_SIDE_EFFECT_PATTERN = /\b(?:save|delete|remove|send|publish|confirm|transfer|invite|follow|like|post|create|logout|log\s*out)\b/i;

export interface AddressResolver {
  resolve(hostname: string): Promise<string[]>;
}

export interface BrowserConnectionTarget {
  url: URL;
  address?: string;
  family?: 4 | 6;
}

export type BrowserConnectionDecision =
  | { decision: BrowserPolicyDecision; target: BrowserConnectionTarget }
  | { decision: BrowserPolicyDecision; target?: undefined };

export class SystemAddressResolver implements AddressResolver {
  private readonly inFlight = new Map<string, Promise<string[]>>();
  constructor(private readonly resolver: Pick<Resolver, "resolve4" | "resolve6"> = new Resolver({ timeout: 1_000, tries: 2 })) {}
  resolve(hostname: string): Promise<string[]> {
    const pending = this.inFlight.get(hostname);
    if (pending) return pending;
    // Concurrent resources may share an in-flight DNS observation, never a
    // completed cached answer. Every socket still uses a validated pinned IP;
    // the next batch re-resolves both families and can detect rebinding.
    const resolution = this.resolveBoth(hostname).catch(error => {
      if (!["ETIMEOUT", "ECONNREFUSED", "ESERVFAIL"].includes((error as { code?: string })?.code ?? "")) throw error;
      // Retry the complete observation, not just an omitted family. This stays
      // inside the caller's existing navigation/tool deadline and fails closed.
      return this.resolveBoth(hostname);
    }).finally(() => { this.inFlight.delete(hostname); });
    this.inFlight.set(hostname, resolution);
    return resolution;
  }
  private async resolveBoth(hostname: string): Promise<string[]> {
    // Resolve both families concurrently. OS getaddrinfo can block for five
    // seconds on AAAA in proxy environments. Neither family is silently dropped
    // on a network failure, and every returned address still passes policy.
    const results = await Promise.allSettled([this.resolver.resolve4(hostname), this.resolver.resolve6(hostname)]);
    const addresses = results.flatMap(result => result.status === "fulfilled" ? result.value : []);
    // A private answer from either family is already decisive. A timeout in
    // the other family must never trigger a retry that forgets this answer.
    if (addresses.some(isPrivateAddress)) return addresses;
    for (const result of results) {
      if (result.status === "rejected" && !["ENODATA", "ENOTFOUND"].includes((result.reason as { code?: string })?.code ?? "")) throw result.reason;
    }
    return addresses;
  }
}

export class BrowserPolicyEngine {
  constructor(
    readonly policy: BrowserPolicy = DEFAULT_BROWSER_POLICY,
    private readonly resolver: AddressResolver = new SystemAddressResolver()
  ) {}

  async evaluateNavigation(rawUrl: string): Promise<BrowserPolicyDecision> {
    return (await this.resolveConnection(rawUrl)).decision;
  }

  /**
   * Resolves and validates the exact address that the network transport must use.
   * A caller must not discard `target.address` and perform an independent DNS
   * lookup; doing so would reopen a DNS-rebinding window.
   */
  async resolveConnection(rawUrl: string): Promise<BrowserConnectionDecision> {
    if (!this.policy.allowNavigation) return { decision: denied("navigation-disabled") };

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { decision: denied("unsupported-scheme", "URL could not be parsed.") };
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { decision: denied("unsupported-scheme", `Protocol ${url.protocol || "unknown"} is not allowed.`) };
    }
    if (url.username || url.password) {
      return { decision: denied("credentials-in-url", "Credentials embedded in URLs are not allowed.") };
    }

    const hostname = normalizeHostname(url.hostname);
    if (matchesAnyDomain(hostname, this.policy.denyDomains)) {
      return { decision: denied("domain-denied", `Domain ${hostname} is denied by policy.`) };
    }
    if (this.policy.allowDomains.length > 0 && !matchesAnyDomain(hostname, this.policy.allowDomains)) {
      return { decision: denied("domain-not-allowed", `Domain ${hostname} is not in allowDomains.`) };
    }
    if (EXECUTABLE_EXTENSIONS.test(`${url.pathname}${url.search}`)) {
      return { decision: denied("executable-download-blocked", "Executable downloads are always blocked.") };
    }
    const target = await this.resolveNetworkTarget(url, hostname);
    if (!target.decision.allowed) return target;
    return target;
  }

  evaluateFill(element: BrowserElementInfo): BrowserPolicyDecision {
    if (!this.policy.allowFormFill) return denied("form-fill-disabled");
    if (element.inputType?.toLowerCase() === "file") return denied("upload-disabled");

    const semantic = semanticText(element);
    if (PAYMENT_PATTERN.test(semantic)) return denied("payment-prohibited", "Payment fields are prohibited.");
    if (VERIFICATION_BYPASS_PATTERN.test(semantic)) {
      return denied("verification-bypass-prohibited", "CAPTCHA, 2FA, KYC, and verification bypass are prohibited.");
    }
    return allowed();
  }

  async evaluateClick(
    sessionId: string,
    action: Extract<BrowserAction, { type: "click" }>,
    element: BrowserElementInfo,
    verifier?: BrowserAuthorizationVerifier
  ): Promise<BrowserPolicyDecision> {
    const semantic = semanticText(element);
    if (PURCHASE_PATTERN.test(semantic)) return denied("purchase-prohibited", "Purchases are prohibited.");
    if (PAYMENT_PATTERN.test(semantic)) return denied("payment-prohibited", "Payments are prohibited.");
    if (ACCOUNT_CREATION_PATTERN.test(semantic)) {
      return denied("account-creation-prohibited", "Automatic account creation is outside this BrowserAgent scope.");
    }
    if (VERIFICATION_BYPASS_PATTERN.test(semantic)) {
      return denied("verification-bypass-prohibited", "CAPTCHA, 2FA, KYC, and verification bypass are prohibited.");
    }

    if (element.href) {
      const navigation = await this.evaluateNavigation(element.href);
      if (!navigation.allowed) return navigation;
    }

    const method = (element.formMethod ?? "get").toLowerCase();
    if (element.isSubmit && !this.policy.allowSubmit) return denied("submit-disabled");

    const potentiallyMutatingSubmit = element.isSubmit && method !== "get" && method !== "head";
    const potentiallyMutatingControl = POTENTIAL_SIDE_EFFECT_PATTERN.test(semantic);
    if (potentiallyMutatingSubmit || potentiallyMutatingControl) {
      if (!action.authorizationId || !verifier) {
        return denied("authorization-required", "This click may cause a real side effect and requires explicit runtime authorization.");
      }
      const authorized = await verifier({
        sessionId,
        authorizationId: action.authorizationId,
        action,
        element
      });
      if (!authorized) return denied("authorization-required", "Runtime authorization was missing or rejected.");
    }

    return allowed();
  }

  private async resolveNetworkTarget(url: URL, hostname: string): Promise<BrowserConnectionDecision> {
    if (this.policy.allowInternalNetwork) return { decision: allowed(), target: { url } };
    if (hostname === "localhost" || hostname.endsWith(".localhost")) {
      return { decision: denied("internal-network-blocked", "localhost is blocked by default.") };
    }

    if (isIP(hostname)) {
      return isPrivateAddress(hostname)
        ? { decision: denied("internal-network-blocked", `Private/internal address ${hostname} is blocked.`) }
        : { decision: allowed(), target: { url, address: hostname, family: isIP(hostname) as 4 | 6 } };
    }

    try {
      // Resolve every physical request. The selected address is returned to the
      // egress transport and is therefore the one used by the socket itself.
      const addresses = await this.resolver.resolve(hostname);
      if (addresses.length === 0) return { decision: denied("dns-resolution-failed", `No address resolved for ${hostname}.`) };
      if (addresses.some(isPrivateAddress)) {
        return { decision: denied("internal-network-blocked", `Domain ${hostname} resolves to a private/internal address.`) };
      }
      const address = addresses[0];
      const family = isIP(address);
      if (!family) return { decision: denied("dns-resolution-failed", `Resolver returned an invalid address for ${hostname}.`) };
      return { decision: allowed(), target: { url, address, family: family as 4 | 6 } };
    } catch {
      return { decision: denied("dns-resolution-failed", `DNS resolution failed for ${hostname}.`) };
    }
  }
}

export function mergeBrowserPolicy(overrides: Partial<BrowserPolicy> = {}): BrowserPolicy {
  return {
    ...DEFAULT_BROWSER_POLICY,
    ...overrides,
    allowDomains: normalizeDomains(overrides.allowDomains ?? DEFAULT_BROWSER_POLICY.allowDomains),
    denyDomains: normalizeDomains(overrides.denyDomains ?? DEFAULT_BROWSER_POLICY.denyDomains)
  };
}

export function matchesDomain(hostname: string, pattern: string): boolean {
  const host = normalizeHostname(hostname);
  const normalizedPattern = normalizeHostname(pattern.replace(/^\*\./, ""));
  if (!normalizedPattern) return false;
  if (pattern.startsWith("*.")) return host.endsWith(`.${normalizedPattern}`) && host !== normalizedPattern;
  return host === normalizedPattern || host.endsWith(`.${normalizedPattern}`);
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    const octets = normalized.split(".").map(Number);
    const [a, b, c] = octets;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
    if (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    if (a !== undefined && a >= 224) return true;
    return false;
  }
  if (ipVersion === 6) {
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    if (normalized.startsWith("::ffff:")) {
      const mapped = normalized.slice("::ffff:".length);
      if (isIP(mapped) === 4) return isPrivateAddress(mapped);
      const groups = mapped.split(":");
      if (groups.length === 2 && groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) {
        const high = Number.parseInt(groups[0], 16);
        const low = Number.parseInt(groups[1], 16);
        return isPrivateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
      }
    }
    // Default browser egress accepts ordinary global unicast only. This also
    // closes multicast, documentation and deprecated transition-address paths.
    const first = Number.parseInt(normalized.split(":")[0] ?? "", 16);
    if (!(first >= 0x2000 && first <= 0x3fff)) return true;
    if (first === 0x2002 || first === 0x3ffe) return true;
    if (first === 0x2001) {
      const second = Number.parseInt(normalized.split(":")[1] || "0", 16);
      if (second < 0x200 || second === 0xdb8) return true;
    }
  }
  return false;
}

function matchesAnyDomain(hostname: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesDomain(hostname, pattern));
}

function normalizeDomains(domains: string[]): string[] {
  return [...new Set(domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean))];
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function semanticText(element: BrowserElementInfo): string {
  return [element.name, element.role, element.inputType, element.href, element.formAction].filter(Boolean).join(" ");
}

function allowed(): BrowserPolicyDecision {
  return { allowed: true, reason: "allowed" };
}

function denied(reason: Exclude<BrowserPolicyDecision["reason"], "allowed">, detail?: string): BrowserPolicyDecision {
  return detail ? { allowed: false, reason, detail } : { allowed: false, reason };
}
