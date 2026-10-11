import { EnvHttpProxyAgent } from "undici";

let proxyAgent: EnvHttpProxyAgent | undefined;

/** Fixed provider/catalog requests honor the operator's existing egress proxy. */
export function providerFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  if (!(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy)) return fetch(input, init);
  proxyAgent ??= new EnvHttpProxyAgent();
  return fetch(input, { ...init, dispatcher: proxyAgent } as RequestInit);
}
