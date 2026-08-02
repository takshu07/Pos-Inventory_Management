// =============================================================================
// FINANCE VALIDATION SCHEMAS
//
// Enums are string literals rather than imports from the generated Prisma
// client, matching the convention the inventory and workforce modules set.
// A schema that rejects unknown `sortBy` values is also a security control:
// it is what stops that field becoming an ORDER BY injection surface.
//
// Every query string is a string until proven otherwise, so numbers, booleans
// and dates are coerced here rather than defensively re-parsed in the service.
// =============================================================================

import { z } from "zod";

// =============================================================================
// SHARED
// =============================================================================

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};

const queryBoolean = z
  .union([z.literal("true"), z.literal("false"), z.boolean()])
  .transform((v) => v === true || v === "true")
  .optional();

const money = z
  .number()
  .min(0)
  .max(99_999_999)
  .multipleOf(0.01, "Amount cannot have more than two decimal places.");

const positiveMoney = money.refine((v) => v > 0, "Amount must be greater than zero.");

const id = z.string().trim().min(1);

const paymentMethodEnum = z.enum(["CASH", "UPI", "CARD", "CREDIT", "GIFT_CARD", "OTHER"]);
const approvalStatusEnum = z.enum(["PENDING", "APPROVED", "REJECTED"]);
const settlementStatusEnum = z.enum(["UNPAID", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"]);
const salaryStatusEnum = z.enum(["PENDING", "PARTIALLY_PAID", "PAID", "CANCELLED"]);
const salaryAdjustmentTypeEnum = z.enum([
  "ADVANCE", "BONUS", "OVERTIME", "INCENTIVE", "DEDUCTION", "REIMBURSEMENT",
]);
const exportFormatEnum = z.enum(["csv", "excel", "pdf"]);

/**
 * The period vocabulary every finance screen shares.
 * Defined once so "this week" cannot mean Monday-start on one screen and
 * Sunday-start on another — the resolution itself lives in finance.engine.
 */
const periodEnum = z
  .enum(["today", "yesterday", "week", "month", "quarter", "year", "custom"])
  .default("month");

const granularityEnum = z.enum(["auto", "day", "week", "month", "year"]).default("auto");

/** The date-window block shared by every analytical endpoint. */
const periodBlock = {
  period: periodEnum,
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
};

// =============================================================================
// DASHBOARD & ANALYTICS
// =============================================================================

const dashboardQuerySchema = z.object({ ...periodBlock });

const revenueQuerySchema = z.object({
  ...periodBlock,
  granularity: granularityEnum,
});

const profitLossQuerySchema = z.object({
  ...periodBlock,
  granularity: granularityEnum,
  /** Include the per-category expense breakdown. Off by default — it is an
   *  extra grouped join the summary view does not need. */
  includeBreakdown: queryBoolean,
});

const cashFlowQuerySchema = z.object({
  ...periodBlock,
  granularity: granularityEnum,
});

const paymentAnalyticsQuerySchema = z.object({
  ...periodBlock,
  granularity: granularityEnum,
});

// =============================================================================
// EXPENSES
// =============================================================================

const createExpenseSchema = z.object({
  categoryId: id,
  title: z.string().trim().min(3, "Give the expense a recognisable title.").max(120),
  amount: positiveMoney,
  vendorName: z.string().trim().max(120).optional(),
  paymentMethod: paymentMethodEnum.default("CASH"),
  referenceNumber: z.string().trim().max(80).optional(),
  description: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
  expenseDate: z.coerce.date().optional(),
  receiptAssetId: id.optional(),
  /**
   * Submit for approval instead of recording it as approved.
   * Defaults to false so the historical behaviour — an owner records a cost and
   * it counts immediately — is unchanged; a store that wants a maker/checker
   * flow opts into it per expense.
   */
  requiresApproval: z.boolean().default(false),
});

const updateExpenseSchema = z.object({
  categoryId: id.optional(),
  title: z.string().trim().min(3).max(120).optional(),
  amount: positiveMoney.optional(),
  vendorName: z.string().trim().max(120).nullable().optional(),
  paymentMethod: paymentMethodEnum.optional(),
  referenceNumber: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  expenseDate: z.coerce.date().optional(),
  receiptAssetId: id.nullable().optional(),
});

const reviewExpenseSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT"]),
    rejectionReason: z.string().trim().max(500).optional(),
  })
  // A rejection without a reason gives the person who raised the expense no
  // path to fixing it, so the workflow would stall on every rejection.
  .refine((v) => v.decision !== "REJECT" || (v.rejectionReason?.trim().length ?? 0) >= 3, {
    message: "A reason is required when rejecting an expense.",
    path: ["rejectionReason"],
  });

