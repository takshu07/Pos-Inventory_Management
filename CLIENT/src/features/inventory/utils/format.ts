/**
 * Inventory display helpers.
 *
 * Presentation only — no business rules. The arithmetic that decides what
 * counts as LOW_STOCK or DEAD_STOCK lives in the server's inventory engine and
 * is never re-derived here; these functions render values the server already
 * decided.
 *
 * The recurring rule below: a NULL metric renders as an em-dash or an explicit
 * phrase, never as 0. Null means "not applicable" (nothing is selling, no
 * target set); rendering it as zero would read as a real, bad number.
 */

import type {
  AdjustmentReason,
  AdjustmentStatus,
  CycleCountStatus,
  MovementType,
  ReservationStatus,
  ReservationType,
  StockStatus,
  StockVelocity,
} from "../types";

type BadgeVariant =
  | "default" | "secondary" | "destructive" | "success"
  | "warning" | "error" | "info" | "outline";

// =============================================================================
// NUMBERS & MONEY
// =============================================================================

export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

/** Full precision — used where a rounded rupee would hide a real difference. */
export function formatCurrencyExact(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-IN").format(value);
}

export function formatPercent(
  value: number | null | undefined,
  digits = 1
): string {
  if (value == null) return "—";
  return `${value.toFixed(digits)}%`;
}

/**
 * A signed quantity, always showing its sign.
 *
 * The sign IS the information in a ledger — "+12" and "−12" are opposite
 * events, and an unsigned "12" leaves the reader guessing.
 */
export function formatDelta(value: number): string {
  if (value > 0) return `+${formatNumber(value)}`;
  return formatNumber(value);
}

/**
 * Days of cover.
 *
 * NULL means nothing is selling. "∞ days" or a huge number would read as
 * healthy supply when it actually means the item is dead.
 */
export function formatDays(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value < 1) return "< 1 day";
  return `${value.toFixed(value < 10 ? 1 : 0)} days`;
}

