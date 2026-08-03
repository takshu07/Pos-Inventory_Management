/**
 * Regression tests for the settings partial-update rule.
 *
 * The bug these lock down: assigning a partial patch straight onto a JSON column
 * wipes every key the patch omitted, and because each block is re-parsed through
 * a Zod schema of all-`.default()` fields, the wiped keys silently return as
 * stock defaults instead of erroring. A store's configured discount ladder would
 * revert to shipped values with nothing logged.
 */

import { describe, it, expect } from "vitest";
import { mergeConfigBlock } from "../configMerge";
import {
  findConfigurationConflicts,
  configurationUpdateSchema,
  storeConfigSchema,
  systemConfigSchema,
  integrationConfigSchema,
} from "../../validation/configuration.validation";

describe("mergeConfigBlock", () => {
  it("preserves stored keys the patch does not mention", () => {
    const stored = {
      cashierDiscountLimit: 5,
      managerDiscountLimit: 15,
      defaultTaxRate: 18,
      roundingStrategy: "ROUND_HALF_UP",
    };

    const merged = mergeConfigBlock(stored, { defaultTaxRate: 12 });

    expect(merged).toEqual({
      cashierDiscountLimit: 5,
      managerDiscountLimit: 15,
      defaultTaxRate: 12,
      roundingStrategy: "ROUND_HALF_UP",
    });
  });

  it("overwrites only the keys present in the patch", () => {
    const merged = mergeConfigBlock({ a: 1, b: 2 }, { b: 99 });
    expect(merged.a).toBe(1);
    expect(merged.b).toBe(99);
  });

  it("ignores undefined patch values so they cannot erase stored data", () => {
    // This is how an omitted-or-cleared optional field arrives after Zod
    // normalisation. It must be a no-op, not a delete.
    const merged = mergeConfigBlock({ gstNumber: "29ABCDE1234F1Z5" }, { gstNumber: undefined });
    expect(merged.gstNumber).toBe("29ABCDE1234F1Z5");
  });

  it("replaces arrays wholesale rather than merging them index-wise", () => {
    // Shortening a list must be possible; a deep merge would leave the old tail.
    const merged = mergeConfigBlock(
      { defaultExchangeReasons: ["Size Issue", "Defective", "Changed Mind"] },
      { defaultExchangeReasons: ["Defective"] }
    );
    expect(merged.defaultExchangeReasons).toEqual(["Defective"]);
  });

  it("treats a missing or corrupt stored block as empty instead of throwing", () => {
    expect(mergeConfigBlock(null, { a: 1 })).toEqual({ a: 1 });
    expect(mergeConfigBlock(undefined, { a: 1 })).toEqual({ a: 1 });
    // An array in an object column is corrupt data; it must not become the base.
    expect(mergeConfigBlock(["junk"], { a: 1 })).toEqual({ a: 1 });
  });

  it("returns the stored block unchanged when there is no patch", () => {
    const stored = { a: 1, b: 2 };
    expect(mergeConfigBlock(stored, undefined)).toEqual(stored);
  });

  it("does not mutate the stored object", () => {
    const stored = { a: 1 };
    const merged = mergeConfigBlock(stored, { a: 2 });
    expect(stored.a).toBe(1);
    expect(merged.a).toBe(2);
  });
});