const expenseQuerySchema = z.object({
  ...pagination,
  ...periodBlock,
  search: z.string().trim().max(120).optional(),
  categoryId: id.optional(),
  employeeId: id.optional(),
  paymentMethod: paymentMethodEnum.optional(),
  approvalStatus: approvalStatusEnum.optional(),
  registerId: id.optional(),
  minAmount: z.coerce.number().min(0).optional(),
  maxAmount: z.coerce.number().min(0).optional(),
  sortBy: z.enum(["expenseDate", "amount", "createdAt", "title"]).default("expenseDate"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const createExpenseCategorySchema = z.object({
  name: z.string().trim().min(2).max(60),
  code: z.string().trim().max(40).regex(/^[A-Z0-9_]+$/, "Use upper-case letters, digits and underscores.").optional(),
  displayOrder: z.coerce.number().int().min(0).max(999).default(0),
  isRecurring: z.boolean().default(false),
});

// =============================================================================
// SUPPLIER PAYABLES
// =============================================================================

const payablesQuerySchema = z.object({
  ...pagination,
  search: z.string().trim().max(120).optional(),
  supplierId: id.optional(),
  paymentStatus: settlementStatusEnum.optional(),
  /** Only bills already past their due date. */
  overdueOnly: queryBoolean,
  dueBefore: z.coerce.date().optional(),
  sortBy: z.enum(["dueDate", "purchaseDate", "dueAmount", "totalAmount"]).default("dueDate"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

const recordSupplierPaymentSchema = z.object({
  supplierId: id,
  /** Omit for an on-account payment against the running balance. */
  purchaseId: id.optional(),
  amount: positiveMoney,
  paymentMethod: paymentMethodEnum.default("CASH"),
  referenceNumber: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(1000).optional(),
  paidAt: z.coerce.date().optional(),
});

const setBillDueDateSchema = z.object({
  dueDate: z.coerce.date().nullable(),
});

const supplierPaymentQuerySchema = z.object({
  ...pagination,
  ...periodBlock,
  supplierId: id.optional(),
  purchaseId: id.optional(),
  paymentMethod: paymentMethodEnum.optional(),
  search: z.string().trim().max(120).optional(),
});

// =============================================================================
// PAYROLL
// =============================================================================

const generatePayrollSchema = z.object({
  periodYear: z.coerce.number().int().min(2000).max(2200),
  periodMonth: z.coerce.number().int().min(1).max(12),
  /** Restrict generation to specific employees; omit for everyone eligible. */
  employeeIds: z.array(id).max(500).optional(),
});

const salaryAdjustmentSchema = z.object({
  type: salaryAdjustmentTypeEnum,
  amount: positiveMoney,
  reason: z.string().trim().min(3, "Say what this adjustment is for.").max(300),
});

const paySalarySchema = z.object({
  amount: positiveMoney,
  paymentMethod: paymentMethodEnum.default("CASH"),
  referenceNumber: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(1000).optional(),
  paidAt: z.coerce.date().optional(),
});

const salaryQuerySchema = z.object({
  ...pagination,
  search: z.string().trim().max(120).optional(),
  employeeId: id.optional(),
  periodYear: z.coerce.number().int().min(2000).max(2200).optional(),
  periodMonth: z.coerce.number().int().min(1).max(12).optional(),
  status: salaryStatusEnum.optional(),
});

// =============================================================================
// EXPORTS
// =============================================================================

const financeExportSchema = z.object({
  report: z.enum([
    "expenses",
    "payables",
    "supplier-payments",
    "salaries",
    "profit-loss",
    "cash-flow",
    "revenue",
  ]),
  format: exportFormatEnum.default("csv"),
});

// =============================================================================
// BARREL
// =============================================================================

export const financeValidation = {
  dashboardQuery: dashboardQuerySchema,
  revenueQuery: revenueQuerySchema,
  profitLossQuery: profitLossQuerySchema,
  cashFlowQuery: cashFlowQuerySchema,
  paymentAnalyticsQuery: paymentAnalyticsQuerySchema,

  createExpense: createExpenseSchema,
  updateExpense: updateExpenseSchema,
  reviewExpense: reviewExpenseSchema,
  expenseQuery: expenseQuerySchema,
  createExpenseCategory: createExpenseCategorySchema,

  payablesQuery: payablesQuerySchema,
  recordSupplierPayment: recordSupplierPaymentSchema,
  setBillDueDate: setBillDueDateSchema,
  supplierPaymentQuery: supplierPaymentQuerySchema,

  generatePayroll: generatePayrollSchema,
  salaryAdjustment: salaryAdjustmentSchema,
  paySalary: paySalarySchema,
  salaryQuery: salaryQuerySchema,

  exportQuery: financeExportSchema,
} as const;

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export type RevenueQuery = z.infer<typeof revenueQuerySchema>;
export type ProfitLossQuery = z.infer<typeof profitLossQuerySchema>;
export type CashFlowQuery = z.infer<typeof cashFlowQuerySchema>;
export type PaymentAnalyticsQuery = z.infer<typeof paymentAnalyticsQuerySchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type ReviewExpenseInput = z.infer<typeof reviewExpenseSchema>;
export type ExpenseQuery = z.infer<typeof expenseQuerySchema>;
export type CreateExpenseCategoryInput = z.infer<typeof createExpenseCategorySchema>;
export type PayablesQuery = z.infer<typeof payablesQuerySchema>;
export type RecordSupplierPaymentInput = z.infer<typeof recordSupplierPaymentSchema>;
export type SetBillDueDateInput = z.infer<typeof setBillDueDateSchema>;
export type SupplierPaymentQuery = z.infer<typeof supplierPaymentQuerySchema>;
export type GeneratePayrollInput = z.infer<typeof generatePayrollSchema>;
export type SalaryAdjustmentInput = z.infer<typeof salaryAdjustmentSchema>;
export type PaySalaryInput = z.infer<typeof paySalarySchema>;
export type SalaryQuery = z.infer<typeof salaryQuerySchema>;
export type FinanceExportQuery = z.infer<typeof financeExportSchema>;
