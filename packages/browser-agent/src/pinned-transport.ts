import { Agent as HttpAgent, request as httpRequest, type RequestOptions } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { connect as connectTls } from "node:tls";
import type { Socket } from "node:net";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import type { BrowserConnectionTarget } from "./policy.js";

export interface BrowserNetworkRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Buffer | null;
}

export interface BrowserNetworkResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export interface BrowserNetworkTransport {
  close?(): void;
  fetch(request: BrowserNetworkRequest, target: BrowserConnectionTarget): Promise<BrowserNetworkResponse>;
}

export interface PinnedHttpTransportOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
  proxyUrl?: string | null;
}

/**
 * HTTP(S) egress whose socket lookup is pinned to the address approved by the
 * browser policy. The URL hostname remains intact for Host and TLS SNI.
 */
export class PinnedHttpTransport implements BrowserNetworkTransport {
  private readonly agents = new Map<string, HttpAgent | HttpsAgent>();
  constructor(private readonly options: PinnedHttpTransportOptions = {}) {}

  close(): void { for (const agent of this.agents.values()) agent.destroy(); this.agents.clear(); }

  async fetch(input: BrowserNetworkRequest, target: BrowserConnectionTarget): Promise<BrowserNetworkResponse> {
    const url = target.url;
    const headers = sanitizeRequestHeaders(input.headers, url.host, input.body);
    const requestOptions: RequestOptions = {
      protocol: url.protocol,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: input.method,
      headers,
      agent: false,
      ...pinnedRequestOptions(target)
    };

    const proxy = this.options.proxyUrl === null ? undefined : this.options.proxyUrl
      ?? environmentProxy(url);
    if (proxy) {
      const key = `${proxy}|${url.origin}|${target.address ?? "internal-opt-in"}`;
      let agent = this.agents.get(key);
      if (!agent) {
        agent = url.protocol === "https:" ? new HttpsAgent({ keepAlive: true, maxSockets: 6 }) : new HttpAgent({ keepAlive: true, maxSockets: 6 });
        Object.assign(agent, { createConnection: (_options: unknown, callback: (error: Error | null, socket?: Socket) => void) => {
          void pinnedProxyTunnel(new URL(proxy), target, this.options.timeoutMs ?? 20_000).then(socket => callback(null, socket), error => callback(error));
        } });
        this.agents.set(key, agent);
      }
      requestOptions.agent = agent;
    }

    return new Promise((resolve, reject) => {
      const requester = url.protocol === "https:" ? httpsRequest : httpRequest;
      const request = requester(requestOptions, (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > (this.options.maxResponseBytes ?? 32 * 1024 * 1024)) {
            request.destroy(new Error("Browser response exceeded the egress size limit."));
            return;
          }
          chunks.push(chunk);
        });
        response.once("aborted", () => reject(new Error("Browser upstream response closed before completion.")));
        response.once("error", reject);
        response.once("end", () => {
          try {
            resolve(decodeBrowserResponse({
              status: response.statusCode ?? 502,
              headers: responseHeaders(response.rawHeaders),
              body: Buffer.concat(chunks)
            }, this.options.maxResponseBytes ?? 32 * 1024 * 1024));
          } catch (error) {
            reject(error);
          }
        });
      });
      // Bound queueing, connection establishment and streaming together; a
      // trickle of bytes must not keep a request alive indefinitely.
      const deadline = setTimeout(() => request.destroy(new Error("Browser egress request timed out.")), this.options.timeoutMs ?? 20_000);
      request.once("close", () => clearTimeout(deadline));
      request.once("error", reject);
      if (input.body?.length) request.write(input.body);
      request.end();
    });
  }
}

