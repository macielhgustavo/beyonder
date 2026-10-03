import { describe, expect, it, vi } from "vitest";
import {
  DefaultToolPolicy,
  SAFE_BUILTIN_TOOLS,
  ToolExecutor,
  ToolRegistry,
  ToolRisk,
  ToolSideEffect,
  createToolInputSchema,
  redactSecrets,
  type ToolAuditEventName,
  type ToolAuditSink,
  type ToolDefinition
} from "./index.js";

const passthroughSchema = createToolInputSchema((input) => ({ success: true as const, data: input }));

function definition(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: "safe.read",
    name: "Safe read",
    description: "Safe deterministic read tool",
    inputSchema: passthroughSchema,
    risk: ToolRisk.LOW,
    sideEffects: ToolSideEffect.READ,
    capabilities: ["read"],
    execute: async (input) => ({ output: input }),
    ...overrides
  };
}

class MemoryAudit implements ToolAuditSink {
  events: Array<{ event: ToolAuditEventName; details: Record<string, unknown> }> = [];

  record(event: ToolAuditEventName, details: Record<string, unknown>) {
    this.events.push({ event, details });
  }
}

describe("ToolRegistry", () => {
  it("registers, discovers and exposes capabilities", async () => {
    const registry = new ToolRegistry()
      .register(definition())
      .register(definition({ id: "offline", availability: false, capabilities: ["offline"] }));

    expect(registry.get("safe.read")?.name).toBe("Safe read");
    expect(registry.capabilities()).toEqual(["offline", "read"]);

    const available = await registry.getAvailableTools({}, new DefaultToolPolicy());
    expect(available.map((tool) => tool.id)).toEqual(["safe.read"]);
  });

  it("rejects duplicate registrations", () => {
    const registry = new ToolRegistry().register(definition());
    expect(() => registry.register(definition())).toThrow(/already registered/);
  });

  it("filters discovery through policy and economic state", async () => {
    const registry = new ToolRegistry()
      .register(definition())
      .register(definition({ id: "dangerous", risk: ToolRisk.HIGH, sideEffects: ToolSideEffect.SYSTEM }));
    const policy = new DefaultToolPolicy();

    expect((await registry.getAvailableTools({}, policy)).map((tool) => tool.id)).toEqual(["safe.read"]);
    expect(await registry.getAvailableTools({ economicState: "halted" }, policy)).toEqual([]);
  });
});

