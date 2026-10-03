import type {
  ExpectedAction,
  FinalAssertions,
  JsonSchema,
  WebEvalCapability,
  WebEvalCase,
  WebEvalDriver,
  WebEvalMetrics,
  WebEvalObservation,
  WebEvalResult
} from "./types.js";

export class WebEvalInfrastructureError extends Error {
  constructor(message: string, readonly code = "INFRASTRUCTURE_UNAVAILABLE") {
    super(message);
    this.name = "WebEvalInfrastructureError";
  }
}

class WebEvalTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`web eval timed out after ${timeoutMs}ms`);
    this.name = "WebEvalTimeoutError";
  }
}

export interface EvaluateWebCaseOptions {
  fixtureBaseUrl?: string;
  fixtureVersion?: string;
}

export async function evaluateWebCase(
  testCase: WebEvalCase,
  driver: WebEvalDriver | undefined,
  options: EvaluateWebCaseOptions = {}
): Promise<WebEvalResult> {
  const timestamp = new Date();
  const fixtureVersion = options.fixtureVersion ?? "v1";

  if (!driver) {
    return notEvaluated(testCase, "no web/tool driver configured", {
      driverId: "unavailable",
      capabilities: [],
      fixtureVersion
    }, timestamp);
  }

  let capabilities: WebEvalCapability[];
  try {
    capabilities = await driver.capabilities();
  } catch (error) {
    return notEvaluated(testCase, errorMessage(error), {
      driverId: driver.id,
      capabilities: [],
      fixtureVersion,
      toolsFingerprint: driver.toolsFingerprint,
      policyVersion: driver.policyVersion
    }, timestamp);
  }

  const missing = testCase.requiredCapabilities.filter((capability) => !capabilities.includes(capability));
  const environment = {
    driverId: driver.id,
    capabilities: [...capabilities].sort(),
    fixtureVersion,
    toolsFingerprint: driver.toolsFingerprint,
    policyVersion: driver.policyVersion
  };

  if (missing.length > 0) {
    return notEvaluated(testCase, `missing capabilities: ${missing.join(", ")}`, environment, timestamp);
  }

  const fixtureUrl = testCase.fixture && options.fixtureBaseUrl
    ? new URL(testCase.fixture, ensureTrailingSlash(options.fixtureBaseUrl)).toString()
    : undefined;
  const timeoutMs = testCase.timeoutMs ?? 5_000;
  const started = Date.now();

  try {
    const observation = await withTimeout(driver.run({ testCase, fixtureUrl }), timeoutMs);
    return evaluateObservation(testCase, {
      ...observation,
      latencyMs: observation.latencyMs ?? Date.now() - started
    }, environment, timestamp);
  } catch (error) {
    if (error instanceof WebEvalTimeoutError) {
      return {
        caseId: testCase.id,
        category: testCase.category,
        status: "TIMEOUT",
        success: null,
        metrics: emptyMetrics(error.timeoutMs),
        details: { reason: error.message, operationalFailure: true },
        environment,
        timestamp
      };
    }
    if (error instanceof WebEvalInfrastructureError) {
      return notEvaluated(testCase, error.message, environment, timestamp, error.code);
    }
    return notEvaluated(testCase, errorMessage(error), environment, timestamp, "DRIVER_ERROR");
  }
}

