import { describe, expect, it } from "vitest";
import { loadConfig } from "./env.js";
import { createRuntime } from "../runtime.js";

describe("baseline read-only research", () => {
  it("discovers protected browser reads with mutating tools disabled", async () => {
    const config = loadConfig({ BEYONDER_DB_PATH: ":memory:", BEYONDER_MODEL_PROVIDER: "none", BEYONDER_TOOLS_ENABLED: "false", BEYONDER_BROWSER_ENABLED: "" });
    const runtime = createRuntime(config);
    try {
      const tools = await runtime.getAvailableTools();
      expect(tools.some(tool => tool.id === "browser.read")).toBe(true);
      expect(tools.some(tool => ["browser.click", "browser.fill", "shell", "filesystem.write"].includes(tool.id))).toBe(false);
      expect(config.tools.shell).toBe(false);
      expect(config.tools.filesystem).toBe(false);
    } finally { await runtime.browser.closeAll(); runtime.sqlite.close(); }
  });
  it("honors an explicit browser opt-out", async () => {
    const runtime = createRuntime(loadConfig({ BEYONDER_DB_PATH: ":memory:", BEYONDER_BROWSER_ENABLED: "false" }));
    try { expect((await runtime.getAvailableTools()).some(tool => tool.id.startsWith("browser."))).toBe(false); }
    finally { await runtime.browser.closeAll(); runtime.sqlite.close(); }
  });
});
