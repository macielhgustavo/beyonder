import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPUTE_ECONOMY_CONFIG,
  resolveComputeEconomy
} from "../compute-economy-config.js";

describe("Compute Economy — Configuration & Resolution", () => {
  it("defaults to safe zero-cost mode", () => {
    const resolved = resolveComputeEconomy();
    expect(resolved.mode).toBe("zero_cost");
    expect(resolved.monthlyHardCapMicros).toBe(0);
    expect(resolved.dailyHardCapMicros).toBe(0);
    expect(resolved.defaultObjectiveHardCapMicros).toBe(250_000); // $0.25 in micros
    expect(resolved.defaultObjectiveSoftTargetMicros).toBe(30_000); // $0.03 in micros
  });

  it("forces zero_cost mode if monthly cap is 0 even if bounded requested", () => {
    const resolved = resolveComputeEconomy({
      mode: "bounded",
      monthlyHardCapUsd: 0
    });
    expect(resolved.mode).toBe("zero_cost");
  });

  it("resolves bounded mode with explicit caps", () => {
    const resolved = resolveComputeEconomy({
      mode: "bounded",
      monthlyHardCapUsd: 10,
      dailyHardCapUsd: 1,
      defaultObjectiveHardCapUsd: 0.25,
      defaultObjectiveSoftTargetUsd: 0.03,
      maxSingleInferenceUsd: 0.10
    });
    expect(resolved.mode).toBe("bounded");
    expect(resolved.monthlyHardCapMicros).toBe(10_000_000);
    expect(resolved.dailyHardCapMicros).toBe(1_000_000);
    expect(resolved.defaultObjectiveHardCapMicros).toBe(250_000);
    expect(resolved.maxSingleInferenceMicros).toBe(100_000);
  });

  it("derives daily cap from monthly / 30 if daily is 0", () => {
    const resolved = resolveComputeEconomy({
      mode: "bounded",
      monthlyHardCapUsd: 30,
      dailyHardCapUsd: 0
    });
    expect(resolved.dailyHardCapMicros).toBe(1_000_000); // $1.00
  });

  it("caps daily at monthly if daily exceeds monthly", () => {
    const resolved = resolveComputeEconomy({
      mode: "bounded",
      monthlyHardCapUsd: 5,
      dailyHardCapUsd: 10
    });
    expect(resolved.dailyHardCapMicros).toBe(5_000_000);
  });

  it("caps single inference at default objective hard cap", () => {
    const resolved = resolveComputeEconomy({
      mode: "bounded",
      monthlyHardCapUsd: 10,
      defaultObjectiveHardCapUsd: 0.20,
      maxSingleInferenceUsd: 0.50
    });
    expect(resolved.maxSingleInferenceMicros).toBe(200_000); // clamped to 0.20
  });
});