// =============================================================================
// DATES
// =============================================================================

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { day: "2-digit", month: "short" })} ${d.toLocaleTimeString(
    undefined,
    { hour: "2-digit", minute: "2-digit" }
  )}`;
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "just now" / "12m ago" / "3d ago". Elapsed time is what a reader wants here. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "Never";

  const diffMinutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return formatDate(iso);
}

// =============================================================================
// STOCK STATUS
// =============================================================================

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  IN_STOCK: "In Stock",
  LOW_STOCK: "Low Stock",
  OUT_OF_STOCK: "Out of Stock",
  NEGATIVE: "Negative",
  OVERSTOCKED: "Overstocked",
};

export const STOCK_STATUS_VARIANTS: Record<StockStatus, BadgeVariant> = {
  IN_STOCK: "success",
  LOW_STOCK: "warning",
  OUT_OF_STOCK: "error",
  // Negative is a DATA problem, not a stock level — destructive rather than
  // error so it reads as "something is broken", not "we sold out".
  NEGATIVE: "destructive",
  OVERSTOCKED: "info",
};

// =============================================================================
// VELOCITY
// =============================================================================

export const VELOCITY_LABELS: Record<StockVelocity, string> = {
  FAST_MOVING: "Fast Moving",
  NORMAL: "Normal",
  SLOW_MOVING: "Slow Moving",
  DEAD_STOCK: "Dead Stock",
};

export const VELOCITY_VARIANTS: Record<StockVelocity, BadgeVariant> = {
  FAST_MOVING: "success",
  NORMAL: "secondary",
  SLOW_MOVING: "warning",
  DEAD_STOCK: "error",
};

// =============================================================================
// MOVEMENTS
// =============================================================================

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  PURCHASE: "Purchase",
  SALE: "Sale",
  EXCHANGE_IN: "Exchange In",
  EXCHANGE_OUT: "Exchange Out",
  SUPPLIER_RETURN: "Supplier Return",
  MANUAL_ADJUSTMENT: "Adjustment",
  DAMAGED: "Damaged",
  LOST: "Lost",
  OPENING_STOCK: "Opening Stock",
};

export const MOVEMENT_VARIANTS: Record<MovementType, BadgeVariant> = {
  PURCHASE: "success",
  SALE: "info",
  EXCHANGE_IN: "success",
  EXCHANGE_OUT: "warning",
  SUPPLIER_RETURN: "warning",
  MANUAL_ADJUSTMENT: "secondary",
  DAMAGED: "error",
  LOST: "error",
  OPENING_STOCK: "outline",
};

/** Dot colour for the movement timeline. Tailwind classes, not hex. */
export const MOVEMENT_COLORS: Record<MovementType, string> = {
  PURCHASE: "bg-emerald-500",
  SALE: "bg-blue-500",
  EXCHANGE_IN: "bg-emerald-400",
  EXCHANGE_OUT: "bg-amber-500",
  SUPPLIER_RETURN: "bg-amber-600",
  MANUAL_ADJUSTMENT: "bg-slate-400",
  DAMAGED: "bg-red-500",
  LOST: "bg-red-600",
  OPENING_STOCK: "bg-violet-500",
};

export const MOVEMENT_TYPE_OPTIONS = [
  { value: "", label: "All movements" },
  { value: "PURCHASE", label: "Purchase" },
  { value: "SALE", label: "Sale" },
  { value: "EXCHANGE_IN", label: "Exchange In" },
  { value: "EXCHANGE_OUT", label: "Exchange Out" },
  { value: "SUPPLIER_RETURN", label: "Supplier Return" },
  { value: "MANUAL_ADJUSTMENT", label: "Adjustment" },
  { value: "DAMAGED", label: "Damaged" },
  { value: "LOST", label: "Lost" },
  { value: "OPENING_STOCK", label: "Opening Stock" },
];

// =============================================================================
// RESERVATIONS
// =============================================================================

export const RESERVATION_TYPE_LABELS: Record<ReservationType, string> = {
  EXCHANGE: "Exchange",
  CUSTOMER_HOLD: "Customer Hold",
  ORDER: "Order",
  OTHER: "Other",
};

export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  ACTIVE: "Active",
  FULFILLED: "Fulfilled",
  RELEASED: "Released",
  EXPIRED: "Expired",
};

export const RESERVATION_STATUS_VARIANTS: Record<ReservationStatus, BadgeVariant> = {
  ACTIVE: "info",
  FULFILLED: "success",
  RELEASED: "secondary",
  EXPIRED: "outline",
};

// =============================================================================
// ADJUSTMENTS
// =============================================================================

export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReason, string> = {
  DAMAGE: "Damage",
  LOST: "Lost",
  THEFT: "Theft",
  MISCOUNT: "Miscount",
  SUPPLIER_ERROR: "Supplier Error",
  SYSTEM_CORRECTION: "System Correction",
  EXPIRED: "Expired",
  OTHER: "Other",
};

export const ADJUSTMENT_REASON_OPTIONS = (
  Object.keys(ADJUSTMENT_REASON_LABELS) as AdjustmentReason[]
).map((value) => ({ value, label: ADJUSTMENT_REASON_LABELS[value] }));

export const ADJUSTMENT_STATUS_LABELS: Record<AdjustmentStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export const ADJUSTMENT_STATUS_VARIANTS: Record<AdjustmentStatus, BadgeVariant> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "secondary",
};

// =============================================================================
// CYCLE COUNTS
// =============================================================================

export const CYCLE_COUNT_STATUS_LABELS: Record<CycleCountStatus, string> = {
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const CYCLE_COUNT_STATUS_VARIANTS: Record<CycleCountStatus, BadgeVariant> = {
  IN_PROGRESS: "info",
  COMPLETED: "success",
  CANCELLED: "secondary",
};

/** Colour band for count accuracy. */
export function accuracyAccent(value: number | null | undefined): string {
  if (value == null) return "text-muted-foreground";
  if (value >= 98) return "text-emerald-600 dark:text-emerald-400";
  if (value >= 95) return "text-amber-600 dark:text-amber-400";
  return "text-destructive";
}

/** Colour band for days-of-cover. Fewer days is more urgent. */
export function coverAccent(days: number | null | undefined): string {
  if (days == null) return "text-muted-foreground";
  if (days <= 3) return "text-destructive";
  if (days <= 7) return "text-amber-600 dark:text-amber-400";
  return "text-foreground";
}

/**
 * Builds a readable variant label.
 *
 * The server sends "Size / Colour", which renders as a bare " / " when both
 * are missing. This collapses that to an em-dash rather than showing punctuation
 * with nothing around it.
 */
export function formatVariantName(name: string | null | undefined): string {
  if (!name) return "—";
  const cleaned = name.replace(/^\s*\/\s*$/, "").trim();
  return cleaned === "" || cleaned === "/" ? "—" : cleaned;
}
