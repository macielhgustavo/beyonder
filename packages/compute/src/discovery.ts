import { providers } from "./catalog.js";

export interface DiscoveryResult {
  known: string[];
  discovered: Array<{ id: string; name: string; status: "known" | "UNREVIEWED"; source: string }>;
}

const FREELLMAPI_REGISTRY_URL = "https://raw.githubusercontent.com/tashfeenahmed/freellmapi/main/server/src/providers/index.ts";

export async function discoverProviders(): Promise<DiscoveryResult> {
  const known = new Set(providers.map((provider) => provider.id));
  const response = await fetch(FREELLMAPI_REGISTRY_URL);
  if (!response.ok) {
    throw new Error(`Unable to fetch FreeLLMAPI registry: HTTP ${response.status}`);
  }
  const text = await response.text();
  const discovered = extractProviderRegistrations(text).map((entry) => ({
    ...entry,
    status: known.has(normalizeRegistryId(entry.id)) ? "known" as const : "UNREVIEWED" as const,
    source: FREELLMAPI_REGISTRY_URL
  }));
  return { known: [...known].sort(), discovered };
}

function normalizeRegistryId(id: string): string {
  const aliases: Record<string, string> = {
    google: "gemini",
    github: "github-models",
    nvidia: "nvidia-nim",
    kilo: "kilo-gateway",
    aihorde: "ai-horde",
    zhipu: "zai",
    cloudflare: "cloudflare-workers-ai",
    ollama: "ollama-cloud",
    "model-scope": "modelscope"
  };
  return aliases[id] ?? id;
}

function extractProviderRegistrations(source: string): Array<{ id: string; name: string }> {
  const entries = new Map<string, string>();
  const compatPattern = /platform:\s*'([^']+)'[\s\S]*?name:\s*'([^']+)'/g;
  for (const match of source.matchAll(compatPattern)) {
    entries.set(match[1], match[2]);
  }
  const classPattern = /register\(new\s+([A-Za-z0-9]+)Provider/g;
  for (const match of source.matchAll(classPattern)) {
    const raw = match[1].replace(/Provider$/, "");
    const id = raw.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
    entries.set(id, raw);
  }
  return [...entries.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