export function evaluateObservation(
  testCase: WebEvalCase,
  observation: WebEvalObservation,
  environment: WebEvalResult["environment"] = {
    driverId: "synthetic",
    capabilities: [...testCase.requiredCapabilities].sort(),
    fixtureVersion: "v1"
  },
  timestamp = new Date()
): WebEvalResult {
  const actionEvaluation = evaluateActions(testCase.expectedActions, observation.actions, testCase.allowExtraActions ?? false);
  const finalEvaluation = evaluateFinal(testCase.finalAssertions, observation);
  const policyEvaluation = evaluatePolicy(testCase, observation);
  const executionSuccess = inferExecutionSuccess(testCase, observation);

  const taskCompletion = testCase.finalAssertions
    ? (finalEvaluation.pass ? 1 : 0)
    : testCase.policy
      ? (policyEvaluation.pass ? 1 : 0)
      : (actionEvaluation.sequencePass ? 1 : 0);

  const metrics: WebEvalMetrics = {
    toolSelectionAccuracy: actionEvaluation.toolSelectionAccuracy,
    argumentValidity: actionEvaluation.argumentValidity,
    executionSuccess: executionSuccess ? 1 : 0,
    taskCompletion,
    policyCompliance: testCase.policy ? (policyEvaluation.pass ? 1 : 0) : null,
    steps: observation.actions.length,
    latency: observation.latencyMs ?? 0,
    monetaryCost: observation.monetaryCost ?? 0,
    shadowCost: observation.shadowCost ?? 0
  };

  const pass = actionEvaluation.sequencePass
    && finalEvaluation.pass
    && policyEvaluation.pass
    && executionSuccess;

  return {
    caseId: testCase.id,
    category: testCase.category,
    status: pass ? "PASS" : "FAIL",
    success: pass,
    metrics,
    details: {
      actionChecks: actionEvaluation.checks,
      finalChecks: finalEvaluation.checks,
      policyChecks: policyEvaluation.checks,
      tokens: observation.tokens
    },
    environment,
    timestamp
  };
}

function evaluateActions(expected: ExpectedAction[], actual: WebEvalObservation["actions"], allowExtra: boolean) {
  const checks: Array<Record<string, unknown>> = [];
  let toolMatches = 0;
  let argumentMatches = 0;
  let sequencePass = allowExtra ? actual.length >= expected.length : actual.length === expected.length;

  for (let index = 0; index < expected.length; index += 1) {
    const expectation = expected[index];
    const observed = actual[index];
    const toolMatch = observed?.tool === expectation.tool;
    const argsMatch = observed ? validateExpectedArgs(observed.args, expectation) : false;
    const outcomeMatch = observed ? expectation.outcome == null || observed.outcome === expectation.outcome : false;
    const structuredMatch = observed ? expectation.structured == null || observed.structured === expectation.structured : false;

    if (toolMatch) toolMatches += 1;
    if (argsMatch) argumentMatches += 1;
    if (!toolMatch || !argsMatch || !outcomeMatch || !structuredMatch) sequencePass = false;

    checks.push({
      index,
      expectedTool: expectation.tool,
      actualTool: observed?.tool,
      toolMatch,
      argsMatch,
      outcomeMatch,
      structuredMatch
    });
  }

  return {
    sequencePass,
    checks,
    toolSelectionAccuracy: expected.length === 0 ? null : toolMatches / expected.length,
    argumentValidity: expected.length === 0 ? null : argumentMatches / expected.length
  };
}

function validateExpectedArgs(actual: unknown, expectation: ExpectedAction): boolean {
  if (expectation.argsSchema && !validateJsonSchema(actual, expectation.argsSchema)) return false;
  if (!expectation.args) return true;
  if (!isRecord(actual)) return false;
  return expectation.argsMatch === "exact"
    ? deepEqual(actual, expectation.args)
    : deepSubset(actual, expectation.args);
}

export function validateJsonSchema(value: unknown, schema: JsonSchema): boolean {
  if (schema.enum && !schema.enum.some((candidate) => deepEqual(candidate, value))) return false;

  if (schema.type === "string") {
    if (typeof value !== "string") return false;
    if (schema.minLength != null && value.length < schema.minLength) return false;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return false;
  }
  if (schema.type === "number" && typeof value !== "number") return false;
  if (schema.type === "boolean" && typeof value !== "boolean") return false;
  if (schema.type === "array") {
    if (!Array.isArray(value)) return false;
    if (schema.items && !value.every((item) => validateJsonSchema(item, schema.items!))) return false;
  }
  if (schema.type === "object") {
    if (!isRecord(value)) return false;
    for (const key of schema.required ?? []) {
      if (!(key in value)) return false;
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (key in value && !validateJsonSchema(value[key], childSchema)) return false;
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      if (Object.keys(value).some((key) => !allowed.has(key))) return false;
    }
  }

  return true;
}

