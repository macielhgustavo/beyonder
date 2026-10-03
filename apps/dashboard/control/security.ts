import type { NextRequest } from "next/server";

const SAFE_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function assertLocalRequest(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const hostname = host.split(":")[0];
  if (!SAFE_HOSTS.has(hostname)) {
    throw new Error("Control Center only accepts local requests.");
  }
  const origin = request.headers.get("origin");
  if (origin) {
    const parsed = new URL(origin);
    if (!SAFE_HOSTS.has(parsed.hostname) || parsed.host !== host) {
      throw new Error("Origin is not allowed for Control Center commands.");
    }
  }
}

export function commandHeaders() {
  return {
    "cache-control": "no-store",
    "x-beyonder-local-only": "true"
  };
}
