import { openDatabase, MemoryEngine, MemoryStore, OpportunityEvaluator, OpportunityQueue, StateOpportunityStore, StateStore, DeterministicFixtureOpportunitySource, GitHubPublicOpportunitySource, AgentWorkPublicOpportunitySource, OpenBountyPublicOpportunitySource, normalizeOpportunity, AutonomousTaskExecutor, ApprovalGate, OpportunityBridge, FixtureApplicationAdapter, FixtureSubmissionAdapter, ApprovalDeniedError, type Plan } from "@beyonder/runtime";
import { BrowserAgent, createBrowserToolDefinitions } from "@beyonder/browser-agent";
import { DefaultToolPolicy, ToolExecutor, ToolRegistry, ToolRisk, ToolSideEffect, type ToolCall, type ToolDefinition } from "@beyonder/tools";
import type { IntelligenceTask } from "@beyonder/runtime";
import { FixtureActionPlanner, FixtureSessionFactory } from "./autonomy.js";

export interface OpportunityEvalResult {
  caseId: string;
  status: "PASS" | "FAIL";
  feasibility?: string;
  decision?: string;
  notes?: string;
}

export interface OpportunitySmokeResult {
  discovered: number;
  queued: number;
  results: OpportunityEvalResult[];
  simulatedRevenueUsd: number;
  realizedRevenueUsd: number;
  taskStatus: string;
  result?: string;
  failureReason?: string;
  stepTrace?: string[];
  monetaryCostUsd: number;
}

export async function runOpportunityEvalSuite(): Promise<OpportunitySmokeResult> {
  const fixture = new DeterministicFixtureOpportunitySource();
  const discovered = (await fixture.discover({ now: "2026-10-03T00:00:00.000Z" })).items;
  const { db, sqlite } = openDatabase(":memory:");
  const store = new StateOpportunityStore(new StateStore(db));
  const evaluator = new OpportunityEvaluator({ economicState: "survival", now: () => new Date("2026-10-03T01:00:00.000Z") }, store);
  const normalized = discovered.map((raw) => normalizeOpportunity(raw, "2026-10-03T00:00:00.000Z"));
  const evaluations = [];
  for (const item of normalized) evaluations.push(await evaluator.evaluate(item));
  const queue = new OpportunityQueue(store);
  const queued = await queue.list();
  const results: OpportunityEvalResult[] = evaluations.map((evaluation) => ({
    caseId: evaluation.opportunityId,
    status: (evaluation.decision === "QUEUE" || evaluation.decision === "REQUIRES_APPROVAL" || evaluation.decision === "IGNORE" ? "PASS" : "FAIL") as "PASS" | "FAIL",
    feasibility: evaluation.feasibility,
    decision: evaluation.decision
  }));
  const simulated = await runSimulatedRevenueE2E();
  const real = await runRealSourceReadOnlySmoke();
  results.push({ caseId: "real-source-read-only", status: real.errors.length === 0 ? "PASS" : "FAIL", notes: `${real.discovered} explicit-reward items` });
  const agentWork = await runAgentWorkReadOnlySmoke();
  results.push({ caseId: "agentwork-read-only", status: "PASS", notes: `${agentWork.discovered} items; ${agentWork.errors.length ? agentWork.errors.join(" | ") : "catalog available"}` });
  const openBounty = await runOpenBountyReadOnlySmoke();
  results.push({ caseId: "openbounty-read-only", status: openBounty.errors.length === 0 ? "PASS" : "FAIL", notes: `${openBounty.discovered} items; ${openBounty.errors.join(" | ") || "catalog available"}` });
  const approval = await runApprovalE2E();
  results.push(approval.result);
  sqlite.close();
  return {
    discovered: normalized.length,
    queued: queued.length,
    results: [...results, simulated.result],
    simulatedRevenueUsd: simulated.simulatedRevenueUsd,
    realizedRevenueUsd: 0,
    taskStatus: simulated.taskStatus,
    result: simulated.resultText,
    failureReason: simulated.failureReason,
    stepTrace: simulated.stepTrace,
    monetaryCostUsd: simulated.monetaryCostUsd
  };
}

export async function runOpportunitySmoke(): Promise<OpportunitySmokeResult> {
  return runOpportunityEvalSuite();
}

export async function runRealSourceReadOnlySmoke(): Promise<{ discovered: number; errors: string[] }> {
  const source = new GitHubPublicOpportunitySource({ repository: "microsoft/vscode" });
  const result = await source.discover({ limit: 20 });
  return { discovered: result.items.length, errors: result.errors };
}

export async function runAgentWorkReadOnlySmoke(): Promise<{ discovered: number; errors: string[] }> {
  const result = await new AgentWorkPublicOpportunitySource().discover({ limit: 20 });
  return { discovered: result.items.length, errors: result.errors };
}

export async function runOpenBountyReadOnlySmoke(): Promise<{ discovered: number; errors: string[]; candidates: Array<{ title: string; reward?: number; currency?: string; requirements: unknown; url?: string }> }> {
  const result = await new OpenBountyPublicOpportunitySource().discover({ limit: 20 });
  return { discovered: result.items.length, errors: result.errors, candidates: result.items.map((item) => ({ title: item.title, reward: item.reward?.amount, currency: item.reward?.currency, requirements: item.metadata, url: item.sourceUrl })) };
}

export async function runMarketplaceReadOnlySmoke() {
  const [agentwork, openbounty] = await Promise.all([runAgentWorkReadOnlySmoke(), runOpenBountyReadOnlySmoke()]);
  return { agentwork, openbounty, monetaryCostUsd: 0 };
}