/** CONNECT uses the policy-approved IP, never a second lookup of the target host. */
export async function pinnedProxyTunnel(proxy: URL, target: BrowserConnectionTarget, timeoutMs: number): Promise<Socket> {
  if (!["http:", "https:"].includes(proxy.protocol)) throw new Error("Unsupported browser proxy protocol.");
  const address = target.address ?? target.url.hostname.replace(/^\[|\]$/g, "");
  const authority = `${address.includes(":") ? `[${address}]` : address}:${target.url.port || (target.url.protocol === "https:" ? "443" : "80")}`;
  const request = (proxy.protocol === "https:" ? httpsRequest : httpRequest)({
    hostname: proxy.hostname, port: proxy.port || (proxy.protocol === "https:" ? 443 : 80),
    method: "CONNECT", path: authority, agent: false,
    headers: { host: authority, ...(proxy.username || proxy.password ? { "proxy-authorization": `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}` } : {}) }
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => request.destroy(new Error("Browser proxy tunnel timed out.")), timeoutMs);
    request.once("error", (error) => { clearTimeout(timer); reject(error); });
    request.once("connect", (response, socket, head) => {
      clearTimeout(timer);
      if (response.statusCode !== 200) { socket.destroy(); reject(new Error(`Browser proxy CONNECT rejected: HTTP ${response.statusCode}.`)); return; }
      if (head.length) socket.unshift(head);
      if (target.url.protocol !== "https:") { resolve(socket); return; }
      const tls = connectTls({ socket, servername: target.url.hostname.replace(/^\[|\]$/g, ""), rejectUnauthorized: true, ALPNProtocols: ["http/1.1"] });
      const tlsTimer = setTimeout(() => tls.destroy(new Error("Browser TLS handshake timed out.")), timeoutMs);
      tls.once("secureConnect", () => { clearTimeout(tlsTimer); resolve(tls); });
      tls.once("error", (error) => { clearTimeout(tlsTimer); reject(error); });
    });
    request.end();
  });
}

function environmentProxy(url: URL): string | undefined {
  const exclusions = (process.env.NO_PROXY ?? process.env.no_proxy ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  const host = url.hostname.toLowerCase();
  if (exclusions.some(value => value === "*" || host === value || host.endsWith(value.startsWith(".") ? value : `.${value}`))) return undefined;
  return url.protocol === "https:" ? process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy : process.env.HTTP_PROXY ?? process.env.http_proxy;
}

export function pinnedRequestOptions(target: BrowserConnectionTarget): {
  hostname: string;
  servername?: string;
  lookup?: NonNullable<RequestOptions["lookup"]>;
} {
  const lookup: NonNullable<RequestOptions["lookup"]> | undefined = target.address ? (_hostname, options, callback) => {
    if (typeof options === "object" && options.all) callback(null, [{ address: target.address!, family: target.family! }]);
    else callback(null, target.address!, target.family!);
  } : undefined;
  return {
    hostname: target.url.hostname,
    ...(target.url.protocol === "https:" ? { servername: target.url.hostname } : {}),
    ...(lookup ? { lookup } : {})
  };
}

function sanitizeRequestHeaders(headers: Record<string, string>, host: string, body?: Buffer | null): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (["connection", "proxy-connection", "proxy-authorization", "transfer-encoding", "host", "accept-encoding"].includes(key.toLowerCase())) continue;
    if (!body && key.toLowerCase() === "content-length") continue;
    result[key] = value;
  }
  result.host = host;
  result["accept-encoding"] = "identity";
  return result;
}

export function decodeBrowserResponse(response: BrowserNetworkResponse, maxResponseBytes: number): BrowserNetworkResponse {
  const encodings = (response.headers["content-encoding"] ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  let body = response.body;
  for (const encoding of encodings.reverse()) {
    if (encoding === "identity") continue;
    if (encoding === "gzip" || encoding === "x-gzip") body = gunzipSync(body, { maxOutputLength: maxResponseBytes });
    else if (encoding === "deflate") body = inflateSync(body, { maxOutputLength: maxResponseBytes });
    else if (encoding === "br") body = brotliDecompressSync(body, { maxOutputLength: maxResponseBytes });
    else throw new Error(`Unsupported browser response content encoding '${encoding}'.`);
  }
  if (body.length > maxResponseBytes) throw new Error("Browser response exceeded the egress size limit after decoding.");
  const headers = { ...response.headers };
  if (encodings.length) {
    delete headers["content-encoding"];
    delete headers["content-length"];
  }
  return { ...response, headers, body };
}

function responseHeaders(raw: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < raw.length; index += 2) {
    const key = raw[index]?.toLowerCase();
    const value = raw[index + 1];
    if (!key || value === undefined || ["connection", "transfer-encoding"].includes(key)) continue;
    // HTTP list-valued fields combine with commas. Arbitrary embedded newlines
    // (for example repeated Report-To) invalidate Chromium's fulfilled response
    // and leave navigation waiting even after the complete body was received.
    // Set-Cookie is the exception: Playwright preserves its separate values.
    result[key] = result[key] ? `${result[key]}${key === "set-cookie" ? "\n" : ", "}${value}` : value;
  }
  return result;
}
