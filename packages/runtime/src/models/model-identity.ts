/** Conservative physical identity across explicit gateway/provider spellings. */
export function physicalModelIdentity(model: string): string {
  if (!model.trim() || /^(?:auto|free|unknown|kilo-auto(?:\/free)?|openrouter\/(?:auto|free)|stealth\/.*)$/i.test(model)) return '';
  return model.split("/").at(-1)!.replace(/(?::|-)free$/i, "").replace(/^meta-/i, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function independentPhysicalModels(first: string, second: string): boolean {
  const a = physicalModelIdentity(first), b = physicalModelIdentity(second);
  return Boolean(a && b && a !== b);
}
