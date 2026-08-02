// =============================================================================
// CASH REGISTER VALIDATION SCHEMAS
//
// Money arrives as a JSON number and is validated here before it becomes a
// Decimal in the service. Two rules are enforced at this boundary rather than
// deeper down:
//
//   1. `.multipleOf(0.01)` — a payout of ₹12.3456 is a typo or an attack, and
//      accepting it would round somewhere unpredictable later.
//   2. The close-shift REFINEMENT — a discrepancy requires a reason. Expressing
//      it as a cross-field refine returns a field-attributable 400 instead of a
//      generic service error thrown after the variance has already been computed.
//
// Enums are declared as string literals rather than imported from the generated
// Prisma client, matching the convention the inventory and workforce modules
// established: validation should not break because a client regeneration is
// pending, and a schema that rejects unknown `sortBy` values is what stops that
// field from becoming an ORDER BY injection surface.
// =============================================================================

import { z } from "zod";
import { DENOMINATIONS } from "../engines/cashRegister.engine";

// =============================================================================
// SHARED PRIMITIVES
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

/** A currency amount: non-negative, at most 2dp, bounded below Decimal(12,2). */
const money = z
  .number()
  .min(0)
  .max(99_999_999)
  .multipleOf(0.01, "Amount cannot have more than two decimal places.");

/** A currency amount that must be greater than zero. */
const positiveMoney = money.refine((v) => v > 0, "Amount must be greater than zero.");

const registerStatusEnum = z.enum(["OPEN", "CLOSED", "RECONCILED"]);

const payoutCategoryEnum = z.enum([
  "TEA", "COURIER", "PACKAGING", "CLEANING", "TRANSPORT",
  "STATIONERY", "MAINTENANCE", "UTILITIES", "STAFF_WELFARE", "MISCELLANEOUS",
]);

const activityTypeEnum = z.enum([
  "OPENED", "SALE", "REFUND", "EXCHANGE", "CASH_DROP", "CASH_PAYOUT",
  "EXPENSE", "ADJUSTMENT", "NOTE", "CLOSED", "RECONCILED",
]);

const exportFormatEnum = z.enum(["csv", "excel", "pdf"]);

/**
 * A denomination map, `{ "500": 4, "100": 7 }`.
 * Keys are restricted to the known note/coin set so a typo cannot invent a
 * denomination and inflate the counted total.
 */
const denominationsSchema = z
  .record(
    z.enum(DENOMINATIONS.map(String) as [string, ...string[]]),
    z.coerce.number().int().min(0).max(100_000)
  )
  .optional();

const registerNumber = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9-]+$/, "Register number may contain letters, digits and hyphens only.");

const id = z.string().trim().min(1);

// =============================================================================
// SESSION LIFECYCLE
// =============================================================================

const openRegisterSchema = z.object({
  registerNumber: registerNumber.default("REG-01"),
  openingCash: money,
  notes: z.string().trim().max(500).optional(),
  /** Optional opening denomination count, for stores that require one. */
  denominations: denominationsSchema,
});

const closeRegisterSchema = z
  .object({
    countedCash: money,
    notes: z.string().trim().max(1000).optional(),
    discrepancyReason: z.string().trim().min(3).max(500).optional(),
    denominations: denominationsSchema,
    /**
     * The expected figure the CLIENT displayed when the cashier signed off.
     * When present the server compares it against its own and rejects a
     * mismatch — this is not trust in the client, it is a guard against closing
     * against a stale dashboard, where a sale landed while the modal was open
     * and the cashier approved a number that is no longer true.
     */
    expectedCashAtSubmit: money.optional(),
  })
  .refine(
    (v) =>
      v.expectedCashAtSubmit === undefined ||
      Math.abs(v.countedCash - v.expectedCashAtSubmit) < 0.005 ||
      (v.discrepancyReason?.trim().length ?? 0) >= 3,
    {
      message: "A reason is required when the counted cash does not match the expected cash.",
      path: ["discrepancyReason"],
    }
  );

const reconcileRegisterSchema = z.object({
  reconcileNotes: z.string().trim().max(1000).optional(),
});

// =============================================================================
// DRAWER MOVEMENTS
// =============================================================================

