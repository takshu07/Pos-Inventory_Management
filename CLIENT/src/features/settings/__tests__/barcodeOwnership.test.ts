/**
 * Barcode configuration ownership — regression guard.
 *
 * THE BUG THIS PREVENTS
 * ---------------------
 * `invoiceConfig.barcodeFormat` was editable in Receipt & Invoice Settings and
 * documented as "read by the Label Engine for product labels". It was not read
 * by anything. The Label Engine resolves symbology from
 * `PrinterSetting.barcodeSymbology`, so an owner could switch that control to
 * EAN13, save successfully, and watch every label print exactly as before.
 *
 * The field is now retired: the control is gone, the Print Options section
 * links to the Label Engine instead, and the Zod field survives only so stored
 * documents and older clients keep validating.
 *
 * These tests assert the two properties that keep it retired — the patch layer
 * still round-trips the deprecated key, and no settings screen ever sends it.
 * See docs/BARCODE_SETTINGS.md §3.
 */

import { describe, expect, it } from "vitest";

import { applyPatch } from "../hooks/useSettings";
import type { FullConfiguration, SettingsPatch } from "../types";

/**
 * Source text is loaded through Vite's `?raw` import rather than `node:fs`.
 *
 * The app tsconfig compiles `src` without Node types, so a filesystem read here
 * would mean widening the whole app's type configuration to accommodate one
 * test. `?raw` is handled by the bundler the tests already run under and keeps
 * this suite inside the browser-ish environment every other suite uses.
 */
import receiptPage from "../pages/ReceiptInvoiceSettingsPage.tsx?raw";
import optionsSource from "../utils/options.ts?raw";
import typesSource from "../types/index.ts?raw";
import routerSource from "../../../app/router/index.tsx?raw";
import navSource from "../../../config/navigation.ts?raw";

function baseConfig(): FullConfiguration {
  return {
    storeName: "CEX Fashion",
    currency: "INR",
    timeZone: "Asia/Kolkata",
    version: 7,
    storeConfig: { financialYearStart: "04-01", storeStatus: "OPEN" },
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
      itemsPerPage: 25,
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

describe("deprecated barcodeFormat — backward compatibility", () => {
  it("still round-trips through the patch layer", () => {
    // Retiring the CONTROL must not break the FIELD: stored documents already
    // contain this key and older clients still PATCH it. Dropping support
    // would 400 those requests.
    const next = applyPatch(baseConfig(), {
      invoiceConfig: { barcodeFormat: "EAN13" },
    });

    expect(next.invoiceConfig.barcodeFormat).toBe("EAN13");
  });

  it("survives an unrelated patch to the same block", () => {
    // The merge is per key. A screen patching only invoicePrefix must not
    // reset the deprecated field to its Zod default.
    const next = applyPatch(baseConfig(), {
      invoiceConfig: { invoicePrefix: "BILL" },
    });

    expect(next.invoiceConfig.invoicePrefix).toBe("BILL");
    expect(next.invoiceConfig.barcodeFormat).toBe("CODE128");
  });

  it("stays readable — legacy documents must not become unreadable", () => {
    // "Deprecated" means no NEW writes, not inaccessible. Anything still
    // reporting on stored configuration must keep working.
    expect(baseConfig().invoiceConfig.barcodeFormat).toBe("CODE128");
  });
});

describe("deprecated barcodeFormat — writes blocked at the type level", () => {
  /**
   * The real enforcement is `readonly barcodeFormat` in types/index.ts, which
   * makes `setField("invoiceConfig", "barcodeFormat", …)` a TS2540 compile
   * error — verified with a throwaway probe when the modifier was added.
   *
   * A runtime test cannot observe a compile error, so this pins the DECLARATION
   * instead. Without it, someone could drop `readonly`, the comment would still
   * read "deprecated", and every write guard in this file would keep passing
   * while new code silently started writing the field again.
   */
  it("the readonly modifier is still on the interface", () => {
    expect(typesSource).toMatch(/readonly\s+barcodeFormat\s*:/);
  });

  it("SettingsPatch stays writable so legacy payloads still type-check", () => {
    // Deliberate asymmetry: the CONFIG type is readonly (blocks new writes),
    // the PATCH type is not (older clients keep round-tripping). If someone
    // "tidies" this by making the patch readonly too, legacy PATCHes stop
    // compiling — hence the assertion.
    const legacy: SettingsPatch = { invoiceConfig: { barcodeFormat: "EAN13" } };
    expect(legacy.invoiceConfig?.barcodeFormat).toBe("EAN13");
  });
});

describe("deprecated barcodeFormat — no screen writes it", () => {
  /**
   * Source-level assertions rather than DOM ones.
   *
   * The failure mode is a developer re-adding a `setField("invoiceConfig",
   * "barcodeFormat", …)` control, which a render test would only catch if it
   * happened to query that exact control. Reading the source catches any
   * reintroduction regardless of how it is labelled.
   */
  it("Receipt & Invoice Settings never sets barcodeFormat", () => {
    expect(receiptPage).not.toMatch(/setField\(\s*["']invoiceConfig["']\s*,\s*["']barcodeFormat["']/);
    expect(receiptPage).not.toMatch(/saveField\(\s*["']invoiceConfig["']\s*,\s*["']barcodeFormat["']/);
  });

  it("Receipt & Invoice Settings points at the Label Engine instead", () => {
    // The section must not simply drop barcode configuration on the floor —
    // an owner looking for it needs to be told where it actually lives.
    expect(receiptPage).toContain("/admin/labels?tab=barcode");
  });

  it("the two-option BARCODE_FORMAT_OPTIONS constant is gone", () => {
    // Barcode options are now built from the server's live capabilities
    // payload, so a newly implemented symbology needs no client change.
    expect(optionsSource).not.toMatch(/export const BARCODE_FORMAT_OPTIONS/);
  });

  it("does not import the removed options constant", () => {
    // A stale import of a deleted export is invisible to `tsc --noEmit` run
    // against the root config; this pins it regardless.
    expect(receiptPage).not.toMatch(/import\s*\{[^}]*BARCODE_FORMAT_OPTIONS/);
  });
});

describe("barcode settings routing", () => {
  it("/admin/settings/barcode redirects into the Label Engine", () => {
    // The nav entry and existing bookmarks point here. It must resolve to the
    // module that owns barcode configuration rather than a placeholder or a
    // second, parallel screen.
    expect(routerSource).toMatch(
      /path:\s*["']admin\/settings\/barcode["'][\s\S]{0,200}?\/admin\/labels\?tab=barcode/
    );
  });

  it("the sidebar no longer marks Barcode Settings as coming soon", () => {
    const entry = navSource
      .split("\n")
      .find((line: string) => line.includes("/admin/settings/barcode"));

    expect(entry).toBeDefined();
    expect(entry).not.toContain("comingSoon");
  });
});
