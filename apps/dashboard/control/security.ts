import type { NextRequest } from "next/server";
import { assertValidAuthToken, validateAuthToken, getOrCreateAuthToken } from "./auth-token";

const SAFE_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export class ControlAuthError extends Error {
  constructor(message: string, readonly status = 401) { super(message); }
}

export function assertLocalOrigin(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  let hostname: string;
  try { hostname = new URL(`http://${host}`).hostname; } catch { throw new ControlAuthError("Host inválido.", 403); }
  if (!SAFE_HOSTS.has(hostname)) {
    throw new ControlAuthError("Control Center only accepts local requests.", 403);
  }
  const origin = request.headers.get("origin");
  if (origin) {
    const parsed = new URL(origin);
    if (!SAFE_HOSTS.has(parsed.hostname) || parsed.host !== host) {
      throw new ControlAuthError("Origin is not allowed for Control Center commands.", 403);
    }
  }

}

export async function assertLocalRequest(request: NextRequest) {
  assertLocalOrigin(request);
  let token: string;
  try { token = assertValidAuthToken(request); } catch { throw new ControlAuthError("Authentication required"); }
  const isValid = await validateAuthToken(token);
  if (!isValid) {
    throw new ControlAuthError("Invalid or expired authentication token");
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
