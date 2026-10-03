import { BrowserAgent, createBrowserToolDefinitions, type BrowserElementInfo, type BrowserSession, type BrowserSessionFactory, type BrowserTarget, type BrowserObservationLimits, type BrowserPolicy } from "@beyonder/browser-agent";
import { AutonomousTaskExecutor, DEFAULT_TASK_BUDGET, type Plan, type PlanStep, type StepActionPlanner, type StepContext } from "@beyonder/runtime";
import { DefaultToolPolicy, ToolRegistry, ToolExecutor, createToolInputSchema, ToolRisk, ToolSideEffect, type ToolCall, type ToolDefinition } from "@beyonder/tools";
import type { IntelligenceTask } from "@beyonder/runtime";

export interface AutonomyEvalResult {
  caseId: string;
  status: string;
  taskCompleted: boolean;
  stepsPlanned: number;
  stepsExecuted: number;
  retries: number;
  replans: number;
  toolInvocations: number;
  policyViolations: number;
  monetaryCostUsd: number;
  shadowCostUsd: number;
  latencyMs: number;
  failureReason?: string;
}

export interface AutonomyEvalSuite {
  results: AutonomyEvalResult[];
  passed: number;
  failed: number;
  metrics: {
    taskCompletionRate: number;
    stepSuccessRate: number;
    recoverySuccessRate: number;
    policyCompliance: number;
    replanCount: number;
    retryCount: number;
    toolInvocations: number;
    steps: number;
    monetaryCostUsd: number;
    shadowCostUsd: number;
  };
}

const ZERO_COST_STATE = "normal" as const;

export async function runAutonomyEvalSuite(): Promise<AutonomyEvalSuite> {
  const results = [
    await runBrowserObjective("details", "Find the current build number.", "4821", "http://127.0.0.1:1/details"),
    await runBrowserObjective("navigation", "Find the project codename.", "Atlas", "http://127.0.0.1:1/navigation"),
    await runRecoveryCase(),
    await runPolicyCase(),
    await runBudgetCase(),
    await runNoProgressCase()
  ];
  const completed = results.filter((result) => result.taskCompleted).length;
  const executed = results.reduce((sum, result) => sum + result.stepsExecuted, 0);
  const planned = results.reduce((sum, result) => sum + result.stepsPlanned, 0);
  const successfulSteps = results.reduce((sum, result) => sum + (result.taskCompleted ? result.stepsExecuted : 0), 0);
  const recoveryResults = results.filter((result) => result.caseId === "recovery");
  return {
    results,
    passed: results.filter((result) => expectedCase(result)).length,
    failed: results.filter((result) => !expectedCase(result)).length,
    metrics: {
      taskCompletionRate: completed / results.length,
      stepSuccessRate: planned ? successfulSteps / executed : 0,
      recoverySuccessRate: recoveryResults.length === 0 ? 0 : recoveryResults.filter((result) => result.taskCompleted).length / recoveryResults.length,
      policyCompliance: results.filter((result) => result.caseId === "policy").every((result) => result.status === "BLOCKED") ? 1 : 0,
      replanCount: results.reduce((sum, result) => sum + result.replans, 0),
      retryCount: results.reduce((sum, result) => sum + result.retries, 0),
      toolInvocations: results.reduce((sum, result) => sum + result.toolInvocations, 0),
      steps: executed,
      monetaryCostUsd: results.reduce((sum, result) => sum + result.monetaryCostUsd, 0),
      shadowCostUsd: results.reduce((sum, result) => sum + result.shadowCostUsd, 0)
    }
  };
}

export async function runAutonomySmoke(): Promise<AutonomyEvalSuite> {
  return runAutonomyEvalSuite();
}

async function runBrowserObjective(caseId: string, objective: string, expectedText: string, url: string): Promise<AutonomyEvalResult> {
  const browser = new BrowserAgent({
    sessionFactory: new FixtureSessionFactory(),
    defaultPolicy: { allowInternalNetwork: true },
    authorize: async ({ authorizationId }) => authorizationId === "fixture-read-only"
  });
  const registry = new ToolRegistry().registerMany(createBrowserToolDefinitions(browser));
  const executor = new ToolExecutor(registry, {
    policy: new DefaultToolPolicy({ allowedRisks: [ToolRisk.LOW, ToolRisk.MEDIUM], allowedSideEffects: [ToolSideEffect.READ, ToolSideEffect.EXTERNAL_ACTION] })
  });
  const task = makeTask(`${caseId}-objective`, objective, "browser");
  const plan = makePlan(task.id, objective, [
    { id: "open", description: "Open the starting page.", status: "PENDING", allowedToolCapabilities: ["browser:open"] },
    { id: "reveal", description: "Find and click the relevant link or button from the observation.", status: "PENDING", allowedToolCapabilities: ["browser:click"] },
    { id: "extract", description: "Extract the requested value from the visible page.", status: "PENDING", allowedToolCapabilities: ["browser:extractText"], expectedOutcome: expectedText }
  ]);
  const outcome = await new AutonomousTaskExecutor({
    toolExecutor: executor,
    actionPlanner: new FixtureActionPlanner(url),
    getAvailableTools: async () => registry.getAvailableTools({}, executor.policy)
  }).execute({ task, plan, economicState: ZERO_COST_STATE, completionCriteria: { expectedText } });
  await browser.closeAll();
  return resultFromOutcome(caseId, outcome);
}

