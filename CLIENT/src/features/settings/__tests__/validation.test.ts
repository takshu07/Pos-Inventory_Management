/**
 * Store Settings — validation and critical-change detection.
 *
 * These are the rules that decide whether a settings save is allowed and
 * whether it demands confirmation. They fail silently when wrong: a broken
 * discount-ladder check does not crash anything, it just lets a cashier
 * discount more deeply than a manager until somebody notices the margins.
 *
 * Mirrors of the server rules are tested on BOTH sides deliberately — the
 * server is the enforcement point, this is the "tell the user which field"
 * point, and they can drift apart independently.
 */

import { describe, expect, it } from "vitest";

import {
  CRITICAL_FIELDS,
  findCriticalChanges,
  validateStoreSettings,
} from "../validation";
import type { FullConfiguration } from "../types";

/** A valid baseline; each test perturbs one thing. */
function baseConfig(overrides: Partial<FullConfiguration> = {}): FullConfiguration {
  return {
    storeName: "CEX Fashion",
    currency: "INR",
    timeZone: "Asia/Kolkata",
    version: 3,
    storeConfig: {
      financialYearStart: "04-01",
      storeStatus: "OPEN",
    },
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
      defaultExchangeReasons: ["Size Issue"],
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
    ...overrides,
  };
}

describe("validateStoreSettings — baseline", () => {
  it("accepts the default configuration", () => {
    expect(validateStoreSettings(baseConfig())).toEqual({});
  });
});

describe("validateStoreSettings — store information", () => {
  it("requires a store name", () => {
    const errors = validateStoreSettings(baseConfig({ storeName: "   " }));
    expect(errors.storeName).toBeDefined();
  });

  it("rejects a malformed email but allows an empty one", () => {
    const bad = baseConfig();
    bad.storeConfig.email = "not-an-email";
    expect(validateStoreSettings(bad)["storeConfig.email"]).toBeDefined();

    const cleared = baseConfig();
    cleared.storeConfig.email = "";
    expect(validateStoreSettings(cleared)["storeConfig.email"]).toBeUndefined();
  });

  it("requires a scheme on the website and logo URLs", () => {
    const config = baseConfig();
    config.storeConfig.website = "example.com";
    config.storeConfig.logoUrl = "example.com/logo.png";
    const errors = validateStoreSettings(config);
    expect(errors["storeConfig.website"]).toBeDefined();
    expect(errors["storeConfig.logoUrl"]).toBeDefined();
  });

  it("enforces MM-DD on the financial year start", () => {
    const config = baseConfig();
    config.storeConfig.financialYearStart = "April";
    expect(validateStoreSettings(config)["storeConfig.financialYearStart"]).toBeDefined();
  });
});

describe("validateStoreSettings — the discount ladder", () => {
  it("rejects a cashier limit above the manager limit, flagging the cashier field", () => {
    const config = baseConfig();
    config.pricingConfig.cashierDiscountLimit = 40;
    const errors = validateStoreSettings(config);
    // The error must land on the field the user can fix, not on the rule.
    expect(errors["pricingConfig.cashierDiscountLimit"]).toBeDefined();
  });

  it("rejects a manager limit above the owner limit", () => {
    const config = baseConfig();
    config.pricingConfig.managerDiscountLimit = 100;
    config.pricingConfig.ownerDiscountLimit = 50;
    expect(validateStoreSettings(config)["pricingConfig.managerDiscountLimit"]).toBeDefined();
  });

  it("rejects any role limit above the store-wide ceiling", () => {
    const config = baseConfig();
    config.pricingConfig.maximumDiscountPercent = 10;
    const errors = validateStoreSettings(config);
    // manager (15) and owner (100) both breach a ceiling of 10.
    expect(errors["pricingConfig.managerDiscountLimit"]).toBeDefined();
    expect(errors["pricingConfig.ownerDiscountLimit"]).toBeDefined();
  });

  it("accepts a ladder where the tiers are equal", () => {
    const config = baseConfig();
    config.pricingConfig.cashierDiscountLimit = 15;
    config.pricingConfig.managerDiscountLimit = 15;
    expect(validateStoreSettings(config)["pricingConfig.cashierDiscountLimit"]).toBeUndefined();
  });

  it("rejects a tax rate outside 0–100", () => {
    const config = baseConfig();
    config.pricingConfig.defaultTaxRate = 120;
    expect(validateStoreSettings(config)["pricingConfig.defaultTaxRate"]).toBeDefined();
  });
});

