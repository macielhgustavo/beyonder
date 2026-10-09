import { describe, expect, it, vi } from "vitest";
import { gzipSync, zstdCompressSync } from "node:zlib";
import { BrowserPolicyEngine, SystemAddressResolver, mergeBrowserPolicy, type AddressResolver } from "./policy.js";
import { proxyBrowserRequest } from "./playwright-session.js";
import { decodeBrowserResponse, pinnedRequestOptions, type BrowserNetworkTransport, type BrowserNetworkResponse } from "./pinned-transport.js";

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
  it.each(["POST", "PUT", "DELETE"])("rejects an unapproved %s before making any network request", async method => {
    const engine = new BrowserPolicyEngine(mergeBrowserPolicy(), new AlternatingResolver({}));
    const transport: BrowserNetworkTransport = { fetch: vi.fn() };
    const intercepted = route();
    await proxyBrowserRequest(intercepted, { ...request("https://public.test/write"), method: () => method }, engine, transport);
    expect(transport.fetch).not.toHaveBeenCalled();
    expect(intercepted.abort).toHaveBeenCalledWith("blockedbyclient");
  });
  it.each([307, 308])("never replays an approved mutation through HTTP %s", async status => {
    const engine = new BrowserPolicyEngine(mergeBrowserPolicy(), new AlternatingResolver({}));
    const transport: BrowserNetworkTransport = { fetch: vi.fn(async () => ({ status, headers: { location: "https://other.test/write" }, body: Buffer.alloc(0) })) };
    const intercepted = route();
    await proxyBrowserRequest(intercepted, { ...request("https://public.test/write"), method: () => "POST" }, engine, transport, undefined, () => true);
    expect(transport.fetch).toHaveBeenCalledTimes(1);
    expect(intercepted.abort).toHaveBeenCalledWith("blockedbyclient");
  });
  it("resolves both address families concurrently and rejects a private AAAA alongside public IPv4", async () => {
    const resolver = new SystemAddressResolver({ resolve4: vi.fn(async () => ["93.184.216.34"]), resolve6: vi.fn(async () => ["::1"]) } as never);
    const engine = new BrowserPolicyEngine(mergeBrowserPolicy(), resolver);
    expect(await engine.resolveConnection("https://dual-stack.test/")).toMatchObject({ decision: { allowed: false, reason: "internal-network-blocked" } });
  });

  it("accepts genuine IPv4-only hosts without silently discarding a DNS timeout", async () => {
    const missing = Object.assign(new Error("no IPv6"), { code: "ENODATA" });
    const resolve6 = vi.fn().mockRejectedValue(Object.assign(new Error("DNS timed out"), { code: "ETIMEOUT" })).mockRejectedValueOnce(missing);
    const resolver = new SystemAddressResolver({ resolve4: vi.fn(async () => ["93.184.216.34"]), resolve6 } as never);
    const engine = new BrowserPolicyEngine(mergeBrowserPolicy(), resolver);
    expect(await engine.resolveConnection("https://ipv4-only.test/")).toMatchObject({ target: { address: "93.184.216.34" } });
    expect(await engine.resolveConnection("https://ipv4-only.test/next")).toMatchObject({ decision: { allowed: false, reason: "dns-resolution-failed" } });
  });
  it("coalesces concurrent DNS observations without caching a completed public answer", async () => {
    let release!: (addresses: string[]) => void;
    const first = new Promise<string[]>(resolve => { release = resolve; });
    const resolve4 = vi.fn().mockReturnValueOnce(first).mockResolvedValue(["127.0.0.1"]);
    const resolver = new SystemAddressResolver({ resolve4, resolve6: vi.fn(async () => []) } as never);
    const engine = new BrowserPolicyEngine(mergeBrowserPolicy(), resolver);
    const pending = [engine.resolveConnection("https://rebinding.test/a"), engine.resolveConnection("https://rebinding.test/b")];
    expect(resolve4).toHaveBeenCalledTimes(1);
    release(["93.184.216.34"]);
    expect(await Promise.all(pending)).toEqual([expect.objectContaining({ target: expect.objectContaining({ address: "93.184.216.34" }) }), expect.objectContaining({ target: expect.objectContaining({ address: "93.184.216.34" }) })]);
    expect(await engine.resolveConnection("https://rebinding.test/c")).toMatchObject({ decision: { allowed: false, reason: "internal-network-blocked" } });
    expect(resolve4).toHaveBeenCalledTimes(2);
  });
  it("retries both families after a transient DNS failure and rejects a private retry answer", async () => {
    const resolve4 = vi.fn().mockResolvedValue(["93.184.216.34"]);
    const resolve6 = vi.fn().mockRejectedValueOnce(Object.assign(new Error("temporary DNS timeout"), { code: "ETIMEOUT" })).mockResolvedValue(["::1"]);
    const engine = new BrowserPolicyEngine(mergeBrowserPolicy(), new SystemAddressResolver({ resolve4, resolve6 } as never));
    expect(await engine.resolveConnection("https://retry.test/")).toMatchObject({ decision: { allowed: false, reason: "internal-network-blocked" } });
    expect(resolve4).toHaveBeenCalledTimes(2);
    expect(resolve6).toHaveBeenCalledTimes(2);
  });
  it("never retries away an observed private address when the other DNS family times out", async () => {
    const resolve4 = vi.fn().mockResolvedValueOnce(["127.0.0.1"]).mockResolvedValue(["93.184.216.34"]);
    const resolve6 = vi.fn().mockRejectedValue(Object.assign(new Error("temporary DNS timeout"), { code: "ETIMEOUT" }));
    const engine = new BrowserPolicyEngine(mergeBrowserPolicy(), new SystemAddressResolver({ resolve4, resolve6 } as never));
    expect(await engine.resolveConnection("https://mixed.test/")).toMatchObject({ decision: { allowed: false, reason: "internal-network-blocked" } });
    expect(resolve4).toHaveBeenCalledTimes(1);
    expect(resolve6).toHaveBeenCalledTimes(1);
  });
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
    const engine = new BrowserPolicyEngine(mergeBrowserPolicy(), new AlternatingResolver({ "secure.test": [["93.184.216.34"]] }));
    const resolved = await engine.resolveConnection("https://secure.test:8443/path");
    if (!resolved.target) throw new Error("target missing");
    const options = pinnedRequestOptions(resolved.target);
    expect(options.hostname).toBe("secure.test");
    expect(options.servername).toBe("secure.test");
  });

  it("decodes compressed upstream bodies before fulfilling Chromium", () => {
    const decoded = decodeBrowserResponse({ status: 200, headers: { "content-type": "text/html", "content-encoding": "gzip", "content-length": "99" }, body: gzipSync(Buffer.from("<h1>Python 3.14.8</h1>")) }, 1_024);
    expect(decoded.body.toString()).toBe("<h1>Python 3.14.8</h1>");
    expect(decoded.headers).toEqual({ "content-type": "text/html" });
  });

  it("decodes zstd compressed upstream bodies", () => {
    const decoded = decodeBrowserResponse({ status: 200, headers: { "content-type": "application/json", "content-encoding": "zstd" }, body: zstdCompressSync(Buffer.from('{"version": "3.14.8"}')) }, 1_024);
    expect(decoded.body.toString()).toBe('{"version": "3.14.8"}');
    expect(decoded.headers).toEqual({ "content-type": "application/json" });
  });

  it("fails closed for unsupported response encodings", () => {
    expect(() => decodeBrowserResponse({ status: 200, headers: { "content-encoding": "x-unsupported" }, body: Buffer.from("opaque") }, 1_024)).toThrow(/Unsupported/);
  });

  it.each(["http://127.0.0.1/admin", "http://[::ffff:7f00:1]/", "http://169.254.169.254/latest/"])("never fulfills an HTTP redirect to a private target: %s", async location => {
    const engine = new BrowserPolicyEngine(mergeBrowserPolicy(), new AlternatingResolver({}));
    const transport: BrowserNetworkTransport = { fetch: vi.fn(async () => ({ status: 307, headers: { location }, body: Buffer.alloc(0) })) };
    const intercepted = route();
    await proxyBrowserRequest(intercepted, request("https://public.test/"), engine, transport);
    expect(intercepted.abort).toHaveBeenCalledWith("blockedbyclient");
    expect(intercepted.fulfill).not.toHaveBeenCalled();
    expect(transport.fetch).toHaveBeenCalledOnce();
  });

  it("resolves and pins every hop of a subresource redirect chain", async () => {
    const engine = new BrowserPolicyEngine(mergeBrowserPolicy(), new AlternatingResolver({ "public.test": [["93.184.216.34"]], "cdn.test": [["93.184.216.35"]] }));
    const targets: string[] = [];
    const transport: BrowserNetworkTransport = { fetch: vi.fn(async (input, target): Promise<BrowserNetworkResponse> => {
      targets.push(target.address!);
      if (input.url.includes("public.test")) return { status: 302, headers: { location: "https://cdn.test/image" }, body: Buffer.alloc(0) };
      return { status: 200, headers: { "content-type": "image/png" }, body: Buffer.from("observed") };
    }) };
    const intercepted = route();
    await proxyBrowserRequest(intercepted, request("https://public.test/image"), engine, transport);
    expect(targets).toEqual(["93.184.216.34", "93.184.216.35"]);
    expect(intercepted.fulfill).toHaveBeenCalledWith(expect.objectContaining({ status: 200 }));
    expect(intercepted.continue).not.toHaveBeenCalled();
  });

  it("stages main-frame redirects as a new intercepted navigation", async () => {
    const engine = new BrowserPolicyEngine(mergeBrowserPolicy(), new AlternatingResolver({}));
    const transport: BrowserNetworkTransport = { fetch: vi.fn(async () => ({ status: 307, headers: { location: "/docs", "set-cookie": "locale=en" }, body: Buffer.alloc(0) })) };
    const intercepted = route();
    const navigate = vi.fn();
    await proxyBrowserRequest(intercepted, request("https://public.test/"), engine, transport, navigate);
    expect(navigate).toHaveBeenCalledWith("https://public.test/docs");
    expect(intercepted.fulfill).toHaveBeenCalledWith(expect.objectContaining({ status: 200, headers: expect.not.objectContaining({ location: expect.anything() }) }));
    expect(intercepted.continue).not.toHaveBeenCalled();
  });
});