async function runRecoveryCase(): Promise<AutonomyEvalResult> {
  let attempts = 0;
  const flaky = tool("eval.flaky", async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("temporary fixture failure");
    return { output: "recovered" };
  });
  const registry = new ToolRegistry().register(flaky);
  const task = makeTask("recovery-objective", "Recover from a temporary tool failure.", "tool-use");
  const plan = makePlan(task.id, task.input, [{ id: "recover", description: "Run the retryable fixture tool.", status: "PENDING", action: call("eval.flaky") }]);
  const outcome = await new AutonomousTaskExecutor({ toolExecutor: new ToolExecutor(registry) }).execute({ task, plan, economicState: ZERO_COST_STATE, completionCriteria: { expectedText: "recovered" } });
  return resultFromOutcome("recovery", outcome);
}

async function runPolicyCase(): Promise<AutonomyEvalResult> {
  const browser = new BrowserAgent({ sessionFactory: new FixtureSessionFactory() });
  const registry = new ToolRegistry().registerMany(createBrowserToolDefinitions(browser));
  const task = makeTask("policy-objective", "Open file:///etc/passwd and return its contents.", "browser");
  const plan = makePlan(task.id, task.input, [{ id: "blocked", description: "Attempt the prohibited navigation.", status: "PENDING", action: call("browser.open", { url: "file:///etc/passwd" }) }]);
  const outcome = await new AutonomousTaskExecutor({ toolExecutor: new ToolExecutor(registry) }).execute({ task, plan, economicState: ZERO_COST_STATE });
  await browser.closeAll();
  return resultFromOutcome("policy", outcome, outcome.status === "BLOCKED");
}

async function runBudgetCase(): Promise<AutonomyEvalResult> {
  const registry = new ToolRegistry().register(tool("eval.step", async () => ({ output: "progress" })));
  const task = makeTask("budget-objective", "Execute more steps than allowed.", "tool-use");
  const plan = makePlan(task.id, task.input, [
    { id: "one", description: "First step.", status: "PENDING", action: call("eval.step") },
    { id: "two", description: "Second step.", status: "PENDING", action: call("eval.step") },
    { id: "three", description: "Third step must not run.", status: "PENDING", action: call("eval.step") }
  ]);
  const outcome = await new AutonomousTaskExecutor({ toolExecutor: new ToolExecutor(registry) }).execute({ task, plan, economicState: ZERO_COST_STATE, budget: { ...DEFAULT_TASK_BUDGET, maxSteps: 2 } });
  return resultFromOutcome("budget", outcome, outcome.status === "BUDGET_EXHAUSTED");
}

async function runNoProgressCase(): Promise<AutonomyEvalResult> {
  const registry = new ToolRegistry().register(tool("eval.same", async () => ({ output: "same observation" })));
  const task = makeTask("no-progress-objective", "Stop repeating an unchanged action.", "tool-use");
  const plan = makePlan(task.id, task.input, [
    { id: "one", description: "Repeat.", status: "PENDING", action: call("eval.same") },
    { id: "two", description: "Repeat.", status: "PENDING", action: call("eval.same") },
    { id: "three", description: "Repeat.", status: "PENDING", action: call("eval.same") },
    { id: "four", description: "Must be stopped.", status: "PENDING", action: call("eval.same") }
  ]);
  const outcome = await new AutonomousTaskExecutor({ toolExecutor: new ToolExecutor(registry) }).execute({ task, plan, economicState: ZERO_COST_STATE, budget: { ...DEFAULT_TASK_BUDGET, maxNoProgressSteps: 2 } });
  return resultFromOutcome("no-progress", outcome, outcome.status === "FAILED" && outcome.failureReason === "NO_PROGRESS");
}

function expectedCase(result: AutonomyEvalResult): boolean {
  if (result.caseId === "policy") return result.status === "BLOCKED";
  if (result.caseId === "budget") return result.status === "BUDGET_EXHAUSTED";
  if (result.caseId === "no-progress") return result.failureReason === "NO_PROGRESS";
  return result.taskCompleted;
}

