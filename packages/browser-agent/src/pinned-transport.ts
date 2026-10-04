import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
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
  fetch(request: BrowserNetworkRequest, target: BrowserConnectionTarget): Promise<BrowserNetworkResponse>;
}

export interface PinnedHttpTransportOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
}

/**
 * HTTP(S) egress whose socket lookup is pinned to the address approved by the
 * browser policy. The URL hostname remains intact for Host and TLS SNI.
 */
export class PinnedHttpTransport implements BrowserNetworkTransport {
  constructor(private readonly options: PinnedHttpTransportOptions = {}) {}

  fetch(input: BrowserNetworkRequest, target: BrowserConnectionTarget): Promise<BrowserNetworkResponse> {
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
        response.once("end", () => resolve({
          status: response.statusCode ?? 502,
          headers: responseHeaders(response.rawHeaders),
          body: Buffer.concat(chunks)
        }));
      });
      request.setTimeout(this.options.timeoutMs ?? 20_000, () => request.destroy(new Error("Browser egress request timed out.")));
      request.once("error", reject);
      if (input.body?.length) request.write(input.body);
      request.end();
    });
  }
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
    if (["connection", "proxy-connection", "transfer-encoding", "host"].includes(key.toLowerCase())) continue;
    if (!body && key.toLowerCase() === "content-length") continue;
    result[key] = value;
  }
  result.host = host;
  return result;
}

function responseHeaders(raw: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < raw.length; index += 2) {
    const key = raw[index]?.toLowerCase();
    const value = raw[index + 1];
    if (!key || value === undefined || ["connection", "transfer-encoding"].includes(key)) continue;
    result[key] = result[key] ? `${result[key]}\n${value}` : value;
  }
  return result;
}
