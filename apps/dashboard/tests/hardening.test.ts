import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRuntime, loadConfig, ModelRouter, LlmPlanner, normalizeOpportunity } from "@beyonder/runtime";
import { runControlCommand } from "../control/commands";
import { LocalDashboardDataSource, safeExternalUrl } from "../data/local";
import { validateCommand } from "../control/validation";
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "control-hardening-"));
  vi.stubEnv("BEYONDER_DB_PATH", path.join(dir, "runtime.sqlite"));
  vi.stubEnv("BEYONDER_PROVIDER_STATE_PATH", path.join(dir, "providers.json"));
  vi.stubEnv("BEYONDER_MODEL_PROVIDER", "none");
  vi.stubEnv("BEYONDER_CONTROL_FIXTURE", "0");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

describe("real operation honesty", () => {
  it("delegates to LlmPlanner and real executor with mocked model responses", async () => {
    vi.stubEnv("BEYONDER_MODEL_PROVIDER", "ollama");
    const planner = vi.spyOn(LlmPlanner.prototype, "createPlan");
    const completion = vi.spyOn(ModelRouter.prototype, "completeForPlanningCandidate").mockImplementation(async (messages) => {
      const input = JSON.parse(messages[1].content);
      expect(JSON.stringify(input.tools ?? input.availableTools)).not.toContain("safe-objective");
      const content = input.taskId ? JSON.stringify({ id: "real-plan", taskId: input.taskId, objective: input.objective, createdAt: new Date().toISOString(), revision: 1, steps: [{ id: "calculate", description: "Somar os números", status: "PENDING", allowedToolCapabilities: ["calculation"] }] }) : JSON.stringify({ id: "calculation-call", tool: "calculator", arguments: { operation: "add", operands: [2, 3] } });
      return { content, provider: "ollama", model: "mock-model", estimatedCostUsd: 0 };
    });
    const result = await runControlCommand({ type: "submitObjective", objective: "Calculate 2 plus 3" });
    expect(result).toMatchObject({ ok: true, status: "COMPLETED" });
    expect(planner).toHaveBeenCalledOnce(); expect(completion).toHaveBeenCalledTimes(2);
    const source = new LocalDashboardDataSource(process.env.BEYONDER_DB_PATH);
    const tasks = await source.getTasks();
    expect(tasks).toHaveLength(1); expect(tasks[0].result).toBe("5"); expect(tasks[0].fixture).toBe(false);
    const events = await source.getAuditEvents({ limit: 100 });
    expect(events.some((event) => event.event === "plan.created")).toBe(true);
    expect(events.some((event) => event.event === "tool.completed")).toBe(true);
  });
  it("fails visibly without a provider and does not fabricate completion", async () => {
    await expect(runControlCommand({ type: "submitObjective", objective: "Pesquisar dados" })).rejects.toThrow("nenhum modelo compatível");
    const tasks = await new LocalDashboardDataSource(process.env.BEYONDER_DB_PATH).getTasks();
    expect(tasks[0].status).toBe("failed"); expect(tasks[0].result).toContain("nenhum modelo compatível");
  });
  it("does not send an application or submission merely because a human approved", async () => {
    const runtime = createRuntime(loadConfig());
    try {
      const opportunity = normalizeOpportunity({ source: "github", sourceItemId: "manual-1", sourceUrl: "https://github.com/example/repo/issues/1", title: "Manual work", description: "Test work", type: "CODING", requiredCapabilities: ["coding"], metadata: { requiresApplication: true, requiresSubmission: true } });
      await runtime.opportunityStore.upsert(opportunity);
      const run = await runtime.workRunManager.prepareApplication((await runtime.workRunManager.start(opportunity.id)).id);
      await runControlCommand({ type: "approveAction", approvalId: run.application!.approvalId! });
      let current = (await runtime.workRunManager.inspect(run.id))!;
      expect(current.state).toBe("MANUAL_APPLICATION_REQUIRED"); expect(current.realizedRewardUsd).toBe(0);
      expect((await runtime.approvals.inspect(run.application!.approvalId!))?.status).toBe("APPROVED");
      await runControlCommand({ type: "confirmApplication", workRunId: run.id, externalReference: "external-app-1" });
      current = (await runtime.workRunManager.inspect(run.id))!;
      expect(current.state).toBe("APPLICATION_SENT"); expect(current.application?.externalEvidence?.executedBy).toBe("HUMAN");
      expect((await runtime.approvals.inspect(run.application!.approvalId!))?.status).toBe("CONSUMED");
      await expect(runControlCommand({ type: "confirmApplication", workRunId: run.id })).rejects.toThrow();
      await runtime.workRunManager.markWorkAvailable(run.id); await runtime.workRunManager.beginExecution(run.id, "manual-task");
      await runtime.workRunManager.completeExecution(run.id, { taskId: "manual-task", status: "COMPLETED", monetaryCostUsd: 0, shadowCostUsd: 0 });
      await runtime.workRunManager.createDeliverable(run.id, { type: "TEXT", summary: "Verified work", text: "Deliverable" });
      await runtime.workRunManager.verifyDeliverable(run.id, "PASS", "Verification passed");
      current = await runtime.workRunManager.requestSubmissionApproval(run.id);
      const approvalId = current.deliverable!.metadata!.submissionApprovalId as string;
      await runControlCommand({ type: "approveAction", approvalId });
      current = (await runtime.workRunManager.inspect(run.id))!;
      expect(current.state).toBe("MANUAL_SUBMISSION_REQUIRED"); expect((await runtime.approvals.inspect(approvalId))?.status).toBe("APPROVED");
      await expect(runControlCommand({ type: "recordSettlement", workRunId: run.id, amount: 5, currency: "USD", source: "bank", externalReference: "pay-1" })).rejects.toThrow();
      await runControlCommand({ type: "confirmSubmission", workRunId: run.id, externalReference: "submission-1" });
      current = (await runtime.workRunManager.inspect(run.id))!; expect(current.state).toBe("AWAITING_SETTLEMENT"); expect(current.realizedRewardUsd).toBe(0);
      await runControlCommand({ type: "recordSettlement", workRunId: run.id, amount: 5, currency: "USD", source: "bank", externalReference: "pay-1" });
      expect((await runtime.workRunManager.inspect(run.id))?.realizedRewardUsd).toBe(5);
      const views = await new LocalDashboardDataSource(process.env.BEYONDER_DB_PATH).getWorkRuns(); expect(views[0].settlement?.evidence.externalReference).toBe("pay-1");
    } finally { runtime.sqlite.close(); }
  });
  it("blocks every new work command while paused", async () => {
    await runControlCommand({ type: "pauseRuntime" });
    for (const command of [{ type: "submitObjective", objective: "Do work" }, { type: "discoverOpportunities" }, { type: "prepareApplication", opportunityId: "any" }, { type: "approveAction", approvalId: "any" }, { type: "confirmApplication", workRunId: "any" }, { type: "confirmSubmission", workRunId: "any" } ] as const) await expect(runControlCommand(command)).rejects.toThrow("paused");
    await runControlCommand({ type: "resumeRuntime" });
    vi.stubEnv("BEYONDER_CONTROL_FIXTURE", "1");
    expect(await runControlCommand({ type: "submitObjective", objective: "Do deterministic work" })).toMatchObject({ ok: true });
  });
  it("never infers READY from an existing database or a pause flag", async () => {
    const runtime = createRuntime(loadConfig());
    try { await runtime.state.set("control-center:state", { paused: true, lastHeartbeatAt: new Date(Date.now() - 70_000).toISOString() });
      expect((await new LocalDashboardDataSource(process.env.BEYONDER_DB_PATH).getRuntimeStatus()).global).toBe("OFFLINE");
      await runtime.state.set("control-center:state", { paused: false, lastHeartbeatAt: new Date(Date.now() - 18_000).toISOString() });
      expect((await new LocalDashboardDataSource(process.env.BEYONDER_DB_PATH).getRuntimeStatus()).global).toBe("DEGRADED");
    } finally { runtime.sqlite.close(); }
  });
});

