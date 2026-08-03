// =============================================================================
// AUDIT ENGINE — pure derivation over the audit_logs table
//
// WHY THIS EXISTS
// ---------------
// `audit_logs` stores WHAT happened (action, module, tableName, recordId) and a
// pair of JSON snapshots. It does NOT store how much an event MATTERS, and it
// has no severity column. Severity is nonetheless the first question anyone
// asks of an audit trail — "show me the dangerous things" — so it is DERIVED
// here from `action`, deterministically, rather than stored.
//
// Deriving instead of storing is a deliberate trade, and the reasons are:
//   1. Audit WRITES are untouched. Adding a column would mean either changing
//      every writer (out of scope, and risky on the one table that must never
//      lose rows) or shipping a column that is NULL on every existing row —
//      a severity filter that silently matches nothing.
//   2. Severity is a POLICY, not a fact. If "who reprinted a label" stops being
//      interesting, that is one edit here, applied retroactively to all history.
//      A stored column would need a backfill and would leave old rows lying.
//   3. It stays INDEXED. `severityToActions` inverts the map so a severity
//      filter becomes `action IN (...)`, which Postgres serves from the
//      existing indexes. This is the property that makes derivation viable on
//      the largest table in the system — see the note on that function.
//
// Everything in this file is pure: no Prisma, no I/O, no dates-from-now. That
// is what makes the severity policy directly unit-testable, and it is why the
// mapping lives here rather than inline in the service.
// =============================================================================

import type { ActionModule, ActionType } from "../../generated/prisma";

// =============================================================================
// SEVERITY
// =============================================================================

/**
 * Ordered most severe first. The order is meaningful — `SEVERITY_LEVELS` is
 * what the API exposes as the filter's option list, and severity sorting uses
 * `severityRank`.
 */
export const SEVERITY_LEVELS = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

export type AuditSeverity = (typeof SEVERITY_LEVELS)[number];

/**
 * Severity policy, keyed by action.
 *
 * The question each level answers:
 *   CRITICAL — irreversible, or moves money/access. If something went wrong,
 *              this is where you look first. Deletions, cash leaving the
 *              drawer, salary payments, role and password changes (privilege
 *              escalation), and data leaving the system via export.
 *   HIGH     — changes real business state that money or stock depends on:
 *              stock adjustments, purchase receipts, expense approvals,
 *              register open/close/reconcile, deactivating a person.
 *   MEDIUM   — ordinary create/update traffic and completed sales. The bulk of
 *              the table. Meaningful, but not alarming.
 *   LOW      — routine and high-volume: logins, prints, previews, clock
 *              punches. Present for completeness; noise when you are hunting.
 *
 * Actions absent from this map fall back to MEDIUM (see `severityForAction`).
 * MEDIUM rather than LOW is the safe default: a new action type that nobody
 * classified should show up in an unfiltered view, not hide at the bottom.
 */
const SEVERITY_BY_ACTION: Partial<Record<ActionType, AuditSeverity>> = {
  // ── CRITICAL — irreversible, privilege, or money out ──────────────────────
  DELETE: "CRITICAL",
  ROLE_CHANGED: "CRITICAL",
  PERMISSION_CHANGED: "CRITICAL",
  PASSWORD_RESET: "CRITICAL",
  CASH_PAYOUT_RECORDED: "CRITICAL",
  SALARY_PAID: "CRITICAL",
  SALARY_ADJUSTED: "CRITICAL",
  SUPPLIER_PAYMENT_RECORDED: "CRITICAL",
  // Export moves data OUT of the system; the schema already treats it as an
  // event in its own right, and it is the classic exfiltration signal.
  REPORT_EXPORTED: "CRITICAL",

  // ── HIGH — real business state that money or stock depends on ────────────
  EMPLOYEE_DEACTIVATED: "HIGH",
  EMPLOYEE_REACTIVATED: "HIGH",
  INVENTORY_ADJUST: "HIGH",
  PURCHASE_RECEIVE: "HIGH",
  EXCHANGE_COMPLETE: "HIGH",
  EXPENSE_APPROVED: "HIGH",
  EXPENSE_REJECTED: "HIGH",
  REGISTER_OPENED: "HIGH",
  REGISTER_CLOSED: "HIGH",
  REGISTER_RECONCILED: "HIGH",
  CASH_DROP_RECORDED: "HIGH",
  ATTENDANCE_ADJUSTED: "HIGH",
  LEAVE_REVIEWED: "HIGH",

  // ── MEDIUM — ordinary business traffic ──────────────────────────────────
  CREATE: "MEDIUM",
  UPDATE: "MEDIUM",
  SALE_COMPLETE: "MEDIUM",
  SHIFT_ASSIGNED: "MEDIUM",
  LEAVE_REQUESTED: "MEDIUM",
  PRINTER_CHANGED: "MEDIUM",
  LABEL_TEMPLATE_CHANGED: "MEDIUM",
  PRINTER_SETTINGS_CHANGED: "MEDIUM",
  LABEL_PRINT_FAILED: "MEDIUM",

  // ── LOW — routine, high volume ──────────────────────────────────────────
  LOGIN: "LOW",
  LOGOUT: "LOW",
  CLOCK_IN: "LOW",
  CLOCK_OUT: "LOW",
  PRINT_INVOICE: "LOW",
  LABEL_PREVIEW_GENERATED: "LOW",
  LABEL_PDF_GENERATED: "LOW",
  LABEL_PRINT_STARTED: "LOW",
  LABEL_PRINT_COMPLETED: "LOW",
  LABEL_REPRINTED: "LOW",
};

