export type WebEvalCategory =
  | "tool-selection"
  | "argument-generation"
  | "structured-tool-call"
  | "browser-navigation"
  | "information-extraction"
  | "multi-step-navigation"
  | "form-fill"
  | "result-verification"
  | "recovery-invalid-action"
  | "policy-compliance";

export type WebEvalStatus = "PASS" | "FAIL" | "NOT_EVALUATED" | "TIMEOUT";

export type WebEvalCapability = "tools" | "browser" | "dom" | "policy";

export type WebEvalActionOutcome = "SUCCESS" | "ERROR" | "DENIED";

export interface JsonSchema {
  type?: "object" | "string" | "number" | "boolean" | "array";
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: unknown[];
  pattern?: string;
  minLength?: number;
  additionalProperties?: boolean;
}

export interface ExpectedAction {
  tool: string;
  args?: Record<string, unknown>;
  argsSchema?: JsonSchema;
  argsMatch?: "subset" | "exact";
  outcome?: WebEvalActionOutcome;
  structured?: boolean;
}

export interface ObservedAction {
  tool: string;
  args: unknown;
  outcome: WebEvalActionOutcome;
  structured?: boolean;
  errorCode?: string;
}

export interface FinalAssertions {
  output?: {
    kind: "exact" | "contains";
    value: string;
  };
  domTextContains?: string[];
  fields?: Record<string, string>;
  url?: string;
  state?: Record<string, unknown>;
}

export interface PolicyExpectation {
  decision: "ALLOWED" | "DENIED";
  prohibitedActionMustNotExecute?: boolean;
}

export interface WebEvalCase {
  id: string;
  title: string;
  category: WebEvalCategory;
  objective: string;
  fixture?: string;
  smoke?: boolean;
  requiredCapabilities: WebEvalCapability[];
  expectedActions: ExpectedAction[];
  allowExtraActions?: boolean;
  finalAssertions?: FinalAssertions;
  policy?: PolicyExpectation;
  timeoutMs?: number;
  benchmarkCategory?: "tool-use" | "extraction";
}

export interface PolicyObservation {
  decision: "ALLOWED" | "DENIED";
  prohibitedActionExecuted?: boolean;
  reason?: string;
}

export interface DomObservation {
  text?: string;
  fields?: Record<string, string>;
  url?: string;
  state?: Record<string, unknown>;
}

export interface WebEvalObservation {
  actions: ObservedAction[];
  output?: string;
  dom?: DomObservation;
  policy?: PolicyObservation;
  executionSucceeded?: boolean;
  latencyMs?: number;
  monetaryCost?: number;
  shadowCost?: number;
  tokens?: number;
}

export interface WebEvalMetrics {
  toolSelectionAccuracy: number | null;
  argumentValidity: number | null;
  executionSuccess: number | null;
  taskCompletion: number | null;
  policyCompliance: number | null;
  steps: number;
  latency: number;
  monetaryCost: number;
  shadowCost: number;
}

export interface WebEvalEnvironment {
  driverId: string;
  capabilities: WebEvalCapability[];
  fixtureVersion: string;
  toolsFingerprint?: string;
  policyVersion?: string;
}

export interface WebEvalResult {
  caseId: string;
  category: WebEvalCategory;
  status: WebEvalStatus;
  success: boolean | null;
  metrics: WebEvalMetrics;
  details: Record<string, unknown>;
  environment: WebEvalEnvironment;
  timestamp: Date;
}

export interface WebEvalRunInput {
  testCase: WebEvalCase;
  fixtureUrl?: string;
}

export interface WebEvalDriver {
  readonly id: string;
  capabilities(): WebEvalCapability[] | Promise<WebEvalCapability[]>;
  run(input: WebEvalRunInput): Promise<WebEvalObservation>;
  toolsFingerprint?: string;
  policyVersion?: string;
}

export interface WebEvalSuiteSummary {
  suite: "smoke" | "standard";
  cases: number;
  pass: number;
  fail: number;
  notEvaluated: number;
  timeout: number;
  metrics: {
    toolSelectionAccuracy: number | null;
    argumentValidity: number | null;
    executionSuccess: number | null;
    taskCompletion: number | null;
    policyCompliance: number | null;
    steps: number;
    latency: number;
    monetaryCost: number;
    shadowCost: number;
  };
}

export interface WebEvalSuiteRun {
  results: WebEvalResult[];
  summary: WebEvalSuiteSummary;
}
