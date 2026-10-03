const SENSITIVE_KEY = /(authorization|cookie|password|passwd|secret|token|api[-_]?key|session[-_]?id|credential)/i;
const SENSITIVE_QUERY_KEY = /(authorization|password|passwd|secret|token|api[-_]?key|session|credential|code)/i;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const SECRET_ASSIGNMENT = /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*([^\s,;]+)/gi;

export const REDACTED = "<redacted>";

export function redactUrl(input: string): string {
  try {
    const url = new URL(input);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.set(key, REDACTED);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return redactTextSecrets(input);
  }
}

export function redactTelemetryDetails(details: Record<string, unknown>): Record<string, unknown> {
  return redactValue(details) as Record<string, unknown>;
}

export function redactTextSecrets(input: string): string {
  return input.replace(BEARER_VALUE, `Bearer ${REDACTED}`).replace(SECRET_ASSIGNMENT, (_match, key: string) => `${key}=${REDACTED}`);
}

function redactValue(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === "string") {
    if (key?.toLowerCase().includes("url")) return redactUrl(value);
    return redactTextSecrets(value);
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, redactValue(child, childKey)]));
  }
  return value;
}
