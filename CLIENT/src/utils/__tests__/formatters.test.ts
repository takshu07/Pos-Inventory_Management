/**
 * Global formatters — configuration propagation.
 *
 * `formatCurrency` is called from ~650 places and is the mechanism by which a
 * currency change in Store Settings reaches all of them. If
 * `configureCurrencyFormatting` stops taking effect, nothing breaks loudly:
 * every screen simply keeps rendering the old currency symbol against the new
 * store's amounts, which is exactly the kind of wrong that ships.
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  configureCurrencyFormatting,
  formatCurrency,
  getActiveCurrency,
} from "../formatters";

/**
 * Formatted output contains non-breaking / narrow-no-break spaces depending on
 * the ICU build, so assertions target the symbol and digits rather than exact
 * whitespace.
 */
function normalize(value: string): string {
  return value.replace(/[  \s]/g, " ");
}

afterEach(() => {
  // Module-level state: reset so ordering cannot leak between tests.
  configureCurrencyFormatting("INR", "en-IN");
});

describe("formatCurrency — defaults", () => {
  it("formats in Indian rupees with Indian digit grouping by default", () => {
    const out = normalize(formatCurrency(100000));
    expect(out).toContain("₹");
    // Indian grouping is 1,00,000 — not 100,000.
    expect(out).toContain("1,00,000");
  });

  it("renders whole units, matching the POS's whole-rupee rounding", () => {
    expect(normalize(formatCurrency(1234.56))).toContain("1,235");
    expect(normalize(formatCurrency(1234.56))).not.toContain(".");
  });

  it("coerces non-finite amounts to zero instead of rendering NaN", () => {
    // A NaN reaching a receipt is worse than a zero.
    expect(normalize(formatCurrency(Number.NaN))).toContain("0");
    expect(normalize(formatCurrency(Number.POSITIVE_INFINITY))).toContain("0");
  });
});

describe("configureCurrencyFormatting", () => {
  it("switches the symbol used by every subsequent call", () => {
    configureCurrencyFormatting("USD", "en-US");
    const out = normalize(formatCurrency(100000));
    expect(out).toContain("$");
    expect(out).not.toContain("₹");
  });

  it("switches digit grouping with the locale", () => {
    configureCurrencyFormatting("USD", "en-US");
    // Western grouping — 100,000 rather than 1,00,000.
    expect(normalize(formatCurrency(100000))).toContain("100,000");
  });

  it("reports the active currency code", () => {
    expect(getActiveCurrency()).toBe("INR");
    configureCurrencyFormatting("AED", "en-US");
    expect(getActiveCurrency()).toBe("AED");
  });

  it("takes effect immediately, without a reload", () => {
    // This is the propagation guarantee: an owner saving a new currency sees it
    // applied on the next render, not on the next session.
    const before = normalize(formatCurrency(500));
    configureCurrencyFormatting("GBP", "en-GB");
    const after = normalize(formatCurrency(500));
    expect(before).not.toBe(after);
    expect(after).toContain("£");
  });

  it("falls back to defaults rather than throwing on an invalid currency", () => {
    // A bad value must degrade to a readable amount, never crash a receipt.
    configureCurrencyFormatting("NOT_A_CURRENCY", "en-IN");
    expect(() => formatCurrency(100)).not.toThrow();
    expect(normalize(formatCurrency(100))).toContain("100");
  });

  it("falls back to defaults rather than throwing on an invalid locale", () => {
    configureCurrencyFormatting("INR", "!!invalid!!");
    expect(() => formatCurrency(100)).not.toThrow();
    expect(normalize(formatCurrency(100))).toContain("100");
  });

  it("treats empty values as the defaults", () => {
    configureCurrencyFormatting("", "");
    expect(getActiveCurrency()).toBe("INR");
    expect(normalize(formatCurrency(100))).toContain("₹");
  });
});
