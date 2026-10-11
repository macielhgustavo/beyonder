/**
 * Beyonder Compute Economy — Configuration
 *
 * Defines the compute economy configuration, modes, and defaults.
 * All monetary values in config are USD floats (converted to microdollars at load time).
 */

import { usdToMicros, type Microdollars } from "./money.js";

/** Compute spending modes. */
export type ComputeMode = "zero_cost" | "bounded" | "manual_approval";

/**
 * Current Development Policy Flag:
 * Under current development policy, live real monetary spend is forbidden.
 * Product currently runs in zero-cost or mock/offline validation modes.
 */
export const PAID_EXECUTION_ENABLED = false;

/** Operator-facing configuration (USD floats). */
export interface ComputeEconomyConfig {
  /** Spending mode. Default: 'zero_cost' (v0.5 behavior). */
  mode: ComputeMode;
  /** Monthly hard spending cap in USD. 0 = no paid compute allowed. */
  monthlyHardCapUsd: number;
  /** Daily hard spending cap in USD. Default: monthlyHardCap / 30. */
  dailyHardCapUsd: number;
  /** Per-objective hard cap in USD. */
  defaultObjectiveHardCapUsd: number;
  /** Per-objective soft optimization target in USD. */
  defaultObjectiveSoftTargetUsd: number;
  /** Maximum cost of any single inference request in USD. */
  maxSingleInferenceUsd: number;
}

/** Resolved configuration with microdollar values ready for runtime use. */
export interface ResolvedComputeEconomy {
  mode: ComputeMode;
  monthlyHardCapMicros: Microdollars;
  dailyHardCapMicros: Microdollars;
  defaultObjectiveHardCapMicros: Microdollars;
  defaultObjectiveSoftTargetMicros: Microdollars;
  maxSingleInferenceMicros: Microdollars;
}

/** Safe defaults — zero-cost mode, no paid compute. */
export const DEFAULT_COMPUTE_ECONOMY_CONFIG: ComputeEconomyConfig = {
  mode: "zero_cost",
  monthlyHardCapUsd: 0,
  dailyHardCapUsd: 0,
  defaultObjectiveHardCapUsd: 0.25,
  defaultObjectiveSoftTargetUsd: 0.03,
  maxSingleInferenceUsd: 0.10
};

/**
 * Resolve operator config (USD floats) to runtime config (microdollars).
 * Validates constraints and applies defaults.
 */
export function resolveComputeEconomy(
  config: (Partial<ComputeEconomyConfig> & Record<string, any>) = {}
): ResolvedComputeEconomy {
  const normalized: Partial<ComputeEconomyConfig> = { ...config };
  if ("BEYONDER_COMPUTE_MODE" in config && config.BEYONDER_COMPUTE_MODE) {
    normalized.mode = config.BEYONDER_COMPUTE_MODE as ComputeMode;
  }
  if ("BEYONDER_MONTHLY_HARD_CAP_USD" in config && config.BEYONDER_MONTHLY_HARD_CAP_USD !== undefined) {
    normalized.monthlyHardCapUsd = Number(config.BEYONDER_MONTHLY_HARD_CAP_USD);
  }
  if ("BEYONDER_DAILY_HARD_CAP_USD" in config && config.BEYONDER_DAILY_HARD_CAP_USD !== undefined) {
    normalized.dailyHardCapUsd = Number(config.BEYONDER_DAILY_HARD_CAP_USD);
  }
  if ("BEYONDER_OBJECTIVE_HARD_CAP_USD" in config && config.BEYONDER_OBJECTIVE_HARD_CAP_USD !== undefined) {
    normalized.defaultObjectiveHardCapUsd = Number(config.BEYONDER_OBJECTIVE_HARD_CAP_USD);
  }
  if ("BEYONDER_OBJECTIVE_SOFT_TARGET_USD" in config && config.BEYONDER_OBJECTIVE_SOFT_TARGET_USD !== undefined) {
    normalized.defaultObjectiveSoftTargetUsd = Number(config.BEYONDER_OBJECTIVE_SOFT_TARGET_USD);
  }
  if ("BEYONDER_MAX_SINGLE_INFERENCE_USD" in config && config.BEYONDER_MAX_SINGLE_INFERENCE_USD !== undefined) {
    normalized.maxSingleInferenceUsd = Number(config.BEYONDER_MAX_SINGLE_INFERENCE_USD);
  }
  const merged = { ...DEFAULT_COMPUTE_ECONOMY_CONFIG, ...normalized };

  // If monthly cap is 0, force zero_cost mode regardless of explicit mode.
  if (merged.monthlyHardCapUsd <= 0 && merged.mode !== "zero_cost") {
    merged.mode = "zero_cost";
  }

  // Default daily to monthly / 30 if not explicitly set.
  if (merged.dailyHardCapUsd <= 0 && merged.monthlyHardCapUsd > 0) {
    merged.dailyHardCapUsd = merged.monthlyHardCapUsd / 30;
  }

  // Validate: daily cannot exceed monthly.
  if (merged.dailyHardCapUsd > merged.monthlyHardCapUsd && merged.monthlyHardCapUsd > 0) {
    merged.dailyHardCapUsd = merged.monthlyHardCapUsd;
  }

  // Validate: objective cap cannot exceed daily.
  if (merged.defaultObjectiveHardCapUsd > merged.dailyHardCapUsd && merged.dailyHardCapUsd > 0) {
    merged.defaultObjectiveHardCapUsd = merged.dailyHardCapUsd;
  }

  // Validate: single inference cannot exceed objective cap.
  if (merged.maxSingleInferenceUsd > merged.defaultObjectiveHardCapUsd) {
    merged.maxSingleInferenceUsd = merged.defaultObjectiveHardCapUsd;
  }

  return {
    mode: merged.mode,
    monthlyHardCapMicros: usdToMicros(merged.monthlyHardCapUsd),
    dailyHardCapMicros: usdToMicros(merged.dailyHardCapUsd),
    defaultObjectiveHardCapMicros: usdToMicros(merged.defaultObjectiveHardCapUsd),
    defaultObjectiveSoftTargetMicros: usdToMicros(merged.defaultObjectiveSoftTargetUsd),
    maxSingleInferenceMicros: usdToMicros(merged.maxSingleInferenceUsd)
  };
}
