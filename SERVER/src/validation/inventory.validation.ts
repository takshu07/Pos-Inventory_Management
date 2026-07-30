// =============================================================================
// INVENTORY VALIDATION SCHEMAS
//
// Every query string is a string until proven otherwise, so numbers, booleans
// and dates are coerced here rather than defensively re-parsed in the service.
//
// A schema that rejects unknown sort fields is also a security control: it is
// what stops `sortBy` from becoming an injection surface into the ORDER BY.
// =============================================================================

import { z } from "zod";

// =============================================================================
// SHARED
// =============================================================================

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};

/** Query-string booleans arrive as "true"/"false" literals, never as booleans. */
const queryBoolean = z
  .union([z.literal("true"), z.literal("false"), z.boolean()])
  .transform((v) => v === true || v === "true")
  .optional();

const periodEnum = z
  .enum(["today", "week", "month", "quarter", "year", "custom"])
  .default("month");

const movementTypeEnum = z.enum([
  "PURCHASE", "SALE", "EXCHANGE_IN", "EXCHANGE_OUT", "SUPPLIER_RETURN",
  "MANUAL_ADJUSTMENT", "DAMAGED", "LOST", "OPENING_STOCK",
]);

/**
 * Derived stock states. Split from the server-filterable ones deliberately:
 * LOW/OUT/NEGATIVE are SQL-expressible, while FAST/SLOW/DEAD/RESERVED require
 * joined aggregates and are applied after enrichment. The service knows which
 * is which; the enum simply enumerates what a caller may ask for.
 */
const stockStatusEnum = z.enum([
  "ALL", "IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK", "NEGATIVE", "OVERSTOCKED",
  "FAST_MOVING", "SLOW_MOVING", "DEAD_STOCK", "RESERVED", "DAMAGED",
]);

/** Sortable columns. Computed ones are ranked in the service after aggregation. */
const stockSortEnum = z
  .enum([
    "sku", "currentStock", "costPrice", "sellingPrice", "createdAt", "updatedAt",
    "available", "stockValue", "unitsSold", "lastMovementAt",
  ])
  .default("updatedAt");

// =============================================================================
// STOCK OVERVIEW
// =============================================================================

