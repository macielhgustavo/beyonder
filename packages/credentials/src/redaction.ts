const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*=)([^\s]+)/gi
];

export function redact(value: unknown): string {
  let text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (match, prefix?: string) => {
      if (prefix && match.startsWith(prefix)) {
        return `${prefix}[REDACTED]`;
      }
      return "[REDACTED]";
    });
  }
  return text;
}

export function fingerprint(secret: string): string {
  if (secret.length <= 8) return "[REDACTED]";
  return `${secret.slice(0, 3)}…${secret.slice(-4)}`;
}