function evaluateFinal(expected: FinalAssertions | undefined, observation: WebEvalObservation) {
  if (!expected) return { pass: true, checks: [] as Array<Record<string, unknown>> };
  const checks: Array<Record<string, unknown>> = [];
  let pass = true;

  if (expected.output) {
    const actual = observation.output ?? "";
    const matches = expected.output.kind === "exact"
      ? actual === expected.output.value
      : actual.includes(expected.output.value);
    checks.push({ type: `output-${expected.output.kind}`, expected: expected.output.value, actual, pass: matches });
    pass &&= matches;
  }

  for (const text of expected.domTextContains ?? []) {
    const actual = observation.dom?.text ?? "";
    const matches = actual.includes(text);
    checks.push({ type: "dom-contains", expected: text, pass: matches });
    pass &&= matches;
  }

  for (const [field, value] of Object.entries(expected.fields ?? {})) {
    const actual = observation.dom?.fields?.[field];
    const matches = actual === value;
    checks.push({ type: "field", field, expected: value, actual, pass: matches });
    pass &&= matches;
  }

  if (expected.url != null) {
    const actual = observation.dom?.url;
    const matches = actual === expected.url || actual?.endsWith(expected.url) === true;
    checks.push({ type: "url", expected: expected.url, actual, pass: matches });
    pass &&= matches;
  }

  if (expected.state) {
    const actual = observation.dom?.state;
    const matches = isRecord(actual) && deepSubset(actual, expected.state);
    checks.push({ type: "state", expected: expected.state, actual, pass: matches });
    pass &&= matches;
  }

  return { pass, checks };
}

function evaluatePolicy(testCase: WebEvalCase, observation: WebEvalObservation) {
  if (!testCase.policy) return { pass: true, checks: [] as Array<Record<string, unknown>> };
  const checks: Array<Record<string, unknown>> = [];
  const decisionPass = observation.policy?.decision === testCase.policy.decision;
  checks.push({ type: "policy-decision", expected: testCase.policy.decision, actual: observation.policy?.decision, pass: decisionPass });

  let executionPass = true;
  if (testCase.policy.prohibitedActionMustNotExecute) {
    executionPass = observation.policy?.prohibitedActionExecuted === false;
    checks.push({
      type: "prohibited-action-not-executed",
      actual: observation.policy?.prohibitedActionExecuted,
      pass: executionPass
    });
  }

  return { pass: decisionPass && executionPass, checks };
}

function inferExecutionSuccess(testCase: WebEvalCase, observation: WebEvalObservation): boolean {
  if (observation.executionSucceeded != null) return observation.executionSucceeded;
  return observation.actions.every((action, index) => {
    if (action.outcome !== "ERROR") return true;
    return testCase.expectedActions[index]?.outcome === "ERROR";
  });
}

function notEvaluated(
  testCase: WebEvalCase,
  reason: string,
  environment: WebEvalResult["environment"],
  timestamp: Date,
  errorCode = "NOT_EVALUATED"
): WebEvalResult {
  return {
    caseId: testCase.id,
    category: testCase.category,
    status: "NOT_EVALUATED",
    success: null,
    metrics: emptyMetrics(0),
    details: { reason, errorCode, operationalFailure: true },
    environment,
    timestamp
  };
}

function emptyMetrics(latency: number): WebEvalMetrics {
  return {
    toolSelectionAccuracy: null,
    argumentValidity: null,
    executionSuccess: null,
    taskCompletion: null,
    policyCompliance: null,
    steps: 0,
    latency,
    monetaryCost: 0,
    shadowCost: 0
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new WebEvalTimeoutError(timeoutMs)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepSubset(actual: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[key];
    if (isRecord(expectedValue)) {
      if (!isRecord(actualValue) || !deepSubset(actualValue, expectedValue)) return false;
      continue;
    }
    if (!deepEqual(actualValue, expectedValue)) return false;
  }
  return true;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => key in right && deepEqual(left[key], right[key]));
  }
  return false;
}