const stockQuerySchema = z.object({
  ...pagination,
  search: z.string().trim().max(120).optional(),
  categoryId: z.string().trim().optional(),
  brandId: z.string().trim().optional(),
  supplierId: z.string().trim().optional(),
  status: stockStatusEnum.default("ALL"),
  isActive: queryBoolean,
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  /** Window, in days, for velocity and reorder maths. */
  velocityDays: z.coerce.number().int().min(7).max(365).default(30),
  sortBy: stockSortEnum,
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

/** Barcode/SKU scan — one code, nothing else. */
const scanSchema = z.object({
  code: z.string().trim().min(1, "Scan or enter a code").max(120),
});

// =============================================================================
// MOVEMENTS (ledger reads)
// =============================================================================

const movementQuerySchema = z.object({
  ...pagination,
  variantId: z.string().trim().optional(),
  type: movementTypeEnum.optional(),
  employeeId: z.string().trim().optional(),
  search: z.string().trim().max(120).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});

// =============================================================================
// RESERVATIONS
// =============================================================================

const reservationTypeEnum = z.enum(["EXCHANGE", "CUSTOMER_HOLD", "ORDER", "OTHER"]);
const reservationStatusEnum = z.enum(["ACTIVE", "FULFILLED", "RELEASED", "EXPIRED"]);

const createReservationSchema = z
  .object({
    variantId: z.string().trim().min(1),
    quantity: z.coerce.number().int().min(1, "Reserve at least one unit"),
    type: reservationTypeEnum.default("CUSTOMER_HOLD"),
    heldFor: z.string().trim().max(120).optional(),
    customerId: z.string().trim().optional(),
    exchangeId: z.string().trim().optional(),
    reason: z.string().trim().max(500).optional(),
    /** Minutes from now. Omitted means the store's configured default. */
    expiresInMinutes: z.coerce.number().int().min(1).max(60 * 24 * 30).optional(),
  })
  .refine((v) => v.type !== "OTHER" || Boolean(v.reason), {
    // An "OTHER" hold with no reason is unauditable — nobody can later tell
    // why stock was withheld from sale.
    message: "A reason is required when the reservation type is OTHER.",
    path: ["reason"],
  });

const reservationQuerySchema = z.object({
  ...pagination,
  variantId: z.string().trim().optional(),
  status: reservationStatusEnum.optional(),
  type: reservationTypeEnum.optional(),
  customerId: z.string().trim().optional(),
});

// =============================================================================
// STOCK ADJUSTMENTS
// =============================================================================

const adjustmentReasonEnum = z.enum([
  "DAMAGE", "LOST", "THEFT", "MISCOUNT", "SUPPLIER_ERROR",
  "SYSTEM_CORRECTION", "EXPIRED", "OTHER",
]);

const createAdjustmentSchema = z
  .object({
    variantId: z.string().trim().min(1),
    /** Signed delta. Zero would be a no-op record and is rejected. */
    quantityChange: z.coerce.number().int().refine((n) => n !== 0, {
      message: "The quantity change cannot be zero.",
    }),
    reason: adjustmentReasonEnum,
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.reason !== "OTHER" || Boolean(v.notes), {
    // Mandatory reason is a spec requirement; OTHER without notes defeats it.
    message: "Notes are required when the reason is OTHER.",
    path: ["notes"],
  });

const reviewAdjustmentSchema = z
  .object({
    approve: z.boolean(),
    reviewNotes: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.approve || Boolean(v.reviewNotes), {
    // Rejecting without saying why leaves the requester with no path forward.
    message: "Please say why the adjustment was rejected.",
    path: ["reviewNotes"],
  });

const adjustmentQuerySchema = z.object({
  ...pagination,
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  variantId: z.string().trim().optional(),
  requestedById: z.string().trim().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});

// =============================================================================
// DAMAGED STOCK
// =============================================================================

const reportDamageSchema = z.object({
  variantId: z.string().trim().min(1),
  quantity: z.coerce.number().int().min(1, "Report at least one unit"),
  reason: z.string().trim().min(1, "A reason is required").max(500),
});

const damagedQuerySchema = z.object({
  ...pagination,
  variantId: z.string().trim().optional(),
  isWrittenOff: queryBoolean,
});

// =============================================================================
// CYCLE COUNTS
// =============================================================================

const startCycleCountSchema = z.object({
  name: z.string().trim().max(120).optional(),
  /** Scope filters. All optional — omitting every one counts everything. */
  categoryId: z.string().trim().optional(),
  brandId: z.string().trim().optional(),
  supplierId: z.string().trim().optional(),
  notes: z.string().trim().max(1000).optional(),
});

const recordCountSchema = z.object({
  variantId: z.string().trim().min(1),
  /** Zero is a legitimate count — it means "the shelf is empty". */
  countedQuantity: z.coerce.number().int().min(0),
  notes: z.string().trim().max(500).optional(),
});

/** Scan-driven counting: a code rather than an id, because scanners emit codes. */
const scanCountSchema = z.object({
  code: z.string().trim().min(1).max(120),
  countedQuantity: z.coerce.number().int().min(0),
  notes: z.string().trim().max(500).optional(),
});

const completeCycleCountSchema = z.object({
  /**
   * Whether variances become real stock adjustments.
   *
   * Default TRUE: a count whose findings are never posted has told you the
   * system is wrong and then left it wrong. Opting out is for a dry run.
   */
  postAdjustments: z.boolean().default(true),
  notes: z.string().trim().max(1000).optional(),
});

const cycleCountQuerySchema = z.object({
  ...pagination,
  status: z.enum(["IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
});

// =============================================================================
// ANALYTICS / REPORTS
// =============================================================================

const dashboardQuerySchema = z.object({
  period: periodEnum,
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});

const velocityQuerySchema = z.object({
  ...pagination,
  /** Which end of the curve to return. */
  bucket: z.enum(["FAST_MOVING", "SLOW_MOVING", "DEAD_STOCK"]).default("DEAD_STOCK"),
  windowDays: z.coerce.number().int().min(7).max(365).default(90),
  categoryId: z.string().trim().optional(),
  brandId: z.string().trim().optional(),
});

const reorderQuerySchema = z.object({
  ...pagination,
  supplierId: z.string().trim().optional(),
  categoryId: z.string().trim().optional(),
  /** Sales window used to estimate the daily rate. */
  windowDays: z.coerce.number().int().min(7).max(365).default(30),
  leadTimeDays: z.coerce.number().int().min(0).max(180).optional(),
  safetyDays: z.coerce.number().int().min(0).max(180).optional(),
  /** Only items the model says should be reordered. */
  dueOnly: queryBoolean,
});

const valuationQuerySchema = z.object({
  categoryId: z.string().trim().optional(),
  brandId: z.string().trim().optional(),
  supplierId: z.string().trim().optional(),
  /** Group the breakdown by this dimension. */
  groupBy: z.enum(["category", "brand", "supplier", "none"]).default("category"),
});

const exportQuerySchema = z.object({
  report: z.enum([
    "stock", "valuation", "movements", "adjustments",
    "low-stock", "out-of-stock", "dead-stock", "fast-moving", "slow-moving", "aging",
  ]),
  format: z.enum(["csv", "excel", "pdf"]).default("csv"),
});

// =============================================================================
// BATCH OPERATIONS
// =============================================================================

const batchSchema = z.object({
  variantIds: z
    .array(z.string().trim().min(1))
    .min(1, "Select at least one item")
    // Bounded so a runaway selection cannot become an unbounded write.
    .max(500, "Select at most 500 items at a time"),
});

const batchAdjustSchema = batchSchema.extend({
  quantityChange: z.coerce.number().int().refine((n) => n !== 0, {
    message: "The quantity change cannot be zero.",
  }),
  reason: adjustmentReasonEnum,
  notes: z.string().trim().max(1000).optional(),
});

const batchCategorySchema = batchSchema.extend({
  categoryId: z.string().trim().min(1),
});

const batchReorderLevelSchema = batchSchema.extend({
  reorderLevel: z.coerce.number().int().min(0).max(1_000_000),
});

// =============================================================================
// EXPORTS
// =============================================================================

export const inventoryValidation = {
  stockQuery: stockQuerySchema,
  scan: scanSchema,
  movementQuery: movementQuerySchema,

  createReservation: createReservationSchema,
  reservationQuery: reservationQuerySchema,

  createAdjustment: createAdjustmentSchema,
  reviewAdjustment: reviewAdjustmentSchema,
  adjustmentQuery: adjustmentQuerySchema,

  reportDamage: reportDamageSchema,
  damagedQuery: damagedQuerySchema,

  startCycleCount: startCycleCountSchema,
  recordCount: recordCountSchema,
  scanCount: scanCountSchema,
  completeCycleCount: completeCycleCountSchema,
  cycleCountQuery: cycleCountQuerySchema,

  dashboardQuery: dashboardQuerySchema,
  velocityQuery: velocityQuerySchema,
  reorderQuery: reorderQuerySchema,
  valuationQuery: valuationQuerySchema,
  exportQuery: exportQuerySchema,

  batch: batchSchema,
  batchAdjust: batchAdjustSchema,
  batchCategory: batchCategorySchema,
  batchReorderLevel: batchReorderLevelSchema,
} as const;

export type StockQuery = z.infer<typeof stockQuerySchema>;
export type ScanInput = z.infer<typeof scanSchema>;
export type MovementQuery = z.infer<typeof movementQuerySchema>;
export type CreateReservationInput = z.infer<typeof createReservationSchema>;
export type ReservationQuery = z.infer<typeof reservationQuerySchema>;
export type CreateAdjustmentInput = z.infer<typeof createAdjustmentSchema>;
export type ReviewAdjustmentInput = z.infer<typeof reviewAdjustmentSchema>;
export type AdjustmentQuery = z.infer<typeof adjustmentQuerySchema>;
export type ReportDamageInput = z.infer<typeof reportDamageSchema>;
export type DamagedQuery = z.infer<typeof damagedQuerySchema>;
export type StartCycleCountInput = z.infer<typeof startCycleCountSchema>;
export type RecordCountInput = z.infer<typeof recordCountSchema>;
export type ScanCountInput = z.infer<typeof scanCountSchema>;
export type CompleteCycleCountInput = z.infer<typeof completeCycleCountSchema>;
export type CycleCountQuery = z.infer<typeof cycleCountQuerySchema>;
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export type VelocityQuery = z.infer<typeof velocityQuerySchema>;
export type ReorderQuery = z.infer<typeof reorderQuerySchema>;
export type ValuationQuery = z.infer<typeof valuationQuerySchema>;
export type InventoryExportQuery = z.infer<typeof exportQuerySchema>;
export type BatchInput = z.infer<typeof batchSchema>;
export type BatchAdjustInput = z.infer<typeof batchAdjustSchema>;
export type BatchCategoryInput = z.infer<typeof batchCategorySchema>;
export type BatchReorderLevelInput = z.infer<typeof batchReorderLevelSchema>;
