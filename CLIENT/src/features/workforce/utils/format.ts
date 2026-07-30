/**
 * Workforce display helpers.
 *
 * Presentation only — no business rules. The arithmetic that decides whether a
 * day is LATE or how attendance % is computed lives in the server's workforce
 * engine and is never re-derived here; these functions only render values the
 * server already decided.
 */

import type {
  AttendanceStatus,
  EmploymentStatus,
  PresenceStatus,
  SessionStatus,
} from "../types";

/** "7h 45m" / "45m" / "—". Mirrors the server's formatDuration exactly. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** Minutes-from-midnight → "09:00". Shifts are stored this way, not as dates. */
export function formatShiftTime(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "09:00 – 18:00" for a shift window. */
export function formatShiftWindow(start: number, end: number): string {
  return `${formatShiftTime(start)} – ${formatShiftTime(end)}`;
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

/**
 * "just now" / "12m ago" / "3h ago" / a date.
 * Used for the Last Login and Current Activity columns, where the ELAPSED time
 * is what a manager is actually reading — not the wall-clock timestamp.
 */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "Never";

  const then = new Date(iso).getTime();
  const diffMinutes = Math.floor((Date.now() - then) / 60000);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return formatDate(iso);
}

/** Indian-format currency. Matches the rest of the app's money rendering. */
export function formatCurrency(value: number | null | undefined): string {
  const amount = value ?? 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null) return "—";
  return `${value.toFixed(digits)}%`;
}

/** Initials for the avatar fallback when no photo is set. */
export function initials(firstName?: string, lastName?: string): string {
  const a = firstName?.trim()?.[0] ?? "";
  const b = lastName?.trim()?.[0] ?? "";
  return (a + b).toUpperCase() || "?";
}

// =============================================================================
// BADGE VARIANT MAPPINGS
//
// Colocated with the labels they describe so a new status cannot be given a
// label without also being given a colour.
// =============================================================================

type BadgeVariant =
  | "default" | "secondary" | "destructive" | "success"
  | "warning" | "error" | "info" | "outline";

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: "Present",
  LATE: "Late",
  HALF_DAY: "Half Day",
  ABSENT: "Absent",
  ON_LEAVE: "On Leave",
  HOLIDAY: "Holiday",
  WEEK_OFF: "Week Off",
};

export const ATTENDANCE_VARIANTS: Record<AttendanceStatus, BadgeVariant> = {
  PRESENT: "success",
  LATE: "warning",
  HALF_DAY: "warning",
  ABSENT: "error",
  ON_LEAVE: "info",
  HOLIDAY: "secondary",
  WEEK_OFF: "secondary",
};

export const EMPLOYMENT_LABELS: Record<EmploymentStatus, string> = {
  ACTIVE: "Active",
  PROBATION: "Probation",
  ON_LEAVE: "On Leave",
  SUSPENDED: "Suspended",
  TERMINATED: "Terminated",
};

export const EMPLOYMENT_VARIANTS: Record<EmploymentStatus, BadgeVariant> = {
  ACTIVE: "success",
  PROBATION: "info",
  ON_LEAVE: "warning",
  SUSPENDED: "error",
  TERMINATED: "secondary",
};

export const PRESENCE_LABELS: Record<PresenceStatus, string> = {
  ONLINE: "Online",
  OFFLINE: "Offline",
};

export const SESSION_LABELS: Record<SessionStatus, string> = {
  ACTIVE: "Active",
  IDLE: "Idle",
  ENDED: "Ended",
};

export const SESSION_VARIANTS: Record<SessionStatus, BadgeVariant> = {
  ACTIVE: "success",
  IDLE: "warning",
  ENDED: "secondary",
};

/** Timeline dot colour per activity category. Tailwind classes, not hex. */
export const ACTIVITY_COLORS: Record<string, string> = {
  AUTH: "bg-slate-400",
  SALE: "bg-emerald-500",
  INVENTORY: "bg-amber-500",
  CUSTOMER: "bg-blue-500",
  CATALOG: "bg-violet-500",
  PURCHASE: "bg-orange-500",
  LABEL: "bg-cyan-500",
  WORKFORCE: "bg-pink-500",
  OTHER: "bg-muted-foreground",
};

// =============================================================================
// SEVERITY & NOTES
// =============================================================================

export const SEVERITY_LABELS: Record<string, string> = {
  NORMAL: "Normal",
  WARNING: "Warning",
  CRITICAL: "Critical",
};

export const SEVERITY_VARIANTS: Record<string, BadgeVariant> = {
  NORMAL: "secondary",
  WARNING: "warning",
  CRITICAL: "error",
};

/**
 * Left-border accent for a feed row. A critical row must be findable while
 * scrolling, which a badge alone does not achieve — the badge says WHAT, the
 * border is what catches the eye.
 */
export const SEVERITY_ACCENTS: Record<string, string> = {
  NORMAL: "border-l-transparent",
  WARNING: "border-l-amber-500",
  CRITICAL: "border-l-destructive",
};

export const NOTE_CATEGORY_LABELS: Record<string, string> = {
  GENERAL: "General",
  PRAISE: "Excellent Performer",
  TRAINING: "Needs Training",
  PROMOTION: "Promotion Candidate",
  WARNING: "Written Warning",
};

export const NOTE_CATEGORY_VARIANTS: Record<string, BadgeVariant> = {
  GENERAL: "secondary",
  PRAISE: "success",
  TRAINING: "info",
  PROMOTION: "default",
  WARNING: "error",
};

/**
 * Renders a nullable metric that means "not configured" rather than zero.
 *
 * Target achievement and performance score are null when no monthly target is
 * set. Formatting them as "0%" would read as total failure instead of missing
 * configuration, so every call site routes through this helper.
 */
export function formatOptionalPercent(
  value: number | null | undefined,
  digits = 0
): string {
  if (value == null) return "Not set";
  return `${value.toFixed(digits)}%`;
}

/** Same contract as above, for the 0–100 performance score. */
export function formatScore(value: number | null | undefined): string {
  if (value == null) return "Not set";
  return value.toFixed(1);
}

/** Colour band for a performance score. Null renders muted, never red. */
export function scoreAccent(value: number | null | undefined): string {
  if (value == null) return "text-muted-foreground";
  if (value >= 75) return "text-emerald-600 dark:text-emerald-400";
  if (value >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-destructive";
}

/** Human label for an ActionType, for the activity filter dropdown. */
export const ACTIVITY_TYPE_OPTIONS = [
  { value: "", label: "All activity" },
  { value: "LOGIN", label: "Login" },
  { value: "LOGOUT", label: "Logout" },
  { value: "SALE_COMPLETE", label: "Sale Created" },
  { value: "EXCHANGE_COMPLETE", label: "Exchange" },
  { value: "INVENTORY_ADJUST", label: "Inventory Updated" },
  { value: "PURCHASE_RECEIVE", label: "Purchase Received" },
  { value: "CREATE", label: "Created" },
  { value: "UPDATE", label: "Updated" },
  { value: "DELETE", label: "Deleted" },
  { value: "LABEL_PRINT_COMPLETED", label: "Label Printed" },
  { value: "PRINT_INVOICE", label: "Invoice Printed" },
  { value: "PASSWORD_RESET", label: "Password Changed" },
  { value: "ROLE_CHANGED", label: "Role Changed" },
  { value: "CLOCK_IN", label: "Clocked In" },
  { value: "CLOCK_OUT", label: "Clocked Out" },
];
