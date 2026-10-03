import { describe, expect, it } from "vitest";
import { projectWebEvalToBenchmark } from "./benchmark-adapter.js";
import type { WebEvalResult } from "./types.js";

function result(overrides: Partial<WebEvalResult> = {}): WebEvalResult {
  return {
    caseId: "case-1",
    category: "tool-selection",
    status: "PASS",
    success: true,
    metrics: {
      toolSelectionAccuracy: 1,
      argumentValidity: 0.5,
      executionSuccess: 1,
      taskCompletion: 0,
      policyCompliance: null,
      steps: 2,
      latency: 15,
      monetaryCost: 0.01,
      shadowCost: 0.02
    },
    details: {},
    environment: {
      driverId: "same-tools",
      capabilities: ["tools", "browser"],
      fixtureVersion: "v1"
    },
    timestamp: new Date("2026-10-03T00:00:00.000Z"),
    ...overrides
  };
}

describe("projectWebEvalToBenchmark", () => {
  it("projects only the explicitly selected metric", () => {
    const projected = projectWebEvalToBenchmark(result(), { provider: "p", model: "m" }, "argumentValidity");
    expect(projected.quality).toBe(0.5);
    expect(projected.status).toBe("FAIL");
    expect(projected.sourceMetric).toBe("argumentValidity");
  });

  it("never converts NOT_EVALUATED into capability zero", () => {
    const projected = projectWebEvalToBenchmark(result({
      status: "NOT_EVALUATED",
      success: null,
      metrics: {
        toolSelectionAccuracy: null,
        argumentValidity: null,
        executionSuccess: null,
        taskCompletion: null,
        policyCompliance: null,
        steps: 0,
        latency: 0,
        monetaryCost: 0,
        shadowCost: 0
      },
      details: { reason: "browser unavailable" }
    }), { provider: "p", model: "m" }, "taskCompletion");
    expect(projected.status).toBe("UNAVAILABLE");
    expect(projected.quality).toBeNull();
    expect(projected.success).toBeNull();
  });

  it("keeps timeout operational rather than scoring it as capability failure", () => {
    const projected = projectWebEvalToBenchmark(result({
      status: "TIMEOUT",
      success: null,
      metrics: {
        toolSelectionAccuracy: null,
        argumentValidity: null,
        executionSuccess: null,
        taskCompletion: null,
        policyCompliance: null,
        steps: 0,
        latency: 100,
        monetaryCost: 0,
        shadowCost: 0
      }
    }), { provider: "p", model: "m" }, "taskCompletion");
    expect(projected.status).toBe("TIMEOUT");
    expect(projected.quality).toBeNull();
  });
});