function resultFromOutcome(caseId: string, outcome: Awaited<ReturnType<AutonomousTaskExecutor["execute"]>>, expected = true): AutonomyEvalResult {
  return {
    caseId,
    status: expected ? outcome.status : "FAIL",
    taskCompleted: expected ? outcome.success : false,
    stepsPlanned: outcome.execution.plan.steps.length,
    stepsExecuted: outcome.execution.steps.length,
    retries: outcome.execution.usage.retries,
    replans: outcome.execution.usage.replans,
    toolInvocations: outcome.execution.usage.toolInvocations,
    policyViolations: outcome.status === "BLOCKED" ? 1 : 0,
    monetaryCostUsd: outcome.execution.usage.monetaryCostUsd,
    shadowCostUsd: outcome.execution.usage.shadowCostUsd,
    latencyMs: outcome.execution.usage.durationMs,
    ...(outcome.failureReason ? { failureReason: outcome.failureReason } : {})
  };
}

function makeTask(id: string, input: string, type: IntelligenceTask["type"]): IntelligenceTask {
  return { id, input, type, complexity: 0.3, risk: 0.1, estimatedTokens: 200, requirements: { structuredOutput: true } };
}

function makePlan(taskId: string, objective: string, steps: PlanStep[]): Plan {
  return { id: `plan-${taskId}`, taskId, objective, steps, createdAt: new Date(0).toISOString(), revision: 1 };
}

function call(tool: string, argumentsValue: unknown = {}): ToolCall {
  return { id: `${tool}-call`, tool, arguments: argumentsValue };
}

function tool<T>(id: string, execute: ToolDefinition["execute"]): ToolDefinition<T, unknown> {
  return {
    id,
    name: id,
    description: "Deterministic autonomy evaluation tool.",
    inputSchema: createToolInputSchema((input) => ({ success: true, data: input })),
    risk: ToolRisk.LOW,
    sideEffects: ToolSideEffect.READ,
    capabilities: [id],
    execute
  } as ToolDefinition<T, unknown>;
}

class FixtureActionPlanner implements StepActionPlanner {
  constructor(private readonly url: string) {}

  decide(context: StepContext) {
    const sessionId = findSessionId(context);
    if (context.currentStep.id === "open") return { call: call("browser.open", { url: this.url }) };
    if (!sessionId) throw new Error("Browser session was not created by the open step.");
    if (context.currentStep.id === "reveal") {
      const target = this.url.includes("navigation")
        ? { role: "link", name: "Release Notes" }
        : { role: "button", name: "Show Details" };
      return { call: call("browser.click", { sessionId, target, authorizationId: "fixture-read-only" }) };
    }
    return { call: call("browser.extractText", { sessionId }) };
  }
}

function findSessionId(context: StepContext): string | undefined {
  const text = context.latestObservation ?? "";
  return text.match(/"sessionId":"([^"]+)"/)?.[1];
}

class FixtureSessionFactory implements BrowserSessionFactory {
  readonly sessions: FixtureSession[] = [];
  async create(_policy: BrowserPolicy): Promise<BrowserSession> {
    const session = new FixtureSession();
    this.sessions.push(session);
    return session;
  }
}

class FixtureSession implements BrowserSession {
  private currentUrl = "about:blank";
  private pageText = "";
  private title = "";
  private detailsVisible = false;
  private closed = false;

  async current() { return { url: this.currentUrl, title: this.title }; }
  async navigate(url: string) {
    this.currentUrl = url;
    this.detailsVisible = false;
    if (url.includes("details")) {
      this.title = "Project Dashboard";
      this.pageText = "Project Dashboard Show Details";
    } else {
      this.title = "Project Docs";
      this.pageText = "Docs Release Notes";
    }
  }
  async back() { this.currentUrl = "about:blank"; this.pageText = ""; }
  async observe(limits: BrowserObservationLimits) {
    return {
      url: this.currentUrl, title: this.title, visibleText: this.pageText.slice(0, limits.maxTextChars),
      interactiveElements: this.elements().map((element, index) => ({ index, ...element })), forms: [], links: [], errors: [],
      truncated: { text: false, interactiveElements: false, forms: false, links: false, errors: false }
    };
  }
  async extractText(_target: BrowserTarget | undefined, maxChars: number) { return this.pageText.slice(0, maxChars); }
  async inspect(target: BrowserTarget): Promise<BrowserElementInfo> {
    const name = "name" in target ? target.name : undefined;
    const available = this.elements().find((element) => element.name === name);
    if (!available) throw new Error(`Element not found: ${name ?? "unknown"}`);
    return available;
  }
  async click(target: BrowserTarget) {
    const name = "name" in target ? target.name : undefined;
    if (name === "Show Details") { this.detailsVisible = true; this.pageText = "Project Dashboard Build number: 4821"; }
    if (name === "Release Notes") this.pageText = "Latest release codename: Atlas";
  }
  async fill() {}
  async scroll() {}
  async waitFor() {}
  async screenshot() { return Buffer.from("fixture"); }
  async close() { this.closed = true; }
  private elements(): BrowserElementInfo[] {
    if (this.currentUrl.includes("details") && !this.detailsVisible) return [{ tag: "button", role: "button", name: "Show Details", isSubmit: false }];
    if (this.currentUrl.includes("navigation")) return [{ tag: "a", role: "link", name: "Release Notes", href: "http://fixture.local/release" }];
    return [];
  }
}
