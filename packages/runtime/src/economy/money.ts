/**
 * Beyonder Compute Economy — Money Representation
 *
 * All internal monetary values use integer microdollars (1 USD = 1,000,000 micros).
 * This eliminates floating-point rounding drift in financial accounting.
 *
 * USD floats exist ONLY at external boundaries:
 * - Config input:  `dailyHardCapUsd: 1.00` → stored as `1_000_000` micros
 * - Display output: `1_000_000` micros → displayed as `$1.00`
 *
 * @see docs/adr/005-money-representation-microdollars.md
 */

/** One USD expressed in microdollars. */
export const MICROS_PER_USD = 1_000_000;

/** Branded integer type: 1 USD = 1,000,000 microdollars. */
export type Microdollars = number & { readonly __brand: "Microdollars" };

/**
 * Cast a validated integer to Microdollars.
 */
export function asMicrodollars(value: number): Microdollars {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`asMicrodollars: invalid integer microdollar value ${value}`);
  }
  return value as Microdollars;
}

/** Value-space helpers for Microdollars. */
export const Microdollars = {
  fromNumber: asMicrodollars,
  fromUsd: (usd: number): Microdollars => usdToMicros(usd),
};

/** Zero microdollars constant. */
export const ZERO_MICROS = 0 as Microdollars;
export const ZERO_MICRODOLLARS = ZERO_MICROS;

/**
 * Convert a USD float to microdollars.
 * Rounds to the nearest integer micro to eliminate floating-point noise.
 */
export function usdToMicros(usd: number): Microdollars {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new RangeError(`usdToMicros: invalid USD value ${usd}`);
  }
  return Math.round(usd * MICROS_PER_USD) as Microdollars;
}

/**
 * Convert microdollars to a USD float for display purposes only.
 * The result should NOT be used for further arithmetic.
 */
export function microsToUsd(micros: Microdollars): number {
  return micros / MICROS_PER_USD;
}

/**
 * Add two microdollar amounts.
 * Result is clamped to non-negative to prevent underflow in display contexts.
 */
export function addMicros(a: Microdollars, b: Microdollars): Microdollars {
  return (a + b) as Microdollars;
}

/** Subtract microdollars. Result may be negative (for balance checks). */
export function subtractMicros(a: Microdollars, b: Microdollars): Microdollars {
  return (a - b) as Microdollars;
}

/** Return the smaller of two microdollar amounts. */
export function minMicros(a: Microdollars, b: Microdollars): Microdollars {
  return Math.min(a, b) as Microdollars;
}

/** Return the larger of two microdollar amounts. */
export function maxMicros(a: Microdollars, b: Microdollars): Microdollars {
  return Math.max(a, b) as Microdollars;
}

/**
 * Format microdollars as a human-readable USD string.
 * Examples: "$0.00", "$0.003421", "$1.50"
 */
export function formatMicros(micros: Microdollars): string {
  const usd = microsToUsd(micros);
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * Validate that a value is a safe non-negative integer suitable for microdollar use.
 * Returns false for NaN, Infinity, negatives, or non-integers.
 */
export function isValidMicros(value: number): value is Microdollars {
  return Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}
