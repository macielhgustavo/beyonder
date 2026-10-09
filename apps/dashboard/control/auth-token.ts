import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";

function tokenFile() { return join(process.env.BEYONDER_CONTROL_AUTH_DIR ?? join(homedir(), ".beyonder", "control-center"), "auth-token.json"); }

export interface AuthToken {
  token: string;
  createdAt: string;
  expiresAt?: string;
}

export async function getOrCreateAuthToken(): Promise<string> {
  const TOKEN_FILE = tokenFile();
  const TOKEN_DIR = join(TOKEN_FILE, "..");
  try {
    const data = await readFile(TOKEN_FILE, "utf-8");
    const stored: AuthToken = JSON.parse(data);
    await chmod(TOKEN_FILE, 0o600);
    if (!/^[a-f0-9]{64}$/.test(stored.token)) throw new Error("Invalid token file");
    if (stored.expiresAt && new Date(stored.expiresAt) < new Date()) {
      throw new Error("Token expired");
    }
    return stored.token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // Generate new token
    const token = randomBytes(32).toString("hex");
    const authToken: AuthToken = {
      token,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() // 1 year
    };
    await mkdir(TOKEN_DIR, { recursive: true, mode: 0o700 });
    try {
      await writeFile(TOKEN_FILE, JSON.stringify(authToken, null, 2), { mode: 0o600, flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return getOrCreateAuthToken();
      throw error;
    }
    return token;
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function validateAuthToken(providedToken: string): Promise<boolean> {
  const storedToken = await getOrCreateAuthToken();
  return timingSafeEqual(Buffer.from(hashToken(providedToken), "hex"), Buffer.from(hashToken(storedToken), "hex"));
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
