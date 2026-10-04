import { describe, expect, it, vi } from "vitest";
import { BrowserPolicyEngine, mergeBrowserPolicy, type AddressResolver } from "./policy.js";
import { proxyBrowserRequest } from "./playwright-session.js";
import { pinnedRequestOptions, type BrowserNetworkTransport } from "./pinned-transport.js";

class AlternatingResolver implements AddressResolver {
  readonly calls: string[] = [];
  constructor(private readonly answers: Record<string, string[][]>) {}
  async resolve(hostname: string): Promise<string[]> {
    this.calls.push(hostname);
    const values = this.answers[hostname] ?? [["93.184.216.34"]];
    return values.shift() ?? values.at(-1) ?? ["93.184.216.34"];
  }
}

function request(url: string) {
  return { url: () => url, method: () => "GET", headers: () => ({ accept: "text/html" }), postDataBuffer: () => null };
}

function route() {
  return { continue: vi.fn(), fulfill: vi.fn(), abort: vi.fn() };
}

describe("socket-bound SSRF enforcement", () => {
  it("pins the socket to the validated public address even if DNS later rebinds", async () => {
    const resolver = new AlternatingResolver({ "attacker.test": [["93.184.216.34"], ["127.0.0.1"]] });
    const engine = new BrowserPolicyEngine(mergeBrowserPolicy(), resolver);
    const first = await engine.resolveConnection("https://attacker.test/data");
    expect(first).toMatchObject({ decision: { allowed: true }, target: { address: "93.184.216.34", family: 4 } });
    if (!first.target) throw new Error("target missing");
    const options = pinnedRequestOptions(first.target);
    const connected = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      options.lookup?.("attacker.test", {}, (error, address, family) => error ? reject(error) : resolve({ address: String(address), family: Number(family) }));
    });
    expect(connected).toEqual({ address: "93.184.216.34", family: 4 });
    await expect(engine.resolveConnection("https://attacker.test/subresource")).resolves.toMatchObject({ decision: { allowed: false, reason: "internal-network-blocked" } });
  });

  it("revalidates redirects and every subresource without letting Chromium connect", async () => {
    const resolver = new AlternatingResolver({
      "public.test": [["93.184.216.34"]],
      "cdn.test": [["93.184.216.35"]]
    });
    const engine = new BrowserPolicyEngine(mergeBrowserPolicy(), resolver);
    const targets: string[] = [];
    const transport: BrowserNetworkTransport = { fetch: vi.fn(async (_input, target) => {
      targets.push(target.address ?? "system");
      return { status: 200, headers: { "content-type": "text/plain" }, body: Buffer.from("ok") };
    }) };

    const publicRoute = route();
    await proxyBrowserRequest(publicRoute, request("https://public.test/"), engine, transport);
    expect(publicRoute.fulfill).toHaveBeenCalledOnce();
    expect(publicRoute.continue).not.toHaveBeenCalled();

    for (const blocked of [
      "http://localhost/admin",
      "http://10.0.0.1/private",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::ffff:127.0.0.1]/",
      "http://[fe80::1]/",
      "http://[fd00::1]/"
    ]) {
      const blockedRoute = route();
      await proxyBrowserRequest(blockedRoute, request(blocked), engine, transport);
      expect(blockedRoute.abort).toHaveBeenCalledWith("blockedbyclient");
      expect(blockedRoute.continue).not.toHaveBeenCalled();
      expect(blockedRoute.fulfill).not.toHaveBeenCalled();
    }
    expect(targets).toEqual(["93.184.216.34"]);
  });

  it("preserves original Host and TLS SNI while using the pinned address", async () => {
    const engine = new BrowserPolicyEngine(mergeBrowserPolicy(), new AlternatingResolver({ "secure.test": [["203.0.113.10"]] }));
    const resolved = await engine.resolveConnection("https://secure.test:8443/path");
    if (!resolved.target) throw new Error("target missing");
    const options = pinnedRequestOptions(resolved.target);
    expect(options.hostname).toBe("secure.test");
    expect(options.servername).toBe("secure.test");
  });
});