describe("validateStoreSettings — business day and security", () => {
  it("rejects a business day that ends before it starts", () => {
    const config = baseConfig();
    config.reportingConfig.businessDayStartHour = 22;
    config.reportingConfig.businessDayEndHour = 9;
    expect(validateStoreSettings(config)["reportingConfig.businessDayEndHour"]).toBeDefined();
  });

  it("rejects a session timeout longer than the sign-in duration", () => {
    const config = baseConfig();
    config.securityConfig.sessionTimeoutMins = 1440; // 24h
    config.securityConfig.jwtExpirationHours = 12;
    expect(validateStoreSettings(config)["securityConfig.sessionTimeoutMins"]).toBeDefined();
  });

  it("allows a session timeout exactly equal to the sign-in duration", () => {
    const config = baseConfig();
    config.securityConfig.sessionTimeoutMins = 720;
    config.securityConfig.jwtExpirationHours = 12;
    expect(validateStoreSettings(config)["securityConfig.sessionTimeoutMins"]).toBeUndefined();
  });

  it("enforces the minimum login attempts and audit retention", () => {
    const config = baseConfig();
    config.securityConfig.maxLoginAttempts = 1;
    config.securityConfig.auditLogRetentionDays = 7;
    const errors = validateStoreSettings(config);
    expect(errors["securityConfig.maxLoginAttempts"]).toBeDefined();
    expect(errors["securityConfig.auditLogRetentionDays"]).toBeDefined();
  });
});

describe("validateStoreSettings — integrations", () => {
  it("requires a sender address when email is enabled", () => {
    const config = baseConfig();
    config.integrationConfig.emailEnabled = true;
    expect(validateStoreSettings(config)["integrationConfig.senderEmail"]).toBeDefined();
  });

  it("allows email enabled once a sender address is set", () => {
    const config = baseConfig();
    config.integrationConfig.emailEnabled = true;
    config.integrationConfig.senderEmail = "noreply@example.com";
    expect(validateStoreSettings(config)["integrationConfig.senderEmail"]).toBeUndefined();
  });
});

describe("findCriticalChanges", () => {
  it("finds nothing in a harmless patch", () => {
    expect(findCriticalChanges({ systemConfig: { itemsPerPage: 50 } })).toEqual([]);
    expect(findCriticalChanges({ storeName: "New Name" })).toEqual([]);
  });

  it("flags a tax-mode change", () => {
    expect(findCriticalChanges({ pricingConfig: { taxInclusive: true } })).toEqual([
      "pricingConfig.taxInclusive",
    ]);
  });

  it("flags a currency change, which lives at the top level", () => {
    expect(findCriticalChanges({ currency: "USD" })).toEqual(["currency"]);
  });

  it("flags every critical field in a mixed patch and ignores the rest", () => {
    const paths = findCriticalChanges({
      storeName: "Renamed",
      pricingConfig: { defaultTaxRate: 18, decimalPrecision: 3 },
      inventoryConfig: { allowNegativeStock: true, lowStockThreshold: 9 },
    });
    expect(paths).toContain("pricingConfig.defaultTaxRate");
    expect(paths).toContain("inventoryConfig.allowNegativeStock");
    // Not critical: obvious on sight and self-correcting.
    expect(paths).not.toContain("pricingConfig.decimalPrecision");
    expect(paths).not.toContain("inventoryConfig.lowStockThreshold");
    expect(paths).not.toContain("storeName");
  });

  it("never treats the concurrency token as a change", () => {
    expect(findCriticalChanges({ expectedVersion: 7 })).toEqual([]);
  });

  it("has an explanation for every field it can flag", () => {
    // A path with no message would render an empty confirmation row, which is
    // worse than not confirming at all.
    for (const [path, message] of Object.entries(CRITICAL_FIELDS)) {
      expect(message, `${path} has no explanation`).toBeTruthy();
      expect(message.length).toBeGreaterThan(20);
    }
  });
});
