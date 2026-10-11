import { describe, expect, it } from "vitest";
import {
  addMicros,
  formatMicros,
  isValidMicros,
  maxMicros,
  microsToUsd,
  minMicros,
  subtractMicros,
  usdToMicros,
  ZERO_MICROS,
  type Microdollars
} from "../money.js";

describe("Compute Economy — Money Representation", () => {
  it("converts USD floats to integer microdollars accurately", () => {
    expect(usdToMicros(1)).toBe(1_000_000);
    expect(usdToMicros(0)).toBe(0);
    expect(usdToMicros(0.25)).toBe(250_000);
    expect(usdToMicros(0.000001)).toBe(1);
    expect(usdToMicros(0.003421)).toBe(3_421);
    expect(usdToMicros(100.5)).toBe(100_500_000);
  });

  it("converts microdollars back to USD floats for display", () => {
    expect(microsToUsd(1_000_000 as Microdollars)).toBe(1.0);
    expect(microsToUsd(250_000 as Microdollars)).toBe(0.25);
    expect(microsToUsd(1 as Microdollars)).toBe(0.000001);
    expect(microsToUsd(ZERO_MICROS)).toBe(0);
  });

  it("rejects negative, NaN, and infinite USD values", () => {
    expect(() => usdToMicros(-1)).toThrow(RangeError);
    expect(() => usdToMicros(NaN)).toThrow(RangeError);
    expect(() => usdToMicros(Infinity)).toThrow(RangeError);
  });

  it("performs exact integer arithmetic without float drift", () => {
    // Classic float bug: 0.1 + 0.2 = 0.30000000000000004
    const a = usdToMicros(0.1);
    const b = usdToMicros(0.2);
    const sum = addMicros(a, b);
    expect(sum).toBe(300_000);
    expect(microsToUsd(sum)).toBe(0.3);

    const diff = subtractMicros(sum, a);
    expect(diff).toBe(200_000);
  });

  it("computes min and max correctly", () => {
    const a = usdToMicros(0.05);
    const b = usdToMicros(0.10);
    expect(minMicros(a, b)).toBe(a);
    expect(maxMicros(a, b)).toBe(b);
  });

  it("formats microdollars into human-readable strings", () => {
    expect(formatMicros(ZERO_MICROS)).toBe("$0.00");
    expect(formatMicros(usdToMicros(1.50))).toBe("$1.50");
    expect(formatMicros(usdToMicros(0.003421))).toBe("$0.003421");
    expect(formatMicros(usdToMicros(0.000005))).toBe("$0.000005");
  });

  it("validates safe integer microdollar values", () => {
    expect(isValidMicros(0)).toBe(true);
    expect(isValidMicros(1_000_000)).toBe(true);
    expect(isValidMicros(-1)).toBe(false);
    expect(isValidMicros(1.5)).toBe(false);
    expect(isValidMicros(NaN)).toBe(false);
    expect(isValidMicros(Infinity)).toBe(false);
  });
});
