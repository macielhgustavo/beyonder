import type { buildComputeInventory } from "@beyonder/compute";
import { inferRole } from "@beyonder/compute";
type Entry = ReturnType<typeof buildComputeInventory>[number];

/** Read-only discovery. No pull, model creation or remote quota is involved. */
export async function discoverOllama(baseUrl: string): Promise<Entry[]> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return [];
    const payload = await response.json() as { models?: Array<{ name?: string; capabilities?: string[] }> };
    const entries = await Promise.all((payload.models ?? []).slice(0, 30).map(async (item): Promise<Entry | undefined> => {
      if (!item.name || /:cloud$|-cloud$/.test(item.name)) return undefined;
      let capabilities: string[] = item.capabilities ?? [];
      try {
        const show = await fetch(`${baseUrl.replace(/\/$/, "")}/api/show`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: item.name }), signal: AbortSignal.timeout(1500) });
        if (show.ok) {
          const data = await show.json() as { capabilities?: string[]; remote_host?: string };
          if (data.remote_host) return undefined;
          capabilities = data.capabilities ?? capabilities;
        }
      } catch { /* Older/offline show endpoint: retain conservative unknown metadata. */ }
      const completion = capabilities.includes("completion");
      if (!completion) return undefined;
      return { providerId: "ollama", providerName: "Ollama (local)", status: "healthy", auth: "keyless", cost: "$0", models: [item.name], eligibleChatModels: [item.name], modelMetadata: [{ id: item.name, role: inferRole(item.name), capabilities: ["CHAT", ...(capabilities.includes("thinking") ? ["REASONING" as const] : [])], costClass: "FREE_CONFIRMED", structuredOutput: "native" }], toolCalling: capabilities.includes("tools") ? "yes" : "unknown", qualityClass: "unknown" };
    }));
    return entries.filter((entry): entry is Entry => Boolean(entry));
  } catch { return []; }
}
