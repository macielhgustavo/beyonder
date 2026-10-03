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

class SafeObjectiveTool implements Tool {
  readonly name = "safe-objective";
  readonly enabled = true;

  async run(input: string): Promise<ToolCallResult> {
    const normalized = input.trim().replace(/\s+/g, " ");
    return {
      ok: true,
      output: JSON.stringify({
        acceptedObjective: normalized,
        action: "recorded_objective_and_created_next_step",
        sideEffects: "none"
      })
    };
  }
}

export function createToolRegistry(config: AppConfig["tools"]) {
  return new Map<string, Tool>([
    ["safe-objective", new SafeObjectiveTool()],
    ["shell", new DisabledTool("shell", config.shell)],
    ["browser", new DisabledTool("browser", config.browser)],
    ["filesystem", new DisabledTool("filesystem", config.filesystem)]
  ]);
}
