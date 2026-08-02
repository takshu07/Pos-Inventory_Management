/**
 * Business-intelligence display helpers.
 *
 * PRESENTATION ONLY. Every derived number — margin, growth, return rate,
 * settlement status — is computed by the server's finance engine and rendered
 * here as-is. Re-deriving any of them on the client is how two screens end up
 * disagreeing about the same month.
 *
 * The recurring rule: NULL renders as an em-dash or an explicit phrase, never
 * as 0. Null means "not applicable" (no target set, nothing sold, shift still
 * open); rendering it as zero reads as a real — and usually alarming — number.
 */

type BadgeVariant =
  | "default" | "secondary" | "destructive" | "success"
  | "warning" | "error" | "info" | "outline";

// =============================================================================
// MONEY
// =============================================================================

/** Rupees, no paise. The default for KPI cards and chart axes. */
export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

/** Full precision. Used wherever a rounded rupee would hide a real difference —
 *  a drawer variance of ₹0.50 must not render as ₹1. */
export function formatCurrencyExact(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Abbreviated money for tight spaces (chart axes, sparkline tooltips).
 * Uses the Indian lakh/crore scale, because "₹1.2Cr" is what a shop owner
 * reads instantly and "₹12M" is not.
 */
export function formatCurrencyCompact(value: number | null | undefined): string {
  if (value == null) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(2)}L`;
  if (abs >= 1_000) return `${sign}₹${(abs / 1_000).toFixed(1)}K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

/** Signed money, for variances. Always shows the sign, including on zero-cross. */
export function formatSignedCurrency(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value === 0) return formatCurrencyExact(0);
  return `${value > 0 ? "+" : "−"}${formatCurrencyExact(Math.abs(value))}`;
}

// =============================================================================
// NUMBERS
// =============================================================================

export function formatNumber(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-IN").format(value);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null) return "—";
  return `${value.toFixed(digits)}%`;
}

/** Signed percentage, for growth indicators. */
export function formatSignedPercent(value: number | null | undefined, digits = 1): string {
  if (value == null) return "—";
  if (value === 0) return "0%";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}%`;
}

export function formatCompactNumber(value: number | null | undefined): string {
  if (value == null) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_00_00_000) return `${(value / 1_00_00_000).toFixed(1)}Cr`;
  if (abs >= 1_00_000) return `${(value / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

// =============================================================================
// DATES
// =============================================================================

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

/** "8h 24m" / "48m" — mirrors the server's formatDuration exactly. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

/**
 * Renders a time-series bucket key for an axis label.
 *
 * The key is an ISO date; how it should READ depends on the bucket size —
 * "30 Jul" for days, "Jul 2026" for months. Showing a full date on a monthly
 * chart implies a precision the bucket does not have.
 */
export function formatBucket(
  bucket: string,
  granularity: "day" | "week" | "month" | "year"
): string {
  const d = new Date(bucket);
  if (Number.isNaN(d.getTime())) return bucket;

  switch (granularity) {
    case "year":
      return String(d.getFullYear());
    case "month":
      return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
    case "week":
      return `w/c ${d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`;
    case "day":
    default:
      return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  }
}

// =============================================================================
// STATUS VOCABULARY
//
// One mapping per status enum, used by every screen. A status can never be
// rendered with an ad-hoc colour that contradicts another page — "Overdue"
// must look identical on the payables table, the dashboard and the export.
// =============================================================================

export const REGISTER_STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  CLOSED: "Closed",
  RECONCILED: "Reconciled",
};

export const REGISTER_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  OPEN: "success",
  CLOSED: "secondary",
  RECONCILED: "info",
};

export const APPROVAL_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export const APPROVAL_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "error",
};

export const SETTLEMENT_STATUS_LABELS: Record<string, string> = {
  UNPAID: "Unpaid",
  PARTIALLY_PAID: "Part paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  CANCELLED: "Cancelled",
};

export const SETTLEMENT_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  UNPAID: "secondary",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  OVERDUE: "error",
  CANCELLED: "outline",
};