describe("findConfigurationConflicts", () => {
  it("accepts a correctly ordered discount ladder", () => {
    expect(
      findConfigurationConflicts({
        pricingConfig: {
          cashierDiscountLimit: 5,
          managerDiscountLimit: 15,
          ownerDiscountLimit: 100,
          maximumDiscountPercent: 100,
        },
      })
    ).toEqual([]);
  });

  it("rejects a cashier limit above the manager limit", () => {
    const problems = findConfigurationConflicts({
      pricingConfig: { cashierDiscountLimit: 40, managerDiscountLimit: 15 },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/cashier discount limit/i);
  });

  it("rejects a manager limit above the owner limit", () => {
    const problems = findConfigurationConflicts({
      pricingConfig: { managerDiscountLimit: 60, ownerDiscountLimit: 50 },
    });
    expect(problems[0]).toMatch(/manager discount limit/i);
  });

  it("rejects any role limit above the store-wide ceiling", () => {
    const problems = findConfigurationConflicts({
      pricingConfig: {
        cashierDiscountLimit: 10,
        managerDiscountLimit: 20,
        ownerDiscountLimit: 30,
        maximumDiscountPercent: 25,
      },
    });
    // Owner (30) breaches the 25 ceiling; the ladder itself is ordered.
    expect(problems.some((p) => /owner discount limit/i.test(p))).toBe(true);
  });

  it("catches a ladder inversion created by a PATCH carrying only one side", () => {
    // The whole reason conflicts are checked post-merge: this payload has no
    // cashier limit in it at all, so a body-level check could not see the clash.
    const stored = { cashierDiscountLimit: 20, managerDiscountLimit: 30 };
    const merged = mergeConfigBlock(stored, { managerDiscountLimit: 10 });
    const problems = findConfigurationConflicts({ pricingConfig: merged });
    expect(problems[0]).toMatch(/cashier discount limit/i);
  });

  it("rejects a business day that ends before or when it starts", () => {
    expect(
      findConfigurationConflicts({
        reportingConfig: { businessDayStartHour: 22, businessDayEndHour: 9 },
      })
    ).toHaveLength(1);
    // Zero-length day is equally invalid — every business-day report would be empty.
    expect(
      findConfigurationConflicts({
        reportingConfig: { businessDayStartHour: 9, businessDayEndHour: 9 },
      })
    ).toHaveLength(1);
  });

  it("rejects a session timeout that outlives the JWT", () => {
    const problems = findConfigurationConflicts({
      securityConfig: { sessionTimeoutMins: 1440, jwtExpirationHours: 12 },
    });
    expect(problems[0]).toMatch(/session timeout/i);
  });

  it("allows a session timeout exactly equal to the JWT lifetime", () => {
    expect(
      findConfigurationConflicts({
        securityConfig: { sessionTimeoutMins: 720, jwtExpirationHours: 12 },
      })
    ).toEqual([]);
  });

  it("stays silent when only one half of a pair is known", () => {
    // A partial patch must not be rejected merely for being partial.
    expect(
      findConfigurationConflicts({ pricingConfig: { cashierDiscountLimit: 5 } })
    ).toEqual([]);
    expect(
      findConfigurationConflicts({ reportingConfig: { businessDayStartHour: 9 } })
    ).toEqual([]);
  });
});

describe("configurationUpdateSchema", () => {
  it("accepts a payload containing a single nested key", () => {
    const parsed = configurationUpdateSchema.parse({
      body: { pricingConfig: { defaultTaxRate: 18 } },
    });
    expect(parsed.body.pricingConfig).toEqual({ defaultTaxRate: 18 });
    // Untouched blocks must be absent, not defaulted — the service distinguishes
    // "not sent" from "sent empty" to decide which columns to write.
    expect(parsed.body.storeConfig).toBeUndefined();
  });

  it("does not inject defaults for keys the caller never sent", () => {
    // REGRESSION: `.partial()` keeps `.default()` wrappers, so a one-field save
    // used to arrive carrying a full set of default discount limits. The service
    // cannot tell those from real input and merges them over the stored block —
    // silently resetting a configured ladder during an unrelated save.
    const parsed = configurationUpdateSchema.parse({
      body: { pricingConfig: { defaultTaxRate: 18 } },
    });

    expect(Object.keys(parsed.body.pricingConfig!)).toEqual(["defaultTaxRate"]);
    expect(parsed.body.pricingConfig).not.toHaveProperty("cashierDiscountLimit");
    expect(parsed.body.pricingConfig).not.toHaveProperty("managerDiscountLimit");
    expect(parsed.body.pricingConfig).not.toHaveProperty("roundingStrategy");
  });

  it("still enforces each field's own rules on a patch", () => {
    // Stripping the default must not strip the validator with it.
    expect(() =>
      configurationUpdateSchema.parse({ body: { pricingConfig: { defaultTaxRate: 150 } } })
    ).toThrow();
    expect(() =>
      configurationUpdateSchema.parse({ body: { securityConfig: { maxLoginAttempts: 1 } } })
    ).toThrow();
    expect(() =>
      configurationUpdateSchema.parse({ body: { invoiceConfig: { barcodeFormat: "QR" } } })
    ).toThrow();
  });

  it("normalises a currency code to uppercase", () => {
    const parsed = configurationUpdateSchema.parse({ body: { currency: "inr" } });
    expect(parsed.body.currency).toBe("INR");
  });

  it("rejects a currency code that is not three letters", () => {
    expect(() =>
      configurationUpdateSchema.parse({ body: { currency: "RUPEES" } })
    ).toThrow();
  });

  it("rejects an empty store name", () => {
    expect(() =>
      configurationUpdateSchema.parse({ body: { storeName: "   " } })
    ).toThrow();
  });

  it("accepts the additive system and integration blocks", () => {
    const parsed = configurationUpdateSchema.parse({
      body: {
        systemConfig: { itemsPerPage: 50 },
        integrationConfig: { emailEnabled: true },
      },
    });
    expect(parsed.body.systemConfig).toEqual({ itemsPerPage: 50 });
    expect(parsed.body.integrationConfig).toEqual({ emailEnabled: true });
  });
});

describe("storeConfigSchema optional-field handling", () => {
  it("treats an emptied text input as a clear rather than a validation error", () => {
    // The form sends "" when the user wipes the field. Rejecting it would make
    // clearing a GST number impossible through the UI.
    const parsed = storeConfigSchema.partial().parse({ gstNumber: "" });
    expect(parsed.gstNumber).toBeUndefined();
  });

  it("treats an emptied URL the same way instead of failing .url()", () => {
    const parsed = storeConfigSchema.partial().parse({ logoUrl: "" });
    expect(parsed.logoUrl).toBeUndefined();
  });

  it("still rejects a non-empty malformed URL", () => {
    expect(() => storeConfigSchema.partial().parse({ logoUrl: "not-a-url" })).toThrow();
  });

  it("still rejects a non-empty malformed email", () => {
    expect(() => storeConfigSchema.partial().parse({ email: "nope" })).toThrow();
  });

  it("enforces MM-DD on the financial year start", () => {
    expect(() =>
      storeConfigSchema.partial().parse({ financialYearStart: "2026-04-01" })
    ).toThrow();
    expect(storeConfigSchema.partial().parse({ financialYearStart: "04-01" }).financialYearStart)
      .toBe("04-01");
  });

  it("trims surrounding whitespace on free text", () => {
    expect(storeConfigSchema.partial().parse({ address: "  12 Main St  " }).address)
      .toBe("12 Main St");
  });
});

describe("additive config block defaults", () => {
  it("builds a complete systemConfig from an empty object", () => {
    // The engine parses `{}` for any block that has never been written, so every
    // field must have a default or a fresh install would fail to boot.
    const parsed = systemConfigSchema.parse({});
    expect(parsed.dateFormat).toBe("DD-MM-YYYY");
    expect(parsed.itemsPerPage).toBe(20);
    expect(parsed.numberLocale).toBe("en-IN");
  });

  it("builds a complete integrationConfig from an empty object", () => {
    const parsed = integrationConfigSchema.parse({});
    expect(parsed.emailEnabled).toBe(false);
    expect(parsed.lowStockAlertsEnabled).toBe(true);
  });

  it("bounds itemsPerPage so a setting cannot make a page unloadable", () => {
    expect(() => systemConfigSchema.parse({ itemsPerPage: 5000 })).toThrow();
  });
});
