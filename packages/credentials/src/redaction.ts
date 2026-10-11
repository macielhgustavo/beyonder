const sensitive = /^(?:api[_-]?key|token|secret|authorization|bearer|private[_-]?key|credentials?|password|passphrase|cookie)$/i;
function safe(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return value.replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{20,})\b/g,'[REDACTED]').replace(/Bearer\s+[^\s,;"']+/gi,'Bearer [REDACTED]').replace(/([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*=)([^\s]+)/gi,'$1[REDACTED]');
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]'; seen.add(value);
  if (Array.isArray(value)) return value.map(v => safe(v,seen));
  return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,sensitive.test(key.replace(/([a-z])([A-Z])/g,'$1_$2')) || /(?:api_?key|token|secret|private_?key|password|authorization|credentials?)$/i.test(key.replace(/[^a-z]/gi,'')) ? '[REDACTED]' : safe(v,seen)]));
}
export function redact(value: unknown): string { const result = safe(value); return typeof result === 'string' ? result : JSON.stringify(result) ?? ''; }
export function fingerprint(_secret: string): string { return '[REDACTED]'; }