describe("ToolExecutor", () => {
  it("validates and executes a built-in deterministic tool", async () => {
    const registry = new ToolRegistry().registerMany(SAFE_BUILTIN_TOOLS);
    const result = await new ToolExecutor(registry).execute<{ value: number }>({
      id: "call-1",
      tool: "calculator",
      arguments: { operation: "multiply", operands: [3, 4, 2] }
    });

    expect(result).toMatchObject({ success: true, output: { value: 24 }, sideEffects: [ToolSideEffect.NONE] });
  });

  it("returns INVALID_ARGUMENTS before execution", async () => {
    const execute = vi.fn(async () => ({ output: "should-not-run" }));
    const registry = new ToolRegistry().register(definition({
      inputSchema: createToolInputSchema(() => ({ success: false as const, error: { issues: [{ path: ["value"], message: "required" }] } })),
      execute
    }));

    const result = await new ToolExecutor(registry).execute({ id: "call-2", tool: "safe.read", arguments: {} });
    expect(result.error?.code).toBe("INVALID_ARGUMENTS");
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns TOOL_NOT_FOUND for unknown tools", async () => {
    const result = await new ToolExecutor(new ToolRegistry()).execute({ id: "call-3", tool: "missing", arguments: {} });
    expect(result.error?.code).toBe("TOOL_NOT_FOUND");
  });

  it("returns UNAVAILABLE without executing", async () => {
    const execute = vi.fn(async () => ({ output: null }));
    const registry = new ToolRegistry().register(definition({ availability: false, execute }));
    const result = await new ToolExecutor(registry).execute({ id: "call-4", tool: "safe.read", arguments: {} });

    expect(result.error?.code).toBe("UNAVAILABLE");
    expect(execute).not.toHaveBeenCalled();
  });

  it("denies unsafe risk and side effects by default", async () => {
    const execute = vi.fn(async () => ({ output: null }));
    const registry = new ToolRegistry().register(definition({ risk: ToolRisk.MEDIUM, sideEffects: ToolSideEffect.WRITE, execute }));
    const result = await new ToolExecutor(registry).execute({ id: "call-5", tool: "safe.read", arguments: {} });

    expect(result.error?.code).toBe("POLICY_DENIED");
    expect(execute).not.toHaveBeenCalled();
  });

  it("enforces halted and budget policy without duplicating economic thresholds", async () => {
    const registry = new ToolRegistry().register(definition());
    const executor = new ToolExecutor(registry);

    expect((await executor.execute({ id: "call-6", tool: "safe.read", arguments: {} }, { economicState: "halted" })).error?.code).toBe("POLICY_DENIED");
    expect((await executor.execute({ id: "call-7", tool: "safe.read", arguments: {} }, {
      budget: { maxInvocations: 1 },
      budgetUsage: { invocationCount: 1 }
    })).error?.code).toBe("POLICY_DENIED");
  });

  it("times out once and never retries internally", async () => {
    const execute = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return { output: "late" };
    });
    const registry = new ToolRegistry().register(definition({ timeoutMs: 10, execute }));
    const result = await new ToolExecutor(registry).execute({ id: "call-8", tool: "safe.read", arguments: {} });

    expect(result.error?.code).toBe("TIMEOUT");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("normalizes execution errors without stack traces or secrets", async () => {
    const registry = new ToolRegistry().register(definition({
      execute: async () => {
        throw new Error("request failed token=super-secret");
      }
    }));
    const result = await new ToolExecutor(registry).execute({ id: "call-9", tool: "safe.read", arguments: {} });

    expect(result.error).toMatchObject({ code: "EXECUTION_ERROR" });
    expect(result.error?.message).toContain("[REDACTED]");
    expect(result.error?.message).not.toContain("super-secret");
    expect(result.error).not.toHaveProperty("stack");
  });

  it("emits the full success audit lifecycle with redacted arguments", async () => {
    const audit = new MemoryAudit();
    const registry = new ToolRegistry().register(definition());
    await new ToolExecutor(registry, { audit }).execute({
      id: "call-10",
      tool: "safe.read",
      arguments: { apiKey: "secret-value", value: 42 }
    }, { taskId: "task-1" });

    expect(audit.events.map(({ event }) => event)).toEqual([
      "tool.requested",
      "tool.validated",
      "tool.authorized",
      "tool.started",
      "tool.completed"
    ]);
    expect(audit.events[0]?.details).toMatchObject({
      tool: "safe.read",
      task: "task-1",
      risk: ToolRisk.LOW,
      sideEffects: [ToolSideEffect.READ],
      arguments: { apiKey: "[REDACTED]", value: 42 }
    });
  });

  it("emits tool.denied instead of starting a denied tool", async () => {
    const audit = new MemoryAudit();
    const registry = new ToolRegistry().register(definition({ risk: ToolRisk.CRITICAL, sideEffects: ToolSideEffect.SYSTEM }));
    await new ToolExecutor(registry, { audit }).execute({ id: "call-11", tool: "safe.read", arguments: {} });

    expect(audit.events.map(({ event }) => event)).toEqual(["tool.requested", "tool.validated", "tool.denied"]);
  });
});

describe("redactSecrets", () => {
  it("redacts nested secret fields and bearer tokens", () => {
    expect(redactSecrets({
      token: "abc",
      nested: { password: "def", note: "Authorization: Bearer live-token" }
    })).toEqual({
      token: "[REDACTED]",
      nested: { password: "[REDACTED]", note: "Authorization: Bearer [REDACTED]" }
    });
  });
});
