/** Conservative physical identity across explicit gateway/provider spellings. */
export function physicalModelIdentity(model: string): string {
  return model.split("/").at(-1)!.replace(/(?::|-)free$/i, "").replace(/^meta-/i, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}
