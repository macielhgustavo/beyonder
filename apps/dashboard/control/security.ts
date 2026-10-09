import type { NextRequest } from "next/server";
import { assertValidAuthToken, validateAuthToken, getOrCreateAuthToken } from "./auth-token.js";

const SAFE_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export async function assertLocalRequest(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  let hostname: string;
  try { hostname = new URL(`http://${host}`).hostname; } catch { throw new Error("Host inválido."); }
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

  // Validate auth token for mutating operations
  const token = assertValidAuthToken(request);
  const isValid = await validateAuthToken(token);
  if (!isValid) {
    throw new Error("Invalid or expired authentication token");
  }
}

export function commandHeaders() {
  return {
    "cache-control": "no-store",
    "x-beyonder-local-only": "true"
  };
}

export function getAuthToken(): Promise<string> {
  return getOrCreateAuthToken();
}