const createCashDropSchema = z.object({
  amount: positiveMoney,
  reason: z.string().trim().min(3, "State why cash is leaving the drawer.").max(300),
  destination: z.string().trim().max(120).optional(),
  referenceNumber: z.string().trim().max(80).optional(),
  witnessedById: id.optional(),
});

const createCashPayoutSchema = z.object({
  category: payoutCategoryEnum,
  amount: positiveMoney,
  reason: z.string().trim().min(3, "State what the money was spent on.").max(300),
  payeeName: z.string().trim().max(120).optional(),
  receiptAssetId: id.optional(),
});

/**
 * A manual drawer correction (e.g. a miscounted opening float found mid-shift).
 * Deliberately NOT a generic "cash in/out" endpoint: an untyped cash movement is
 * indistinguishable from a drop or a payout after the fact, so every adjustment
 * carries its own reason and lands as an ADJUSTMENT activity that stands out on
 * the timeline.
 */
const createAdjustmentSchema = z.object({
  direction: z.enum(["IN", "OUT"]),
  amount: positiveMoney,
  reason: z.string().trim().min(5, "An adjustment must explain itself.").max(300),
});

const addRegisterNoteSchema = z.object({
  note: z.string().trim().min(1).max(500),
});

// =============================================================================
// QUERIES
// =============================================================================

const registerHistoryQuerySchema = z.object({
  ...pagination,
  search: z.string().trim().max(120).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  employeeId: id.optional(),
  registerNumber: registerNumber.optional(),
  status: registerStatusEnum.optional(),
  /** Only sessions whose drawer did not balance. */
  hasDiscrepancy: queryBoolean,
  sortBy: z.enum(["openedAt", "closedAt", "difference", "expectedBalance"]).default("openedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const registerActivityQuerySchema = z.object({
  ...pagination,
  type: activityTypeEnum.optional(),
});

const cashDropQuerySchema = z.object({
  ...pagination,
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  registerId: id.optional(),
  employeeId: id.optional(),
  search: z.string().trim().max(120).optional(),
});

const cashPayoutQuerySchema = z.object({
  ...pagination,
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  registerId: id.optional(),
  employeeId: id.optional(),
  category: payoutCategoryEnum.optional(),
  search: z.string().trim().max(120).optional(),
});

const shiftSummaryExportSchema = z.object({
  format: exportFormatEnum.default("pdf"),
});

const registerHistoryExportSchema = registerHistoryQuerySchema.extend({
  format: exportFormatEnum.default("csv"),
});

// =============================================================================
// BARREL
// =============================================================================

export const cashRegisterValidation = {
  open: openRegisterSchema,
  close: closeRegisterSchema,
  reconcile: reconcileRegisterSchema,

  createDrop: createCashDropSchema,
  createPayout: createCashPayoutSchema,
  createAdjustment: createAdjustmentSchema,
  addNote: addRegisterNoteSchema,

  historyQuery: registerHistoryQuerySchema,
  activityQuery: registerActivityQuerySchema,
  dropQuery: cashDropQuerySchema,
  payoutQuery: cashPayoutQuerySchema,

  summaryExport: shiftSummaryExportSchema,
  historyExport: registerHistoryExportSchema,
} as const;

export type OpenRegisterInput = z.infer<typeof openRegisterSchema>;
export type CloseRegisterInput = z.infer<typeof closeRegisterSchema>;
export type ReconcileRegisterInput = z.infer<typeof reconcileRegisterSchema>;
export type CreateCashDropInput = z.infer<typeof createCashDropSchema>;
export type CreateCashPayoutInput = z.infer<typeof createCashPayoutSchema>;
export type CreateAdjustmentInput = z.infer<typeof createAdjustmentSchema>;
export type AddRegisterNoteInput = z.infer<typeof addRegisterNoteSchema>;
export type RegisterHistoryQuery = z.infer<typeof registerHistoryQuerySchema>;
export type RegisterActivityQuery = z.infer<typeof registerActivityQuerySchema>;
export type CashDropQuery = z.infer<typeof cashDropQuerySchema>;
export type CashPayoutQuery = z.infer<typeof cashPayoutQuerySchema>;
export type RegisterHistoryExportQuery = z.infer<typeof registerHistoryExportSchema>;
