import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const TOKEN_DIR = join(homedir(), ".beyonder", "control-center");
const TOKEN_FILE = join(TOKEN_DIR, "auth-token.json");

export interface AuthToken {
  token: string;
  createdAt: string;
  expiresAt?: string;
}

export async function getOrCreateAuthToken(): Promise<string> {
  try {
    const data = await readFile(TOKEN_FILE, "utf-8");
    const stored: AuthToken = JSON.parse(data);
    if (stored.expiresAt && new Date(stored.expiresAt) < new Date()) {
      throw new Error("Token expired");
    }
    return stored.token;
  } catch {
    // Generate new token
    const token = randomBytes(32).toString("hex");
    const authToken: AuthToken = {
      token,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() // 1 year
    };
    await mkdir(TOKEN_DIR, { recursive: true });
    await writeFile(TOKEN_FILE, JSON.stringify(authToken, null, 2), { mode: 0o600 });
    return token;
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function validateAuthToken(providedToken: string): Promise<boolean> {
  const storedToken = await getOrCreateAuthToken();
  return hashToken(providedToken) === hashToken(storedToken);
}

export function extractAuthToken(request: Request): string | undefined {
  // Check Authorization header
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  // Check custom header
  return request.headers.get("x-beyonder-auth") ?? undefined;
}

export function assertValidAuthToken(request: Request) {
  const token = extractAuthToken(request);
  if (!token) {
    throw new Error("Authentication required: missing auth token");
  }
  // We can't do async here, so we'll validate in the route handler
  return token;
}

export function authHeaders(token: string) {
  return {
    "authorization": `Bearer ${token}`,
    "x-beyonder-auth": token
  };
}

export function getAuthTokenForUI(): Promise<string> {
  return getOrCreateAuthToken();
}