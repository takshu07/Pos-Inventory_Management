// =============================================================================
// REPORTS VALIDATION SCHEMAS
//
// ONE FILTER SCHEMA, TWELVE REPORTS.
//
// The spec requires every report to support the same filter set (date range,
// employee, customer, supplier, brand, category, product, SKU, invoice number,
// payment method). Expressing that as one shared block rather than repeating it
// per report is what makes the guarantee real: a report cannot accidentally
// omit a filter, because it does not declare its filters at all.
//
// Reports that need MORE than the common set extend the block. None of them
// narrow it — a report that silently ignored `brandId` while still accepting it
// would be worse than one that rejected it.
// =============================================================================

import { z } from "zod";

// =============================================================================
// SHARED
// =============================================================================

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
};

const queryBoolean = z
  .union([z.literal("true"), z.literal("false"), z.boolean()])
  .transform((v) => v === true || v === "true")
  .optional();

const id = z.string().trim().min(1);

const periodEnum = z
  .enum(["today", "yesterday", "week", "month", "quarter", "year", "custom"])
  .default("month");

const granularityEnum = z.enum(["auto", "day", "week", "month", "year"]).default("auto");
const paymentMethodEnum = z.enum(["CASH", "UPI", "CARD", "CREDIT", "GIFT_CARD", "OTHER"]);
const exportFormatEnum = z.enum(["csv", "excel", "pdf"]);

/**
 * The universal filter block, required on every report by the spec.
 * Kept as a spreadable object rather than a z.object so reports can extend it
 * without a merge that could silently drop a key.
 */
const filters = {
  period: periodEnum,
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),

  employeeId: id.optional(),
  customerId: id.optional(),
  supplierId: id.optional(),
  brandId: id.optional(),
  categoryId: id.optional(),
  productId: id.optional(),
  variantId: id.optional(),
  sku: z.string().trim().max(120).optional(),
  invoiceNumber: z.string().trim().max(120).optional(),
  paymentMethod: paymentMethodEnum.optional(),
};

// =============================================================================
// REPORT SCHEMAS
// =============================================================================

const dashboardQuerySchema = z.object({ ...filters });

const salesReportSchema = z.object({
  ...filters,
  granularity: granularityEnum,
});

const productReportSchema = z.object({
  ...filters,
  ...pagination,
  sortBy: z.enum(["revenue", "units", "profit", "margin", "returns", "exchanges"]).default("revenue"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const categoryReportSchema = z.object({ ...filters });
const brandReportSchema = z.object({ ...filters });

const customerReportSchema = z.object({
  ...filters,
  ...pagination,
  sortBy: z.enum(["spend", "orders", "recent"]).default("spend"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  /** Days without a purchase before a customer counts as inactive. */
  inactiveDays: z.coerce.number().int().min(7).max(730).default(90),
});

const employeeReportSchema = z.object({ ...filters });

const inventoryReportSchema = z.object({
  ...filters,
  ...pagination,
  bucket: z.enum(["ALL", "LOW", "OUT", "OVERSTOCK", "DEAD", "FAST", "SLOW"]).default("ALL"),
  /** Window, in days, for velocity and dead-stock maths. */
  velocityDays: z.coerce.number().int().min(7).max(365).default(30),
  groupBy: z.enum(["category", "brand", "supplier"]).default("category"),
});

const purchaseReportSchema = z.object({ ...filters });

const paymentReportSchema = z.object({
  ...filters,
  granularity: granularityEnum,
});

const returnReportSchema = z.object({
  ...filters,
  ...pagination,
});

const profitReportSchema = z.object({
  ...filters,
  granularity: granularityEnum,
  includeBreakdown: queryBoolean,
});

// =============================================================================
// SEARCH & EXPORT
// =============================================================================

const globalSearchSchema = z.object({
  q: z.string().trim().min(2, "Type at least two characters.").max(120),
  limit: z.coerce.number().int().min(1).max(25).default(8),
});

/** The report keys the export dispatcher understands. */
const reportKeyEnum = z.enum([
  "sales",
  "products",
  "categories",
  "brands",
  "customers",
  "employees",
  "inventory",
  "purchases",
  "payments",
  "returns",
  "profit",
]);

const exportQuerySchema = z.object({
  report: reportKeyEnum,
  format: exportFormatEnum.default("csv"),
});

// =============================================================================
// BARREL
// =============================================================================

export const reportsValidation = {
  dashboardQuery: dashboardQuerySchema,
  salesReport: salesReportSchema,
  productReport: productReportSchema,
  categoryReport: categoryReportSchema,
  brandReport: brandReportSchema,
  customerReport: customerReportSchema,
  employeeReport: employeeReportSchema,
  inventoryReport: inventoryReportSchema,
  purchaseReport: purchaseReportSchema,
  paymentReport: paymentReportSchema,
  returnReport: returnReportSchema,
  profitReport: profitReportSchema,

  globalSearch: globalSearchSchema,
  exportQuery: exportQuerySchema,
} as const;

export type ReportKey = z.infer<typeof reportKeyEnum>;
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export type SalesReportQuery = z.infer<typeof salesReportSchema>;
export type ProductReportQuery = z.infer<typeof productReportSchema>;
export type CategoryReportQuery = z.infer<typeof categoryReportSchema>;
export type BrandReportQuery = z.infer<typeof brandReportSchema>;
export type CustomerReportQuery = z.infer<typeof customerReportSchema>;
export type EmployeeReportQuery = z.infer<typeof employeeReportSchema>;
export type InventoryReportQuery = z.infer<typeof inventoryReportSchema>;
export type PurchaseReportQuery = z.infer<typeof purchaseReportSchema>;
export type PaymentReportQuery = z.infer<typeof paymentReportSchema>;
export type ReturnReportQuery = z.infer<typeof returnReportSchema>;
export type ProfitReportQuery = z.infer<typeof profitReportSchema>;
export type GlobalSearchQuery = z.infer<typeof globalSearchSchema>;
export type ReportExportQuery = z.infer<typeof exportQuerySchema>;

/** The shape every report query shares — what the service turns into filters. */
export type CommonReportQuery = z.infer<typeof dashboardQuerySchema>;
