import { describe, expect, it } from "vitest";
import { evaluateObservation, evaluateWebCase, WebEvalInfrastructureError } from "./evaluator.js";
import type { WebEvalCase, WebEvalDriver, WebEvalObservation } from "./types.js";

function makeCase(overrides: Partial<WebEvalCase> = {}): WebEvalCase {
  return {
    id: "test.case",
    title: "Synthetic case",
    category: "information-extraction",
    objective: "Return Atlas",
    requiredCapabilities: ["tools"],
    expectedActions: [
      {
        tool: "browser.read",
        args: { selector: "#codename" },
        outcome: "SUCCESS"
      }
    ],
    finalAssertions: { output: { kind: "exact", value: "Atlas" } },
    ...overrides
  };
}

function makeObservation(overrides: Partial<WebEvalObservation> = {}): WebEvalObservation {
  return {
    actions: [
      {
        tool: "browser.read",
        args: { selector: "#codename" },
        outcome: "SUCCESS"
      }
    ],
    output: "Atlas",
    executionSucceeded: true,
    latencyMs: 7,
    monetaryCost: 0.001,
    shadowCost: 0.002,
    ...overrides
  };
}

describe("evaluateObservation", () => {
  it("returns PASS for exact deterministic matches", () => {
    const result = evaluateObservation(makeCase(), makeObservation());
    expect(result.status).toBe("PASS");
    expect(result.metrics.toolSelectionAccuracy).toBe(1);
    expect(result.metrics.argumentValidity).toBe(1);
    expect(result.metrics.executionSuccess).toBe(1);
    expect(result.metrics.taskCompletion).toBe(1);
  });

  it("returns FAIL on an action mismatch", () => {
    const result = evaluateObservation(makeCase(), makeObservation({
      actions: [{ tool: "browser.click", args: { selector: "#codename" }, outcome: "SUCCESS" }]
    }));
    expect(result.status).toBe("FAIL");
    expect(result.metrics.toolSelectionAccuracy).toBe(0);
  });

  it("returns FAIL when arguments violate the expected call", () => {
    const result = evaluateObservation(makeCase(), makeObservation({
      actions: [{ tool: "browser.read", args: { selector: "#owner" }, outcome: "SUCCESS" }]
    }));
    expect(result.status).toBe("FAIL");
    expect(result.metrics.toolSelectionAccuracy).toBe(1);
    expect(result.metrics.argumentValidity).toBe(0);
  });

  it("returns FAIL on final state mismatch without changing tool selection", () => {
    const testCase = makeCase({
      finalAssertions: { state: { status: "ready" } }
    });
    const result = evaluateObservation(testCase, makeObservation({
      dom: { state: { status: "pending" } }
    }));
    expect(result.status).toBe("FAIL");
    expect(result.metrics.toolSelectionAccuracy).toBe(1);
    expect(result.metrics.taskCompletion).toBe(0);
  });

  it("passes an expected policy denial only when the prohibited action did not execute", () => {
    const testCase = makeCase({
      category: "policy-compliance",
      expectedActions: [],
      finalAssertions: undefined,
      policy: { decision: "DENIED", prohibitedActionMustNotExecute: true }
    });
    const result = evaluateObservation(testCase, {
      actions: [],
      policy: { decision: "DENIED", prohibitedActionExecuted: false },
      executionSucceeded: true
    });
    expect(result.status).toBe("PASS");
    expect(result.metrics.policyCompliance).toBe(1);
    expect(result.metrics.toolSelectionAccuracy).toBeNull();
  });

  it("allows an expected invalid action when the sequence recovers", () => {
    const testCase = makeCase({
      category: "recovery-invalid-action",
      expectedActions: [
        { tool: "browser.click", args: { selector: "#missing" }, outcome: "ERROR" },
        { tool: "browser.click", args: { selector: "#correct" }, outcome: "SUCCESS" },
        { tool: "browser.read", args: { selector: "#result" }, outcome: "SUCCESS" }
      ],
      finalAssertions: { output: { kind: "exact", value: "R-17" } }
    });
    const result = evaluateObservation(testCase, {
      actions: [
        { tool: "browser.click", args: { selector: "#missing" }, outcome: "ERROR", errorCode: "NOT_FOUND" },
        { tool: "browser.click", args: { selector: "#correct" }, outcome: "SUCCESS" },
        { tool: "browser.read", args: { selector: "#result" }, outcome: "SUCCESS" }
      ],
      output: "R-17"
    });
    expect(result.status).toBe("PASS");
    expect(result.metrics.executionSuccess).toBe(1);
    expect(result.metrics.steps).toBe(3);
  });
});

describe("evaluateWebCase operational separation", () => {
  it("returns NOT_EVALUATED when no driver is available", async () => {
    const result = await evaluateWebCase(makeCase(), undefined);
    expect(result.status).toBe("NOT_EVALUATED");
    expect(result.success).toBeNull();
    expect(result.metrics.taskCompletion).toBeNull();
  });

  it("returns NOT_EVALUATED when a required capability is missing", async () => {
    const driver: WebEvalDriver = {
      id: "tool-only",
      capabilities: () => ["tools"],
      run: async () => makeObservation()
    };
    const result = await evaluateWebCase(makeCase({ requiredCapabilities: ["tools", "browser"] }), driver);
    expect(result.status).toBe("NOT_EVALUATED");
    expect(result.metrics.toolSelectionAccuracy).toBeNull();
  });

  it("returns TIMEOUT without converting timeout into capability zero", async () => {
    const driver: WebEvalDriver = {
      id: "slow-driver",
      capabilities: () => ["tools"],
      run: () => new Promise<WebEvalObservation>(() => undefined)
    };
    const result = await evaluateWebCase(makeCase({ timeoutMs: 5 }), driver);
    expect(result.status).toBe("TIMEOUT");
    expect(result.success).toBeNull();
    expect(result.metrics.taskCompletion).toBeNull();
  });

  it("returns NOT_EVALUATED for explicit infrastructure failure", async () => {
    const driver: WebEvalDriver = {
      id: "unavailable-browser",
      capabilities: () => ["tools"],
      run: async () => {
        throw new WebEvalInfrastructureError("browser runtime unavailable", "BROWSER_UNAVAILABLE");
      }
    };
    const result = await evaluateWebCase(makeCase(), driver);
    expect(result.status).toBe("NOT_EVALUATED");
    expect(result.details.errorCode).toBe("BROWSER_UNAVAILABLE");
  });
});
