import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AutopilotProviderProgress, AutopilotStateFile, ProviderCatalogEntry, ProviderState } from "./types.js";

export class AutopilotStateStore {
  constructor(private readonly filePath = ".providers-vault/autopilot-state.json") {}

  async read(): Promise<AutopilotStateFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as AutopilotStateFile;
    } catch {
      return { version: 1, updatedAt: new Date().toISOString(), providers: {} };
    }
  }

  async write(state: AutopilotStateFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const next = { ...state, updatedAt: new Date().toISOString() };
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    await rename(tmp, this.filePath);
  }

  async update(
    provider: ProviderCatalogEntry,
    state: ProviderState,
    patch: Partial<AutopilotProviderProgress> = {}
  ): Promise<AutopilotProviderProgress> {
    const file = await this.read();
    const existing = file.providers[provider.id];
    const progress: AutopilotProviderProgress = {
      ...existing,
      ...patch,
      providerId: provider.id,
      state,
      classification: provider.classification ?? patch.classification ?? existing?.classification ?? "UNREVIEWED",
      attempts: state === existing?.state ? existing.attempts : (existing?.attempts ?? 0) + 1,
      lastUpdatedAt: new Date().toISOString()
    };
    file.providers[provider.id] = progress;
    await this.write(file);
    return progress;
  }
}