export const SALARY_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  PARTIALLY_PAID: "Part paid",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

export const SALARY_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  PENDING: "warning",
  PARTIALLY_PAID: "info",
  PAID: "success",
  CANCELLED: "outline",
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  CREDIT: "Credit",
  GIFT_CARD: "Gift Card",
  OTHER: "Other",
};

export const PAYOUT_CATEGORY_LABELS: Record<string, string> = {
  TEA: "Tea & Refreshments",
  COURIER: "Courier",
  PACKAGING: "Packaging",
  CLEANING: "Cleaning",
  TRANSPORT: "Transport",
  STATIONERY: "Stationery",
  MAINTENANCE: "Maintenance",
  UTILITIES: "Utilities",
  STAFF_WELFARE: "Staff Welfare",
  MISCELLANEOUS: "Miscellaneous",
};

export const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  OPENED: "Register opened",
  SALE: "Sale",
  REFUND: "Refund",
  EXCHANGE: "Exchange",
  CASH_DROP: "Cash drop",
  CASH_PAYOUT: "Payout",
  EXPENSE: "Expense",
  ADJUSTMENT: "Adjustment",
  NOTE: "Note",
  CLOSED: "Register closed",
  RECONCILED: "Reconciled",
};

export const ACTIVITY_TYPE_VARIANTS: Record<string, BadgeVariant> = {
  OPENED: "success",
  SALE: "info",
  REFUND: "warning",
  EXCHANGE: "warning",
  CASH_DROP: "secondary",
  CASH_PAYOUT: "secondary",
  EXPENSE: "secondary",
  ADJUSTMENT: "destructive",
  NOTE: "outline",
  CLOSED: "secondary",
  RECONCILED: "info",
};

export const AGEING_LABELS: Record<string, string> = {
  CURRENT: "Current",
  "0_30": "1–30 days",
  "31_60": "31–60 days",
  "61_90": "61–90 days",
  "90_PLUS": "90+ days",
};

export const AGEING_VARIANTS: Record<string, BadgeVariant> = {
  CURRENT: "secondary",
  "0_30": "warning",
  "31_60": "warning",
  "61_90": "error",
  "90_PLUS": "destructive",
};

export const SALARY_ADJUSTMENT_LABELS: Record<string, string> = {
  ADVANCE: "Advance",
  BONUS: "Bonus",
  OVERTIME: "Overtime",
  INCENTIVE: "Incentive",
  DEDUCTION: "Deduction",
  REIMBURSEMENT: "Reimbursement",
};

/** Whether an adjustment increases or decreases the net payable. */
export const SALARY_ADJUSTMENT_SIGN: Record<string, 1 | -1> = {
  ADVANCE: -1,
  BONUS: 1,
  OVERTIME: 1,
  INCENTIVE: 1,
  DEDUCTION: -1,
  REIMBURSEMENT: 1,
};

/** Turns SNAKE_CASE into "Snake case" for enums with no explicit label. */
export function humanise(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .split("_")
    .map((w, i) => (i === 0 ? w.charAt(0) + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(" ");
}

// =============================================================================
// DRAWER VARIANCE
// =============================================================================

export type VarianceKind = "BALANCED" | "OVER" | "SHORT";

export function varianceKind(difference: number | null | undefined): VarianceKind | null {
  if (difference == null) return null;
  if (difference === 0) return "BALANCED";
  return difference > 0 ? "OVER" : "SHORT";
}

export function varianceLabel(difference: number | null | undefined): string {
  const kind = varianceKind(difference);
  if (kind === null) return "Shift still open";
  if (kind === "BALANCED") return "Balanced";
  return kind === "OVER"
    ? `Over by ${formatCurrencyExact(Math.abs(difference!))}`
    : `Short by ${formatCurrencyExact(Math.abs(difference!))}`;
}

export const VARIANCE_VARIANTS: Record<VarianceKind, BadgeVariant> = {
  BALANCED: "success",
  OVER: "info",
  SHORT: "error",
};
