/**
 * Receipt & Invoice Settings — validation and the number preview.
 *
 * The preview is the risky one: it renders a value the SERVER composes. If it
 * drifts from `InvoiceService.generateNextInvoiceNumber`, the screen shows a
 * number the system will never issue, confidently. These tests pin the format on
 * the client side; `SERVER/src/utils/__tests__/invoiceNumbering.test.ts` pins the
 * same format on the server, and the two must agree.
 */

import { describe, expect, it } from "vitest";

import { validateReceiptSettings } from "../validation/receipt";
import { previewInvoiceNumber } from "../utils/invoicePreview";
import type { FullConfiguration } from "../types";

function baseConfig(
  invoiceOverrides: Partial<FullConfiguration["invoiceConfig"]> = {}
): FullConfiguration {
  return {
    storeName: "CEX Fashion",
    currency: "INR",
    timeZone: "Asia/Kolkata",
    version: 1,
    storeConfig: { financialYearStart: "04-01", storeStatus: "OPEN" },
    invoiceConfig: {
      invoicePrefix: "INV",
      exchangePrefix: "EX",
      purchasePrefix: "PO",
      invoiceNumberLength: 6,
      financialYearReset: true,
      qrCodeEnabled: false,
      barcodeFormat: "CODE128",
      ...invoiceOverrides,
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
      defaultExchangeReasons: [],
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

describe("validateReceiptSettings", () => {
  it("accepts the default configuration", () => {
    expect(validateReceiptSettings(baseConfig())).toEqual({});
  });

  it("requires every prefix", () => {
    const errors = validateReceiptSettings(
      baseConfig({ invoicePrefix: "", exchangePrefix: "  " })
    );
    expect(errors["invoiceConfig.invoicePrefix"]).toBeDefined();
    expect(errors["invoiceConfig.exchangePrefix"]).toBeDefined();
  });

  it("rejects a prefix containing a dash", () => {
    // The generated number is PREFIX-DATE-SEQUENCE; an embedded dash makes the
    // segments ambiguous when the sequence is parsed back out.
    const errors = validateReceiptSettings(baseConfig({ invoicePrefix: "IN-V" }));
    expect(errors["invoiceConfig.invoicePrefix"]).toBeDefined();
  });

  it("rejects prefixes with spaces or punctuation", () => {
    expect(
      validateReceiptSettings(baseConfig({ invoicePrefix: "IN V" }))[
        "invoiceConfig.invoicePrefix"
      ]
    ).toBeDefined();
    expect(
      validateReceiptSettings(baseConfig({ invoicePrefix: "INV#" }))[
        "invoiceConfig.invoicePrefix"
      ]
    ).toBeDefined();
  });

  it("accepts an alphanumeric prefix", () => {
    expect(
      validateReceiptSettings(baseConfig({ invoicePrefix: "INV2026" }))[
        "invoiceConfig.invoicePrefix"
      ]
    ).toBeUndefined();
  });

  it("rejects a prefix longer than 10 characters", () => {
    expect(
      validateReceiptSettings(baseConfig({ invoicePrefix: "ABCDEFGHIJK" }))[
        "invoiceConfig.invoicePrefix"
      ]
    ).toBeDefined();
  });

  it("rejects an invoice and exchange prefix that are identical", () => {
    const errors = validateReceiptSettings(
      baseConfig({ invoicePrefix: "DOC", exchangePrefix: "DOC" })
    );
    expect(errors["invoiceConfig.exchangePrefix"]).toBeDefined();
  });

  it("bounds the sequence length to 4–10", () => {
    expect(
      validateReceiptSettings(baseConfig({ invoiceNumberLength: 3 }))[
        "invoiceConfig.invoiceNumberLength"
      ]
    ).toBeDefined();
    expect(
      validateReceiptSettings(baseConfig({ invoiceNumberLength: 11 }))[
        "invoiceConfig.invoiceNumberLength"
      ]
    ).toBeDefined();
    expect(
      validateReceiptSettings(baseConfig({ invoiceNumberLength: 4 }))[
        "invoiceConfig.invoiceNumberLength"
      ]
    ).toBeUndefined();
  });
});

describe("previewInvoiceNumber — must mirror the server format", () => {
  const DATE = new Date("2026-07-12T10:30:00");

  it("composes PREFIX-YYYYMMDD-SEQUENCE", () => {
    // Byte-identical to the server's output for sequence 1 under stock settings.
    expect(previewInvoiceNumber("INV", 6, DATE)).toBe("INV-20260712-000001");
  });

  it("honours the configured prefix and width", () => {
    expect(previewInvoiceNumber("BILL", 4, DATE)).toBe("BILL-20260712-0001");
  });

  it("zero-pads single-digit months and days", () => {
    // The server sorts numbers lexically to find the day's last one, so a
    // non-padded date segment would break that ordering.
    expect(previewInvoiceNumber("INV", 6, new Date("2026-01-05T09:00:00"))).toBe(
      "INV-20260105-000001"
    );
  });

  it("falls back to INV while the prefix field is mid-edit", () => {
    // An emptied input must not preview "undefined-" or "-20260712-".
    expect(previewInvoiceNumber("", 6, DATE)).toBe("INV-20260712-000001");
    expect(previewInvoiceNumber("   ", 6, DATE)).toBe("INV-20260712-000001");
  });

  it("falls back to 6 digits when the width is not a usable number", () => {
    expect(previewInvoiceNumber("INV", Number.NaN, DATE)).toBe("INV-20260712-000001");
    expect(previewInvoiceNumber("INV", 0, DATE)).toBe("INV-20260712-000001");
  });

  it("clamps an absurd width rather than rendering a giant string", () => {
    const out = previewInvoiceNumber("INV", 5000, DATE);
    expect(out.length).toBeLessThan(40);
  });
});