/** Unclassified actions surface as MEDIUM rather than hiding. See above. */
export const DEFAULT_SEVERITY: AuditSeverity = "MEDIUM";

export function severityForAction(action: ActionType): AuditSeverity {
  return SEVERITY_BY_ACTION[action] ?? DEFAULT_SEVERITY;
}

/** Position in `SEVERITY_LEVELS`; 0 is the most severe. */
export function severityRank(severity: AuditSeverity): number {
  return SEVERITY_LEVELS.indexOf(severity);
}

/**
 * Inverts the severity map into the set of actions at a given level — the piece
 * that keeps severity filtering INDEXED.
 *
 * A severity filter is translated by the repository into `action IN (...)`
 * against the enum column, so Postgres can use an index and never has to
 * evaluate a derived expression per row. Filtering by a computed value in SQL
 * (a CASE over every action) would force a sequential scan of the largest table
 * in the system — the exact thing this module must not do.
 *
 * ⚠ The MEDIUM case must include the unclassified actions too, or a MEDIUM
 * filter would silently drop rows whose severity the API itself reports as
 * MEDIUM via the fallback. `allActions` is passed in (rather than imported from
 * the generated enum) to keep this function pure and trivially testable.
 */
export function severityToActions(
  severity: AuditSeverity,
  allActions: readonly ActionType[]
): ActionType[] {
  return allActions.filter((action) => severityForAction(action) === severity);
}

// =============================================================================
// ENTITY LABELS
// =============================================================================

/**
 * Human label for a `tableName`.
 *
 * `tableName` is written by each caller as the raw Postgres table
 * (`@@map`ped, so lowercase plural — "audit_logs", not "AuditLog"). Rendering
 * that verbatim in the UI leaks schema naming at the user, so it is mapped to
 * business language here. Unknown tables are humanised generically rather than
 * dropped: a table added later still reads acceptably without a code change.
 */
const ENTITY_LABELS: Record<string, string> = {
  products: "Product",
  product_variants: "Product Variant",
  categories: "Category",
  brands: "Brand",
  suppliers: "Supplier",
  purchases: "Purchase",
  purchase_items: "Purchase Item",
  sales: "Sale",
  sale_items: "Sale Item",
  exchanges: "Exchange",
  customers: "Customer",
  employees: "Employee",
  discount_rules: "Discount Rule",
  coupons: "Coupon",
  expenses: "Expense",
  settings: "Settings",
  assets: "Asset",
  inventory_movements: "Inventory Movement",
  cash_registers: "Cash Register",
  cash_transactions: "Cash Transaction",
  supplier_payments: "Supplier Payment",
  salaries: "Salary",
  label_templates: "Label Template",
  printers: "Printer",
  print_jobs: "Print Job",
  attendance: "Attendance",
  shifts: "Shift",
  leave_requests: "Leave Request",
  notifications: "Notification",
  audit_logs: "Audit Log",
};

