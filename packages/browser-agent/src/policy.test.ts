import { describe, expect, it } from "vitest";
import { BrowserPolicyEngine, isPrivateAddress, matchesDomain, mergeBrowserPolicy, type AddressResolver } from "./policy.js";

class FixedResolver implements AddressResolver {
  constructor(private readonly addresses: Record<string, string[]> = {}) {}
  async resolve(hostname: string): Promise<string[]> {
    return this.addresses[hostname] ?? ["93.184.216.34"];
  }
}

describe("BrowserPolicyEngine", () => {
  it("allows normal HTTP/HTTPS navigation", async () => {
    const engine = new BrowserPolicyEngine(mergeBrowserPolicy(), new FixedResolver());
    await expect(engine.evaluateNavigation("https://example.com/docs")).resolves.toMatchObject({ allowed: true });
    await expect(engine.evaluateNavigation("http://example.com/")).resolves.toMatchObject({ allowed: true });
  });

  it("blocks file:// and embedded credentials", async () => {
    const engine = new BrowserPolicyEngine(mergeBrowserPolicy(), new FixedResolver());
    await expect(engine.evaluateNavigation("file:///etc/passwd")).resolves.toMatchObject({ allowed: false, reason: "unsupported-scheme" });
    await expect(engine.evaluateNavigation("https://user:secret@example.com/")).resolves.toMatchObject({ allowed: false, reason: "credentials-in-url" });
  });

  it("applies allowDomains and denyDomains with deny precedence", async () => {
    const engine = new BrowserPolicyEngine(
      mergeBrowserPolicy({ allowDomains: ["example.com"], denyDomains: ["private.example.com"] }),
      new FixedResolver()
    );
    await expect(engine.evaluateNavigation("https://docs.example.com/")).resolves.toMatchObject({ allowed: true });
    await expect(engine.evaluateNavigation("https://private.example.com/")).resolves.toMatchObject({ allowed: false, reason: "domain-denied" });
    await expect(engine.evaluateNavigation("https://other.test/")).resolves.toMatchObject({ allowed: false, reason: "domain-not-allowed" });
  });

  it("blocks localhost, private DNS answers, and executable downloads", async () => {
    const resolver = new FixedResolver({ "internal.example": ["10.0.0.10"] });
    const engine = new BrowserPolicyEngine(mergeBrowserPolicy(), resolver);
    await expect(engine.evaluateNavigation("http://localhost:3000/")).resolves.toMatchObject({ allowed: false, reason: "internal-network-blocked" });
    await expect(engine.evaluateNavigation("https://internal.example/")).resolves.toMatchObject({ allowed: false, reason: "internal-network-blocked" });
    await expect(engine.evaluateNavigation("https://example.com/tool.exe")).resolves.toMatchObject({ allowed: false, reason: "executable-download-blocked" });
  });

  it("allows explicit internal-network policy only when trusted runtime enables it", async () => {
    const engine = new BrowserPolicyEngine(mergeBrowserPolicy({ allowInternalNetwork: true }), new FixedResolver());
    await expect(engine.evaluateNavigation("http://127.0.0.1:3000/")).resolves.toMatchObject({ allowed: true });
  });

  it("blocks payments, purchases, account creation, verification bypass and unauthorized side effects", async () => {
    const engine = new BrowserPolicyEngine(mergeBrowserPolicy(), new FixedResolver());
    await expect(
      engine.evaluateClick("s", { type: "click", target: { role: "button", name: "Purchase" } }, { tag: "button", name: "Purchase", isSubmit: true, formMethod: "post" })
    ).resolves.toMatchObject({ allowed: false, reason: "purchase-prohibited" });
    await expect(
      engine.evaluateClick("s", { type: "click", target: { role: "button", name: "Create account" } }, { tag: "button", name: "Create account", isSubmit: true, formMethod: "post" })
    ).resolves.toMatchObject({ allowed: false, reason: "account-creation-prohibited" });
    expect(engine.evaluateFill({ tag: "input", name: "Verification code", inputType: "text" })).toMatchObject({
      allowed: false,
      reason: "verification-bypass-prohibited"
    });
    await expect(
      engine.evaluateClick("s", { type: "click", target: { role: "button", name: "Save changes" } }, { tag: "button", name: "Save changes", isSubmit: true, formMethod: "post" })
    ).resolves.toMatchObject({ allowed: false, reason: "submit-disabled" });

    const submitEnabledEngine = new BrowserPolicyEngine(mergeBrowserPolicy({ allowSubmit: true }), new FixedResolver());
    await expect(
      submitEnabledEngine.evaluateClick("s", { type: "click", target: { role: "button", name: "Save changes" } }, { tag: "button", name: "Save changes", isSubmit: true, formMethod: "post" })
    ).resolves.toMatchObject({ allowed: false, reason: "authorization-required" });
  });

  it("allows authorized non-prohibited side effects", async () => {
    const engine = new BrowserPolicyEngine(mergeBrowserPolicy({ allowSubmit: true }), new FixedResolver());
    await expect(
      engine.evaluateClick(
        "s",
        { type: "click", target: { role: "button", name: "Save changes" }, authorizationId: "approval-1" },
        { tag: "button", name: "Save changes", isSubmit: true, formMethod: "post" },
        ({ authorizationId }) => authorizationId === "approval-1"
      )
    ).resolves.toMatchObject({ allowed: true });
  });
});

describe("network helpers", () => {
  it.each(["192.0.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "ff02::1", "2001:db8::1", "64:ff9b::7f00:1", "2002:7f00:1::"])("blocks reserved or transition address %s", address => {
    expect(isPrivateAddress(address)).toBe(true);
  });
  it("matches domains and identifies private addresses", () => {
    expect(matchesDomain("docs.example.com", "example.com")).toBe(true);
    expect(matchesDomain("example.com", "*.example.com")).toBe(false);
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("172.16.0.1")).toBe(true);
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
    expect(isPrivateAddress("fe80::1")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
  });
});