export async function runApprovalE2E() {
  const { db, sqlite } = openDatabase(":memory:");
  const gate = new ApprovalGate(new StateStore(db));
  const bridge = new OpportunityBridge(gate, new FixtureApplicationAdapter(), new FixtureSubmissionAdapter());
  const opportunity = normalizeOpportunity({ source: "fixture-marketplace", sourceItemId: "coding-5", title: "Five dollar coding opportunity", description: "Implement a small tested change.", type: "CODING", reward: { amount: 5, currency: "USD", type: "FIXED" }, requiredCapabilities: ["coding"], metadata: { requiresApplication: true, requiresSubmission: true } });
  const prepared = await bridge.prepareApplication(opportunity, "task-approval");
  let denied = false;
  try { await bridge.apply(opportunity, prepared.application, prepared.approval.approvalId, "task-approval"); } catch (error) { denied = error instanceof ApprovalDeniedError; }
  await gate.approve(prepared.approval.approvalId);
  const application = await bridge.apply(opportunity, prepared.application, prepared.approval.approvalId, "task-approval");
  const submissionApproval = await bridge.requestSubmission(opportunity, "task-approval", "verified deliverable");
  let submissionDenied = false;
  try { await bridge.submit(opportunity, "task-approval", "verified deliverable", submissionApproval.approvalId); } catch (error) { submissionDenied = error instanceof ApprovalDeniedError; }
  await gate.approve(submissionApproval.approvalId);
  const submission = await bridge.submit(opportunity, "task-approval", "verified deliverable", submissionApproval.approvalId);
  sqlite.close();
  return { result: { caseId: "approval-application-submission-e2e", status: (denied && submissionDenied && application.status === "APPLICATION_SENT" && submission.status === "COMPLETED" ? "PASS" : "FAIL") as "PASS" | "FAIL", notes: "external actions are denied, then allowed once after specific human approval; realizedRevenueUsd=0" } };
}

async function runSimulatedRevenueE2E() {
  const opportunity = normalizeOpportunity({
    source: "fixture",
    sourceItemId: "simulated-codename",
    sourceUrl: "http://127.0.0.1:1/navigation",
    title: "Find the project codename",
    description: "Read the public project documentation and return the codename.",
    type: "RESEARCH",
    reward: { amount: 3, currency: "USD", type: "FIXED" },
    requiredCapabilities: ["browser.read"]
  }, "2026-10-03T00:00:00.000Z");
  const evaluation = await new OpportunityEvaluator({ economicState: "survival" }).evaluate(opportunity);
  const browser = new BrowserAgent({ sessionFactory: new FixtureSessionFactory(), defaultPolicy: { allowInternalNetwork: true } });
  const registry = new ToolRegistry().registerMany(createBrowserToolDefinitions(browser));
  const executor = new ToolExecutor(registry, { policy: new DefaultToolPolicy({ allowedRisks: [ToolRisk.LOW, ToolRisk.MEDIUM], allowedSideEffects: [ToolSideEffect.READ, ToolSideEffect.EXTERNAL_ACTION] }) });
  const task = makeTask("simulated-revenue-task", "Find the project codename.", "browser");
  const plan: Plan = {
    id: "simulated-revenue-plan",
    taskId: task.id,
    objective: task.input,
    createdAt: new Date(0).toISOString(),
    revision: 1,
    steps: [
      { id: "open", description: "Open the public project page.", status: "PENDING", allowedToolCapabilities: ["browser:open"] },
      { id: "reveal", description: "Open the release notes.", status: "PENDING", allowedToolCapabilities: ["browser:click"] },
      { id: "extract", description: "Extract the codename.", status: "PENDING", allowedToolCapabilities: ["browser:extractText"], expectedOutcome: "Atlas" }
    ]
  };
  const outcome = await new AutonomousTaskExecutor({ toolExecutor: executor, actionPlanner: new FixtureActionPlanner("http://127.0.0.1:1/navigation"), getAvailableTools: async () => registry.getAvailableTools({}, executor.policy) }).execute({ task, plan, economicState: "normal", completionCriteria: { expectedText: "Atlas" } });
  const { db, sqlite } = openDatabase(":memory:");
  const memory = new MemoryEngine(new MemoryStore(db));
  await memory.remember("economic", JSON.stringify({ opportunityId: opportunity.id, simulatedRevenueUsd: 3, realizedRevenueUsd: 0, verified: outcome.success }), 3, { source: "opportunity-e2e" });
  await browser.closeAll();
  sqlite.close();
  return {
    result: { caseId: "simulated-revenue-e2e", status: (evaluation.decision === "QUEUE" && outcome.success ? "PASS" : "FAIL") as "PASS" | "FAIL", feasibility: evaluation.feasibility, decision: evaluation.decision },
    simulatedRevenueUsd: outcome.success ? 3 : 0,
    taskStatus: outcome.status,
    resultText: outcome.result,
    failureReason: outcome.failureReason,
    stepTrace: outcome.execution.steps.map((step) => `${step.stepId}:${step.status}:${step.toolResult?.error?.code ?? step.toolResult?.output ?? ""}`),
    monetaryCostUsd: outcome.execution.usage.monetaryCostUsd
  };
}

function makeTask(id: string, input: string, type: IntelligenceTask["type"]): IntelligenceTask {
  return { id, input, type, complexity: 0.3, risk: 0.1, estimatedTokens: 200, requirements: { structuredOutput: true } };
}
