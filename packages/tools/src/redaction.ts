const SECRET_KEY_PATTERN = /(pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential|private[-_]?key)/i;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const KEY_VALUE_SECRET_PATTERN = /\b(api[_-]?key|token|secret|password)=([^\s&]+)/gi;
const REDACTED = "[REDACTED]";

export function redactSecrets(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry, seen));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    redacted[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactSecrets(entry, seen);
  }
  return redacted;
}

export function redactString(value: string): string {
  return value
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(KEY_VALUE_SECRET_PATTERN, (_match, key: string) => `${key}=${REDACTED}`);
}

export function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Tool execution failed.";
  return redactString(message).slice(0, 500);
}
