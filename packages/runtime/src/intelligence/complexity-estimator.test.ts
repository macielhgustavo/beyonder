import { describe, expect, it } from "vitest";
import { ComplexityEstimator } from "./complexity-estimator.js";

describe("ComplexityEstimator", () => {
  const estimator = new ComplexityEstimator();

  it("assigns greater complexity to structured coding work", () => {
    const simple = estimator.estimate("Say hello", "chat");
    const complex = estimator.estimate(
      "Implement a TypeScript service with tests, then refactor the interface and explain the trade-offs.\n1. Preserve compatibility\n2. Add tests\n3. Validate output",
      "coding"
    );
    expect(complex.complexity).toBeGreaterThan(simple.complexity);
    expect(complex.estimatedTokens).toBeGreaterThan(simple.estimatedTokens);
    expect(complex.requirements.reasoning).toBe(true);
  });

  it("raises risk for sensitive tool actions without executing anything", () => {
    const safe = estimator.estimate("Plan a small refactor", "planning");
    const risky = estimator.estimate("Run a shell command with sudo and delete credentials", "tool-use");
    expect(risky.risk).toBeGreaterThan(safe.risk);
    expect(risky.requirements.tools).toEqual(["restricted-tool"]);
  });
});
