// =============================================================================
// AUDIT LOG VALIDATION SCHEMAS
//
// Query strings are strings until proven otherwise, so numbers and dates are
// coerced here rather than re-parsed defensively downstream.
//
// The enums are not decoration. `sortBy` and `sortOrder` reach an ORDER BY, and
// `module`/`action` reach a WHERE — enumerating the accepted values is what
// stops a caller-supplied string from ever becoming part of a query. Anything
// outside the enum is a 400, not a silently-ignored filter.
// =============================================================================

import { z } from "zod";

import { SEVERITY_LEVELS } from "../engines/audit.engine";

// =============================================================================
// SHARED
// =============================================================================

/**
 * `limit` is capped at 100.
 *
 * This is the largest table in the system and each row carries an actor join,
 * so an uncapped page size is a denial-of-service surface as much as a
 * performance one. 100 is comfortably more than the 50 the UI offers.
 */
const paginationSchema = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};

/**
 * Mirrors the generated `ActionModule` enum.
 *
 * ⚠ Kept in sync BY A TEST (`audit.engine.test.ts`) rather than by hand — the
 * test compares this list against the Prisma enum, so adding a module to the
 * schema without adding it here fails the suite instead of shipping a filter
 * that 400s on a legitimate value.
 */
export const AUDIT_MODULES = [
  "PRODUCT", "VARIANT", "CATEGORY", "BRAND", "SUPPLIER", "PURCHASE", "SALE",
  "EXCHANGE", "INVENTORY", "CUSTOMER", "EMPLOYEE", "DISCOUNT", "COUPON",
  "EXPENSE", "SETTINGS", "AUTH", "ASSET", "LABEL", "PRINTER", "FINANCE",
  "CASH_REGISTER", "SUPPLIER_PAYMENT", "SALARY", "REPORT",
] as const;

/** Mirrors the generated `ActionType` enum. Kept in sync by the same test. */
export const AUDIT_ACTIONS = [
  "CREATE", "UPDATE", "DELETE", "LOGIN", "LOGOUT", "SALE_COMPLETE",
  "PURCHASE_RECEIVE", "EXCHANGE_COMPLETE", "INVENTORY_ADJUST", "PRINT_INVOICE",
  "LABEL_PREVIEW_GENERATED", "LABEL_PDF_GENERATED", "LABEL_PRINT_STARTED",
  "LABEL_PRINT_COMPLETED", "LABEL_PRINT_FAILED", "LABEL_REPRINTED",
  "PRINTER_CHANGED", "LABEL_TEMPLATE_CHANGED", "PRINTER_SETTINGS_CHANGED",
  "PASSWORD_RESET", "ROLE_CHANGED", "PERMISSION_CHANGED",
  "EMPLOYEE_DEACTIVATED", "EMPLOYEE_REACTIVATED", "CLOCK_IN", "CLOCK_OUT",
  "ATTENDANCE_ADJUSTED", "SHIFT_ASSIGNED", "LEAVE_REQUESTED", "LEAVE_REVIEWED",
  "REGISTER_OPENED", "REGISTER_CLOSED", "REGISTER_RECONCILED",
  "CASH_DROP_RECORDED", "CASH_PAYOUT_RECORDED", "EXPENSE_APPROVED",
  "EXPENSE_REJECTED", "SUPPLIER_PAYMENT_RECORDED", "SALARY_PAID",
  "SALARY_ADJUSTED", "REPORT_EXPORTED",
] as const;

const moduleEnum = z.enum(AUDIT_MODULES);
const actionEnum = z.enum(AUDIT_ACTIONS);
const severityEnum = z.enum(SEVERITY_LEVELS);

const periodEnum = z
  .enum(["today", "yesterday", "week", "month", "quarter", "year", "all", "custom"])
  .default("month");

/**
 * Only two sort keys are offered, and both are indexed.
 *
 * `createdAt` is the audit trail's natural order. `severity` is NOT a column —
 * the service sorts by it via the action-set mapping. Offering `employee` or
 * `module` would mean an unindexed sort over the largest table for a view
 * nobody reads that way; filtering answers those questions better.
 */
const sortByEnum = z.enum(["createdAt", "severity"]).default("createdAt");
const sortOrderEnum = z.enum(["asc", "desc"]).default("desc");

/**
 * Accepts a comma-separated list OR a repeated query param, and normalises both
 * to an array.
 *
 * `?module=SALE,INVENTORY` and `?module=SALE&module=INVENTORY` are both natural
 * things for a client to send; supporting one and silently ignoring the other
 * is the kind of asymmetry that produces "the filter doesn't work" bugs.
 */
function multiValue<T extends readonly [string, ...string[]]>(values: T) {
  const inner = z.enum(values);
  return z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((raw) => {
      if (raw === undefined) return undefined;
      const parts = (Array.isArray(raw) ? raw : raw.split(","))
        .map((part) => part.trim())
        .filter(Boolean);
      return parts.length > 0 ? parts : undefined;
    })
    .pipe(z.array(inner).min(1).optional());
}

// =============================================================================
// LIST QUERY
// =============================================================================

/**
 * `search` is capped at 100 characters and trimmed.
 *
 * It is matched against `recordId` and the actor's name/email — NOT against the
 * JSON snapshots. Searching inside `oldData`/`newData` would require a
 * sequential scan with a JSON cast on every row of the biggest table, and it is
 * the single easiest way to take this screen (and the database) down. The
 * detail view is where snapshot contents are read.
 */
const listQuerySchema = z
  .object({
    ...paginationSchema,
    search: z.string().trim().max(100).optional(),
    module: multiValue(AUDIT_MODULES),
    action: multiValue(AUDIT_ACTIONS),
    severity: multiValue(SEVERITY_LEVELS),
    employeeId: z.string().trim().min(1).max(50).optional(),
    tableName: z.string().trim().min(1).max(64).optional(),
    recordId: z.string().trim().min(1).max(50).optional(),
    period: periodEnum,
    // Explicit range. Only consulted when period = "custom", so that a stale
    // date in the URL cannot quietly override a named period.
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    sortBy: sortByEnum,
    sortOrder: sortOrderEnum,
  })
  .refine(
    (query) => query.period !== "custom" || (query.from != null && query.to != null),
    {
      message: "A custom period requires both 'from' and 'to'.",
      path: ["period"],
    }
  )
  .refine(
    (query) => query.from == null || query.to == null || query.from <= query.to,
    { message: "'from' must be on or before 'to'.", path: ["from"] }
  );

/** Detail lookup — the id itself is validated by validateParam middleware. */
const relatedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

/** Summary strip: same filters as the list, minus paging and sorting. */
const summaryQuerySchema = z
  .object({
    module: multiValue(AUDIT_MODULES),
    action: multiValue(AUDIT_ACTIONS),
    severity: multiValue(SEVERITY_LEVELS),
    employeeId: z.string().trim().min(1).max(50).optional(),
    period: periodEnum,
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine(
    (query) => query.period !== "custom" || (query.from != null && query.to != null),
    { message: "A custom period requires both 'from' and 'to'.", path: ["period"] }
  );

export type AuditListQuery = z.infer<typeof listQuerySchema>;
export type AuditRelatedQuery = z.infer<typeof relatedQuerySchema>;
export type AuditSummaryQuery = z.infer<typeof summaryQuerySchema>;

export const auditValidation = {
  listQuery: listQuerySchema,
  relatedQuery: relatedQuerySchema,
  summaryQuery: summaryQuerySchema,
} as const;
