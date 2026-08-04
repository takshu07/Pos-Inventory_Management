/**
 * Settings — shared type contract.
 *
 * These mirror the server's Zod schemas in SERVER/src/validation/configuration.validation.ts
 * one-for-one. That file is the source of truth; if the two drift, the server
 * wins and the request 400s.
 *
 * Every settings SCREEN (Store Settings today, Receipt & Invoice and Barcode
 * next) reads and writes this same shape through the same hooks. The blocks are
 * split by domain rather than by screen so a screen can own a subset of blocks
 * without the transport layer needing to know which screen is asking.
 */

export type StoreStatus = "OPEN" | "CLOSED" | "MAINTENANCE";

export interface StoreConfig {
  logoUrl?: string;
  gstNumber?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  businessHours?: string;
  /** MM-DD. Drives financial-year reporting boundaries. */
  financialYearStart: string;
  storeStatus: StoreStatus;
}

export interface InvoiceConfig {
  invoicePrefix: string;
  exchangePrefix: string;
  purchasePrefix: string;
  receiptFooter?: string;
  receiptHeader?: string;
  invoiceNumberLength: number;
  financialYearReset: boolean;
  qrCodeEnabled: boolean;
  /**
   * @deprecated (2026-08-03) No consumer. Barcode symbology lives on
   * `PrinterSetting.barcodeSymbology` and is edited in the Label Engine
   * (/admin/labels?tab=barcode). Kept in the type because the server still
   * returns it. See docs/BARCODE_SETTINGS.md §3.
   *
   * `readonly` is the enforcement, not the comment: legacy documents must stay
   * READABLE, but new code must not WRITE this field. `setField("invoiceConfig",
   * "barcodeFormat", …)` is now a compile error rather than a review catch —
   * `useSettingsForm.setField` is typed `FullConfiguration[B][K]`, so a readonly
   * key cannot be assigned through it.
   *
   * The PATCH type stays writable on purpose (see `SettingsPatch` below), so a
   * legacy client's payload still round-trips through `applyPatch`.
   */
  readonly barcodeFormat: "CODE128" | "EAN13";
}

export interface PricingConfig {
  decimalPrecision: number;
  taxInclusive: boolean;
  roundingStrategy: "ROUND_HALF_UP" | "ROUND_DOWN" | "ROUND_UP";
  maximumDiscountPercent: number;
  cashierDiscountLimit: number;
  managerDiscountLimit: number;
  ownerDiscountLimit: number;
  defaultTaxRate: number;
}

export interface ExchangeConfig {
  exchangeWindowDays: number;
  billRequired: boolean;
  tagsRequired: boolean;
  managerOverrideRequired: boolean;
  defaultExchangeReasons: string[];
}

export interface InventoryConfig {
  allowNegativeStock: boolean;
  lowStockThreshold: number;
  autoSkuGeneration: boolean;
  inventoryReservationMins: number;
}

export interface SecurityConfig {
  sessionTimeoutMins: number;
  maxLoginAttempts: number;
  accountLockDurationMins: number;
  jwtExpirationHours: number;
  auditLogRetentionDays: number;
}

export interface ReportingConfig {
  businessDayStartHour: number;
  businessDayEndHour: number;
  defaultDashboardPeriod: "TODAY" | "WEEK" | "MONTH" | "YEAR";
}

/** ADDITIVE (2026-08). Presentation defaults; nothing in the sale path reads these. */
export interface SystemConfig {
  dateFormat: "DD-MM-YYYY" | "MM-DD-YYYY" | "YYYY-MM-DD";
  timeFormat: "12H" | "24H";
  numberLocale: string;
  defaultLandingPage: "DASHBOARD" | "POS" | "SALES";
  tableDensity: "COMPACT" | "COMFORTABLE";
  itemsPerPage: number;
}

/** ADDITIVE (2026-08). Channel toggles only — never credentials. */
export interface IntegrationConfig {
  emailEnabled: boolean;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
  lowStockAlertsEnabled: boolean;
  dailySummaryEnabled: boolean;
  senderEmail?: string;
  supportPhone?: string;
}

/** The complete payload returned by GET /configuration. */
export interface FullConfiguration {
  storeName: string;
  currency: string;
  timeZone: string;
  /**
   * Monotonic write counter. Sent back on save as `expectedVersion` so a
   * concurrent edit by another owner is refused with 409 instead of silently
   * overwriting their change.
   */
  version: number;
  storeConfig: StoreConfig;
  invoiceConfig: InvoiceConfig;
  pricingConfig: PricingConfig;
  exchangeConfig: ExchangeConfig;
  inventoryConfig: InventoryConfig;
  securityConfig: SecurityConfig;
  reportingConfig: ReportingConfig;
  systemConfig: SystemConfig;
  integrationConfig: IntegrationConfig;
}

/** The JSON block names — used to type patches generically. */
export type ConfigBlockName =
  | "storeConfig"
  | "invoiceConfig"
  | "pricingConfig"
  | "exchangeConfig"
  | "inventoryConfig"
  | "securityConfig"
  | "reportingConfig"
  | "systemConfig"
  | "integrationConfig";

/**
 * A settings PATCH.
 *
 * Deliberately deep-partial: the server merges each block over the stored value,
 * so a payload naming one key inside one block changes exactly that key. Send
 * only what changed — sending a whole block works but re-audits fields nobody
 * touched.
 */
export type SettingsPatch = {
  storeName?: string;
  currency?: string;
  timeZone?: string;
  /** Optimistic-concurrency token. Stripped server-side before validation. */
  expectedVersion?: number;
} & {
  [K in ConfigBlockName]?: Partial<FullConfiguration[K]>;
};