export function entityLabel(tableName: string): string {
  const known = ENTITY_LABELS[tableName];
  if (known) return known;

  // "purchase_items" → "Purchase Items". Better than showing the raw name.
  return tableName
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Title-cased action for display: ROLE_CHANGED → "Role Changed". */
export function actionLabel(action: ActionType): string {
  return action
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

/** Title-cased module for display: CASH_REGISTER → "Cash Register". */
export function moduleLabel(module: ActionModule): string {
  return module
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

// =============================================================================
// FIELD-LEVEL DIFF
// =============================================================================

export interface AuditFieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  /** CREATE has no previous value; DELETE has no next one. */
  changeType: "added" | "removed" | "changed";
}

/**
 * Fields excluded from the rendered diff.
 *
 * `updatedAt` changes on literally every UPDATE and carries no information the
 * row's own `createdAt` does not already give the reader — including it would
 * put a meaningless row at the top of most diffs. The credential fields are
 * already stripped at write time by the repository; they are listed again here
 * so that historical rows written before that stripping existed still cannot
 * render a secret.
 */
const DIFF_IGNORED_FIELDS = new Set([
  "updatedAt",
  "password",
  "refreshTokenVersion",
]);

/**
 * Deep-equality for JSON snapshot values.
 *
 * Snapshots come back from Postgres `json` columns, so values are already plain
 * JSON — no Date, Map, or class instances survive the round trip. That makes
 * key-order-insensitive structural comparison sufficient and cheap, and it
 * avoids reporting `{a:1,b:2}` vs `{b:2,a:1}` as a change, which a naive
 * JSON.stringify comparison would.
 */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;

  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;

  if (aIsArray) {
    const arrA = a as unknown[];
    const arrB = b as unknown[];
    return (
      arrA.length === arrB.length &&
      arrA.every((item, i) => jsonEqual(item, arrB[i]))
    );
  }

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;

  return keysA.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(objB, key) &&
      jsonEqual(objA[key], objB[key])
  );
}

/**
 * Computes the field-level diff between two audit snapshots.
 *
 * Returns ONLY fields that actually differ. An UPDATE row typically snapshots
 * the whole record on both sides, so rendering every field would bury the one
 * that changed — the reason someone opened the entry at all.
 *
 * Both snapshots being present means UPDATE; one side missing means the record
 * was created or deleted, and every field is reported as added/removed so the
 * detail view can show the full picture in those cases.
 *
 * Field order is stable (union of keys, old-snapshot order first) so the same
 * entry renders identically on every view.
 */
export function diffSnapshots(
  oldData: unknown,
  newData: unknown
): AuditFieldChange[] {
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

  const before = isRecord(oldData) ? oldData : null;
  const after = isRecord(newData) ? newData : null;

  if (!before && !after) return [];

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const key of [...Object.keys(before ?? {}), ...Object.keys(after ?? {})]) {
    if (!seen.has(key) && !DIFF_IGNORED_FIELDS.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }

  const changes: AuditFieldChange[] = [];
  for (const field of keys) {
    const hadOld = before ? Object.prototype.hasOwnProperty.call(before, field) : false;
    const hasNew = after ? Object.prototype.hasOwnProperty.call(after, field) : false;
    const oldValue = hadOld ? before![field] : undefined;
    const newValue = hasNew ? after![field] : undefined;

    if (hadOld && hasNew) {
      if (!jsonEqual(oldValue, newValue)) {
        changes.push({ field, oldValue, newValue, changeType: "changed" });
      }
      continue;
    }
    if (hasNew) {
      changes.push({ field, oldValue: undefined, newValue, changeType: "added" });
      continue;
    }
    changes.push({ field, oldValue, newValue: undefined, changeType: "removed" });
  }

  return changes;
}

// =============================================================================
// DATE PERIODS
// =============================================================================

export type AuditPeriod =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "quarter"
  | "year"
  | "all"
  | "custom";

export interface DateRange {
  from: Date | null;
  to: Date | null;
}

/**
 * Resolves a named period to a concrete half-open range [from, to).
 *
 * `now` is injected rather than read from the clock so the boundaries are
 * testable and so a single request cannot straddle midnight between two calls.
 *
 * Half-open is deliberate: `to` is the first instant AFTER the window, which is
 * what makes `createdAt >= from AND createdAt < to` correct without the classic
 * "23:59:59.999" fudge that silently drops the last millisecond of the day.
 *
 * "custom" returns nulls — the caller supplies explicit dates and the service
 * validates them. "all" also returns nulls, meaning no date predicate at all.
 */
export function resolvePeriod(period: AuditPeriod, now: Date): DateRange {
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d: Date, n: number) => {
    const copy = new Date(d);
    copy.setDate(copy.getDate() + n);
    return copy;
  };

  const today = startOfDay(now);

  switch (period) {
    case "today":
      return { from: today, to: addDays(today, 1) };
    case "yesterday":
      return { from: addDays(today, -1), to: today };
    // Rolling windows, not calendar ones: "last 7 days" is what someone
    // investigating an incident means, and it does not collapse to a few hours
    // when they happen to be looking on a Monday morning.
    case "week":
      return { from: addDays(today, -6), to: addDays(today, 1) };
    case "month":
      return { from: addDays(today, -29), to: addDays(today, 1) };
    case "quarter":
      return { from: addDays(today, -89), to: addDays(today, 1) };
    case "year":
      return { from: addDays(today, -364), to: addDays(today, 1) };
    case "all":
    case "custom":
    default:
      return { from: null, to: null };
  }
}
