import { z } from "zod";

export const storeConfigSchema = z.object({
  logoUrl: z.string().url().optional(),
  gstNumber: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  website: z.string().url().optional(),
  businessHours: z.string().optional(),
  financialYearStart: z.string().default("04-01"), // April 1st
  storeStatus: z.enum(["OPEN", "CLOSED", "MAINTENANCE"]).default("OPEN")
});

export const invoiceConfigSchema = z.object({
  invoicePrefix: z.string().min(1).default("INV"),
  exchangePrefix: z.string().min(1).default("EX"),
  purchasePrefix: z.string().min(1).default("PO"),
  receiptFooter: z.string().optional(),
  receiptHeader: z.string().optional(),
  invoiceNumberLength: z.number().int().min(4).max(10).default(6),
  financialYearReset: z.boolean().default(true),
  qrCodeEnabled: z.boolean().default(false),
  barcodeFormat: z.enum(["CODE128", "EAN13"]).default("CODE128")
});

export const pricingConfigSchema = z.object({
  decimalPrecision: z.number().int().min(0).max(4).default(2),
  taxInclusive: z.boolean().default(false),
  roundingStrategy: z.enum(["ROUND_HALF_UP", "ROUND_DOWN", "ROUND_UP"]).default("ROUND_HALF_UP"),
  maximumDiscountPercent: z.number().min(0).max(100).default(100),
  cashierDiscountLimit: z.number().min(0).max(100).default(5),
  managerDiscountLimit: z.number().min(0).max(100).default(15),
  ownerDiscountLimit: z.number().min(0).max(100).default(100),
  defaultTaxRate: z.number().min(0).max(100).default(0)
});

export const exchangeConfigSchema = z.object({
  exchangeWindowDays: z.number().int().min(0).default(3),
  billRequired: z.boolean().default(true),
  tagsRequired: z.boolean().default(true),
  managerOverrideRequired: z.boolean().default(false),
  defaultExchangeReasons: z.array(z.string()).default(["Size Issue", "Defective", "Customer Changed Mind"])
});

export const inventoryConfigSchema = z.object({
  allowNegativeStock: z.boolean().default(false),
  lowStockThreshold: z.number().int().min(0).default(5),
  autoSkuGeneration: z.boolean().default(true),
  inventoryReservationMins: z.number().int().min(0).default(15)
});

export const securityConfigSchema = z.object({
  sessionTimeoutMins: z.number().int().min(5).default(480), // 8 hours
  maxLoginAttempts: z.number().int().min(3).default(5),
  accountLockDurationMins: z.number().int().min(1).default(15),
  jwtExpirationHours: z.number().int().min(1).default(12),
  auditLogRetentionDays: z.number().int().min(30).default(365)
});

export const reportingConfigSchema = z.object({
  businessDayStartHour: z.number().int().min(0).max(23).default(9),
  businessDayEndHour: z.number().int().min(0).max(23).default(22),
  defaultDashboardPeriod: z.enum(["TODAY", "WEEK", "MONTH", "YEAR"]).default("TODAY")
});

// A master schema to validate the entire payload if updated collectively
export const configurationUpdateSchema = z.object({
  body: z.object({
    storeName: z.string().min(1).optional(),
    currency: z.string().min(3).optional(),
    timeZone: z.string().min(1).optional(),
    storeConfig: storeConfigSchema.partial().optional(),
    invoiceConfig: invoiceConfigSchema.partial().optional(),
    pricingConfig: pricingConfigSchema.partial().optional(),
    exchangeConfig: exchangeConfigSchema.partial().optional(),
    inventoryConfig: inventoryConfigSchema.partial().optional(),
    securityConfig: securityConfigSchema.partial().optional(),
    reportingConfig: reportingConfigSchema.partial().optional()
  })
});
