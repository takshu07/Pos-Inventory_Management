/**
 * Settings — patch counting and the optimistic merge.
 *
 * `applyPatch` must compute exactly what the server will compute. When the two
 * disagree the UI shows one value, the save response replaces it with another,
 * and the field visibly flickers on every save — so these tests are the mirror
 * of the server's `mergeConfigBlock` suite.
 */

import { describe, expect, it } from "vitest";

import { applyPatch } from "../hooks/useSettings";
import { countChanges } from "../utils/patch";
import type { FullConfiguration } from "../types";

function baseConfig(): FullConfiguration {
  return {
    storeName: "CEX Fashion",
    currency: "INR",
    timeZone: "Asia/Kolkata",
    version: 3,
    storeConfig: { financialYearStart: "04-01", storeStatus: "OPEN", gstNumber: "GST123" },
    invoiceConfig: {
      invoicePrefix: "INV",
      exchangePrefix: "EX",
      purchasePrefix: "PO",
      invoiceNumberLength: 6,
      financialYearReset: true,
      qrCodeEnabled: false,
      barcodeFormat: "CODE128",
    },
    pricingConfig: {
      decimalPrecision: 2,
      taxInclusive: false,
      roundingStrategy: "ROUND_HALF_UP",
      maximumDiscountPercent: 100,
      cashierDiscountLimit: 5,
      managerDiscountLimit: 15,
      ownerDiscountLimit: 100,
      defaultTaxRate: 0,
    },
    exchangeConfig: {
      exchangeWindowDays: 3,
      billRequired: true,
      tagsRequired: true,
      managerOverrideRequired: false,
      defaultExchangeReasons: ["Size Issue", "Defective"],
    },
    inventoryConfig: {
      allowNegativeStock: false,
      lowStockThreshold: 5,
      autoSkuGeneration: true,
      inventoryReservationMins: 15,
    },
    securityConfig: {
      sessionTimeoutMins: 480,
      maxLoginAttempts: 5,
      accountLockDurationMins: 15,
      jwtExpirationHours: 12,
      auditLogRetentionDays: 365,
    },
    reportingConfig: {
      businessDayStartHour: 9,
      businessDayEndHour: 22,
      defaultDashboardPeriod: "TODAY",
    },
    systemConfig: {
      dateFormat: "DD-MM-YYYY",
      timeFormat: "12H",
      numberLocale: "en-IN",
      defaultLandingPage: "DASHBOARD",
      tableDensity: "COMFORTABLE",
      itemsPerPage: 20,
    },
    integrationConfig: {
      emailEnabled: false,
      smsEnabled: false,
      whatsappEnabled: false,
      lowStockAlertsEnabled: true,
      dailySummaryEnabled: false,
    },
  };
}

describe("countChanges", () => {
  it("counts individual fields, not blocks", () => {
    expect(
      countChanges({
        storeName: "New",
        pricingConfig: { defaultTaxRate: 18, decimalPrecision: 3 },
      })
    ).toBe(3);
  });

  it("returns zero for an empty patch", () => {
    expect(countChanges({})).toBe(0);
  });

  it("never counts the concurrency token as a change", () => {
    // Otherwise the save bar reads "1 unsaved change" with nothing pending.
    expect(countChanges({ expectedVersion: 9 })).toBe(0);
    expect(countChanges({ expectedVersion: 9, storeName: "New" })).toBe(1);
  });
});

describe("applyPatch — mirrors the server merge", () => {
  it("preserves sibling keys the patch does not mention", () => {
    const next = applyPatch(baseConfig(), { pricingConfig: { defaultTaxRate: 18 } });

    expect(next.pricingConfig.defaultTaxRate).toBe(18);
    // The whole point: an unrelated field must survive the merge.
    expect(next.pricingConfig.cashierDiscountLimit).toBe(5);
    expect(next.pricingConfig.managerDiscountLimit).toBe(15);
    expect(next.pricingConfig.roundingStrategy).toBe("ROUND_HALF_UP");
  });

  it("leaves untouched blocks entirely alone", () => {
    const base = baseConfig();
    const next = applyPatch(base, { pricingConfig: { defaultTaxRate: 18 } });
    expect(next.securityConfig).toEqual(base.securityConfig);
    expect(next.storeConfig).toEqual(base.storeConfig);
  });

  it("applies top-level scalars", () => {
    const next = applyPatch(baseConfig(), { storeName: "Renamed", currency: "USD" });
    expect(next.storeName).toBe("Renamed");
    expect(next.currency).toBe("USD");
    expect(next.timeZone).toBe("Asia/Kolkata");
  });

  it("replaces arrays wholesale rather than merging index-wise", () => {
    const next = applyPatch(baseConfig(), {
      exchangeConfig: { defaultExchangeReasons: ["Defective"] },
    });
    // A deep merge would leave "Size Issue" behind, making the list unshrinkable.
    expect(next.exchangeConfig.defaultExchangeReasons).toEqual(["Defective"]);
  });

  it("never writes the concurrency token into the cached document", () => {
    const next = applyPatch(baseConfig(), { expectedVersion: 42, storeName: "New" });
    expect(next).not.toHaveProperty("expectedVersion");
    expect(next.version).toBe(3);
  });

  it("does not mutate the input", () => {
    const base = baseConfig();
    applyPatch(base, { pricingConfig: { defaultTaxRate: 99 } });
    expect(base.pricingConfig.defaultTaxRate).toBe(0);
  });

  it("applies multiple blocks in one patch", () => {
    const next = applyPatch(baseConfig(), {
      pricingConfig: { taxInclusive: true },
      inventoryConfig: { lowStockThreshold: 12 },
      systemConfig: { itemsPerPage: 50 },
    });
    expect(next.pricingConfig.taxInclusive).toBe(true);
    expect(next.inventoryConfig.lowStockThreshold).toBe(12);
    expect(next.systemConfig.itemsPerPage).toBe(50);
    // And still preserves siblings within each touched block.
    expect(next.inventoryConfig.autoSkuGeneration).toBe(true);
  });
});
