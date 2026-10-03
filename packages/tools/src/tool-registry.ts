import type { AppConfig } from "../config/env.js";
import type { ToolCallResult } from "../types.js";

export interface Tool {
  name: string;
  enabled: boolean;
  run(input: string): Promise<ToolCallResult>;
}

class DisabledTool implements Tool {
  constructor(
    public readonly name: string,
    public readonly enabled = false
  ) {}

  async run(): Promise<ToolCallResult> {
    return { ok: false, output: "", error: `${this.name} tool is disabled by sandbox policy.` };
  }
}

export function createToolRegistry(config: AppConfig["tools"]) {
  return new Map<string, Tool>([
    ["shell", new DisabledTool("shell", config.shell)],
    ["browser", new DisabledTool("browser", config.browser)],
    ["filesystem", new DisabledTool("filesystem", config.filesystem)]
  ]);
}