describe("fixture isolation", () => {
  it("excludes deterministic objective tools and fixture sources from the real runtime", async () => {
    const real = createRuntime(loadConfig());
    const fixture = createRuntime(loadConfig(), { fixture: true });
    try {
      expect((await real.getAvailableTools()).some((tool) => tool.id === "safe-objective")).toBe(false);
      expect((await real.opportunities.discover({ source: "fixture" })).opportunities).toHaveLength(0);
      expect((await fixture.getAvailableTools()).some((tool) => tool.id === "safe-objective")).toBe(true);
      expect((await fixture.opportunities.discover({ source: "fixture" })).opportunities.length).toBeGreaterThan(0);
    } finally { real.sqlite.close(); fixture.sqlite.close(); }
  });
});

describe("strict command boundaries", () => {
  it("rejects malformed values, surplus fields and arbitrary credential env vars", () => {
    for (const payload of [{ type: "submitObjective", objective: [] }, { type: "submitObjective", objective: "x".repeat(8001) }, { type: "pauseRuntime", path: "/etc/passwd" }, { type: "approveAction" }, { type: "setSecret", providerId: "groq", envVar: "PATH", value: "key", vaultPassword: "password-1234" }, { type: "discoverOpportunities", fixture: true }]) expect(() => validateCommand(payload)).toThrow();
  });
  it("allows only persisted HTTP(S) opportunity URLs", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeUndefined(); expect(safeExternalUrl("file:///etc/passwd")).toBeUndefined(); expect(safeExternalUrl("https://example.com/work")).toBe("https://example.com/work");
  });
});
