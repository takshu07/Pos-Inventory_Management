// =============================================================================
// WORKFORCE ENGINE
//
// The pure-computation core of the Workforce Management module. Everything in
// this file is a deterministic function of its arguments: no Prisma, no HTTP,
// no clock reads except the ones explicitly passed in. That is what makes the
// attendance/presence rules unit-testable and keeps the same arithmetic from
// being re-implemented in three services and again on the client.
//
// Responsibilities:
//   1. Attendance arithmetic — worked/late/early/overtime minutes, day status.
//   2. Presence derivation — online/offline from real sessions, never a
//      mutable boolean that desyncs when a process dies.
//   3. The permission matrix — the single source of truth for what each role
//      may do in this module, consumed by BOTH the route guards and the
//      read-only Permissions tab so they can never disagree.
//   4. Activity descriptions — turning an EmployeeAction row into timeline text.
//
// What does NOT belong here: database access (repository), request handling
// (controller), or orchestration across repositories (service).
// =============================================================================

import type {
  ActionType,
  ActionModule,
  AttendanceStatus,
  EmployeeRole,
} from "../../generated/prisma";

// =============================================================================
// TIME PRIMITIVES
//
// A shift is a recurring WALL-CLOCK rule, not an instant, so it is stored as
// minutes-from-midnight. Converting an instant into store-local minutes is the
// only place timezone handling lives.
// =============================================================================

/** Milliseconds in one minute — named so the arithmetic below reads as intent. */
const MS_PER_MINUTE = 60_000;

/**
 * A session counts as "online" if its last heartbeat is within this window.
 * Chosen to be comfortably longer than the client's heartbeat interval so a
 * single dropped request never flickers an employee offline.
 */
export const PRESENCE_THRESHOLD_MINUTES = 5;

/**
 * Returns the store-local wall-clock minutes-from-midnight for an instant.
 *
 * Uses Intl rather than manual offset arithmetic because only the IANA database
 * knows whether a given date was in DST. `en-GB` + hour12:false is the one
 * locale/option pair that reliably yields 24-hour "HH:MM".
 */
export function toStoreMinutes(instant: Date, timeZone: string): number {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);

  const [hoursPart, minutesPart] = formatted.split(":");
  const hours = Number(hoursPart);
  // 24:00 is a legal en-GB rendering of midnight; normalise it to 0.
  return (hours === 24 ? 0 : hours) * 60 + Number(minutesPart);
}

/**
 * Normalises an instant to the UTC-midnight DATE of the store-local calendar
 * day it falls in. This is the value written to `attendance.date`.
 *
 * Storing the store-local date (rather than the UTC date) is what makes
 * "one attendance row per employee per day" mean what a human means by "day".
 * A 23:30 IST clock-in belongs to that day, not to the next UTC one.
 */
export function toStoreDate(instant: Date, timeZone: string): Date {
  // en-CA yields ISO-ordered YYYY-MM-DD, which needs no reassembly.
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);

  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Day-of-week (0=Sunday) for an instant in the store's timezone. */
export function toStoreWeekday(instant: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(instant);

  const days: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return days[name] ?? 0;
}

/** Formats minutes-from-midnight as "HH:MM" for display. */
export function formatShiftTime(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// =============================================================================
// ATTENDANCE ARITHMETIC
// =============================================================================

/**
 * The subset of a Shift the arithmetic needs. Taking a structural type rather
 * than the Prisma model keeps this engine free of ORM coupling and lets a
 * caller pass a historical SNAPSHOT of a shift instead of the live row.
 */
export interface ShiftWindow {
  startMinute: number;
  endMinute: number;
  breakMinutes: number;
  graceMinutes: number;
  expectedMinutes: number;
}

export interface AttendanceComputation {
  workedMinutes: number;
  lateMinutes: number;
  earlyExitMinutes: number;
  overtimeMinutes: number;
  status: AttendanceStatus;
}

/**
 * Length of a shift in minutes, handling the overnight case.
 *
 * An overnight shift (22:00 → 06:00) has endMinute <= startMinute. Adding a
 * full day to the end is what makes the subtraction correct rather than
 * negative, and is the only special case the whole module needs.
 */
export function shiftDurationMinutes(shift: ShiftWindow): number {
  const end = shift.endMinute <= shift.startMinute
    ? shift.endMinute + 1440
    : shift.endMinute;
  return end - shift.startMinute;
}

/**
 * Computes a day's attendance figures from the punches and the shift that
 * applied. Called at clock-out and by manual adjustment; the result is STORED,
 * never recomputed on read, so a later change to the shift definition cannot
 * silently rewrite history.
 *
 * `halfDayThreshold` is the fraction of expected minutes below which a present
 * day is downgraded to HALF_DAY.
 */
export function computeAttendance(params: {
  clockInAt: Date;
  clockOutAt: Date | null;
  shift: ShiftWindow | null;
  timeZone: string;
  halfDayThreshold?: number;
}): AttendanceComputation {
  const { clockInAt, clockOutAt, shift, timeZone } = params;
  const halfDayThreshold = params.halfDayThreshold ?? 0.5;

  // Still clocked in: the day is in progress. Worked minutes are reported as
  // elapsed-so-far, but late is already knowable and worth surfacing live.
  const effectiveOut = clockOutAt ?? new Date();

  const rawMinutes = Math.max(
    0,
    Math.round((effectiveOut.getTime() - clockInAt.getTime()) / MS_PER_MINUTE)
  );

  if (!shift) {
    // No shift assigned — we can measure hours but cannot judge them.
    return {
      workedMinutes: rawMinutes,
      lateMinutes: 0,
      earlyExitMinutes: 0,
      overtimeMinutes: 0,
      status: clockOutAt ? "PRESENT" : "PRESENT",
    };
  }

  const workedMinutes = Math.max(0, rawMinutes - shift.breakMinutes);

  const inMinute = toStoreMinutes(clockInAt, timeZone);
  const outMinute = toStoreMinutes(effectiveOut, timeZone);

  // ── Late ──────────────────────────────────────────────────────────────────
  // Grace is a hard threshold, not a discount: arriving 11 minutes into a
  // 10-minute grace is 11 minutes late, not 1. That matches how retail
  // managers actually read the number.
  const minutesAfterStart = inMinute - shift.startMinute;
  const lateMinutes =
    minutesAfterStart > shift.graceMinutes ? minutesAfterStart : 0;

  // ── Early exit / overtime ─────────────────────────────────────────────────
  // Only meaningful once the day is closed; an in-progress day is neither.
  let earlyExitMinutes = 0;
  let overtimeMinutes = 0;

  if (clockOutAt) {
    const shiftEnd = shift.endMinute <= shift.startMinute
      ? shift.endMinute + 1440
      : shift.endMinute;
    const normalizedOut = outMinute < inMinute ? outMinute + 1440 : outMinute;

    if (normalizedOut < shiftEnd) {
      earlyExitMinutes = shiftEnd - normalizedOut;
    } else if (normalizedOut > shiftEnd) {
      overtimeMinutes = normalizedOut - shiftEnd;
    }
  }

  // ── Day status ────────────────────────────────────────────────────────────
  let status: AttendanceStatus = "PRESENT";
  if (clockOutAt && workedMinutes < shift.expectedMinutes * halfDayThreshold) {
    status = "HALF_DAY";
  } else if (lateMinutes > 0) {
    status = "LATE";
  }

  return { workedMinutes, lateMinutes, earlyExitMinutes, overtimeMinutes, status };
}

/**
 * Attendance percentage over a period.
 *
 * HALF_DAY counts as 0.5 rather than 0 or 1 — treating a half day as a full
 * absence overstates the problem, and as a full presence hides it. WEEK_OFF and
 * HOLIDAY are excluded from the denominator entirely: an employee cannot be
 * penalised for a day nobody was scheduled to work.
 */
export function attendancePercentage(
  counts: Partial<Record<AttendanceStatus, number>>
): number {
  const present = counts.PRESENT ?? 0;
  const late = counts.LATE ?? 0;
  const half = counts.HALF_DAY ?? 0;
  const absent = counts.ABSENT ?? 0;
  const onLeave = counts.ON_LEAVE ?? 0;

  const credited = present + late + half * 0.5;
  const scheduled = present + late + half + absent + onLeave;

  if (scheduled === 0) return 0;
  return Math.round((credited / scheduled) * 1000) / 10;
}

/** Renders minutes as "7h 45m" / "45m" for the UI. */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

// =============================================================================
// BREAK TRACKING
//
// A break is a pair of instants, not a stored "on break" boolean. `openedAt`
// being non-null IS the open state, which is what makes it self-correcting when
// a process dies mid-break — exactly the same reasoning as presence below.
// =============================================================================

/**
 * Elapsed minutes of an OPEN break, or 0 if no break is open.
 * Used to show a live "on break for 12m" without writing to the row.
 */
export function openBreakMinutes(
  breakStartedAt: Date | null | undefined,
  now: Date = new Date()
): number {
  if (!breakStartedAt) return 0;
  return Math.max(0, Math.round((now.getTime() - breakStartedAt.getTime()) / MS_PER_MINUTE));
}

/**
 * Total break minutes to store when a break closes: whatever was already
 * accumulated plus this break's elapsed time. Additive so an employee may take
 * several breaks in a day without any of them being lost.
 */
export function closeBreak(params: {
  accumulatedMinutes: number;
  breakStartedAt: Date;
  at?: Date;
}): number {
  const at = params.at ?? new Date();
  return params.accumulatedMinutes + openBreakMinutes(params.breakStartedAt, at);
}

// =============================================================================
// PERFORMANCE SCORE & TARGET ACHIEVEMENT
//
// The weighting below was chosen explicitly by the business owner (balanced
// 40/30/15/15), not defaulted. It is stated once here and consumed by both the
// leaderboard and the drawer, so the number can never differ between the two
// screens that show it.
// =============================================================================

/** The agreed weights. Exported so the UI can explain the score it renders. */
export const PERFORMANCE_WEIGHTS = {
  revenue: 40,
  attendance: 30,
  returns: 15,
  discount: 15,
} as const;

export interface PerformanceScoreInput {
  /** Revenue earned in the period. */
  revenue: number;
  /**
   * Target for the SAME period (already pro-rated by the caller). NULL means no
   * target is configured — see below for why that is not treated as zero.
   */
  target: number | null;
  /** 0–100, from attendancePercentage(). */
  attendancePercentage: number;
  /** Returns ÷ transactions, 0–1. */
  returnRate: number;
  /** Discount ÷ gross, 0–1. */
  discountRate: number;
}

export interface PerformanceScore {
  /** 0–100, or null when it cannot be computed honestly. */
  score: number | null;
  /** Per-term contribution, so the UI can show WHY a score is what it is. */
  breakdown: {
    revenue: number;
    attendance: number;
    returns: number;
    discount: number;
  } | null;
  /** Set when score is null, explaining what is missing. */
  unavailableReason?: "NO_TARGET";
}

/** Clamps to [0,1]. Guards every ratio below against dirty data. */
function unitClamp(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value > 1 ? 1 : value;
}

/**
 * The composite performance score: 40% revenue attainment, 30% attendance,
 * 15% low-return-rate, 15% low-discount-rate.
 *
 * Returns null when the employee has NO TARGET SET rather than scoring the
 * revenue term as zero. Scoring it zero would silently rank an unconfigured
 * employee below a genuinely poor performer — a data-entry gap must never look
 * like a performance finding.
 */
export function performanceScore(input: PerformanceScoreInput): PerformanceScore {
  if (input.target === null || input.target <= 0) {
    return { score: null, breakdown: null, unavailableReason: "NO_TARGET" };
  }

  // Attainment is capped at 1: beating target by 300% must not let one employee
  // mathematically dominate every other term combined.
  const attainment = unitClamp(input.revenue / input.target);

  const breakdown = {
    revenue: PERFORMANCE_WEIGHTS.revenue * attainment,
    attendance: PERFORMANCE_WEIGHTS.attendance * unitClamp(input.attendancePercentage / 100),
    returns: PERFORMANCE_WEIGHTS.returns * (1 - unitClamp(input.returnRate)),
    discount: PERFORMANCE_WEIGHTS.discount * (1 - unitClamp(input.discountRate)),
  };

  const total =
    breakdown.revenue + breakdown.attendance + breakdown.returns + breakdown.discount;

  return {
    score: Math.round(total * 10) / 10,
    breakdown: {
      revenue: Math.round(breakdown.revenue * 10) / 10,
      attendance: Math.round(breakdown.attendance * 10) / 10,
      returns: Math.round(breakdown.returns * 10) / 10,
      discount: Math.round(breakdown.discount * 10) / 10,
    },
  };
}

/**
 * Pro-rates a MONTHLY target onto an arbitrary reporting window.
 *
 * Comparing a week's revenue against a full month's target would make everyone
 * look like they are failing; scaling by days is what makes "78% of target"
 * mean the same thing on every period the UI offers.
 */
export function prorateMonthlyTarget(
  monthlyTarget: number | null,
  windowFrom: Date,
  windowTo: Date,
  daysPerMonth = 30
): number | null {
  if (monthlyTarget === null || monthlyTarget <= 0) return null;

  const spanDays = Math.max(
    1,
    Math.ceil((windowTo.getTime() - windowFrom.getTime()) / (24 * 60 * MS_PER_MINUTE))
  );

  return (monthlyTarget / daysPerMonth) * spanDays;
}

/**
 * Target achievement as a percentage. NULL (not 0) when no target is set —
 * the UI must render "Not set", never "0%".
 */
export function targetAchievement(
  revenue: number,
  proratedTarget: number | null
): number | null {
  if (proratedTarget === null || proratedTarget <= 0) return null;
  return Math.round((revenue / proratedTarget) * 1000) / 10;
}

// =============================================================================
// PRESENCE
//
// Derived from LoginHistory rather than stored on Employee. A boolean column
// would desync the moment a process is killed, a tab is closed, or a token
// expires — and would then need a reaper job to fix. An open session with a
// stale heartbeat is self-correcting: it simply stops counting as online.
// =============================================================================

export type PresenceStatus = "ONLINE" | "OFFLINE";

export interface SessionSnapshot {
  loginAt: Date;
  logoutAt: Date | null;
  lastSeenAt: Date | null;
}

export function derivePresence(
  session: SessionSnapshot | null | undefined,
  now: Date = new Date(),
  thresholdMinutes: number = PRESENCE_THRESHOLD_MINUTES
): PresenceStatus {
  if (!session || session.logoutAt) return "OFFLINE";

  // A session with no heartbeat yet falls back to its login instant, so a user
  // who just logged in reads as online before their first heartbeat lands.
  const lastActivity = session.lastSeenAt ?? session.loginAt;
  const ageMinutes = (now.getTime() - lastActivity.getTime()) / MS_PER_MINUTE;

  return ageMinutes <= thresholdMinutes ? "ONLINE" : "OFFLINE";
}

/**
 * Operating system from a UA string, for the security dashboard's OS column.
 *
 * Lives here beside the other pure derivations rather than in the service, so
 * the same string always yields the same answer no matter who parses it. Order
 * matters: Android UAs also contain "Linux", and iPadOS contains "Mac OS X".
 */
export function parseOperatingSystem(ua: string | null | undefined): string | null {
  if (!ua) return null;

  if (/Windows NT/i.test(ua)) return "Windows";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
  if (/CrOS/i.test(ua)) return "ChromeOS";
  if (/Linux/i.test(ua)) return "Linux";

  return "Unknown";
}

/** Session length in whole minutes; null while the session is still open. */
export function sessionDurationMinutes(
  loginAt: Date,
  logoutAt: Date | null
): number | null {
  if (!logoutAt) return null;
  return Math.max(0, Math.round((logoutAt.getTime() - loginAt.getTime()) / MS_PER_MINUTE));
}

// =============================================================================
// PERMISSION MATRIX
//
// THE single source of truth for what each role may do in this module. The
// route guards and the drawer's read-only Permissions tab both read from here,
// which is what stops the UI from ever claiming a permission the API denies.
//
// Adding a future module (Payroll, Documents) is one entry in this object plus
// its route guard — no redesign.
// =============================================================================

export const WORKFORCE_PERMISSION_MODULES = [
  "products",
  "customers",
  "inventory",
  "purchases",
  "reports",
  "discounts",
  "employeeManagement",
  "settings",
] as const;

export type WorkforcePermissionModule =
  (typeof WORKFORCE_PERMISSION_MODULES)[number];

export interface PermissionGrant {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
}

const NONE: PermissionGrant = { view: false, create: false, edit: false, delete: false };
const READ: PermissionGrant = { view: true, create: false, edit: false, delete: false };
const FULL: PermissionGrant = { view: true, create: true, edit: true, delete: true };

/**
 * Role → module → grant. Mirrors the RBAC actually enforced by the route
 * guards (`requireRole`) and the owner/manager route split in app.ts.
 */
export const PERMISSION_MATRIX: Record<
  EmployeeRole,
  Record<WorkforcePermissionModule, PermissionGrant>
> = {
  OWNER: {
    products: FULL,
    customers: FULL,
    inventory: FULL,
    purchases: FULL,
    reports: FULL,
    discounts: FULL,
    employeeManagement: FULL,
    settings: FULL,
  },
  MANAGER: {
    // Managers are OPERATIONAL: they run the floor and observe the rest.
    products: READ,
    customers: { view: true, create: true, edit: true, delete: false },
    inventory: READ,
    purchases: NONE,
    reports: READ,
    discounts: NONE,
    employeeManagement: READ,
    settings: NONE,
  },
  CASHIER: {
    products: READ,
    customers: { view: true, create: true, edit: false, delete: false },
    inventory: NONE,
    purchases: NONE,
    reports: NONE,
    discounts: NONE,
    employeeManagement: NONE,
    settings: NONE,
  },
};

/** Human labels for the Permissions tab, kept beside the matrix they describe. */
export const PERMISSION_MODULE_LABELS: Record<WorkforcePermissionModule, string> = {
  products: "Products",
  customers: "Customers",
  inventory: "Inventory",
  purchases: "Purchases",
  reports: "Reports",
  discounts: "Discounts",
  employeeManagement: "Employee Management",
  settings: "Settings",
};

export function permissionsForRole(role: EmployeeRole) {
  return WORKFORCE_PERMISSION_MODULES.map((module) => ({
    module,
    label: PERMISSION_MODULE_LABELS[module],
    ...PERMISSION_MATRIX[role][module],
  }));
}

// =============================================================================
// ACTIVITY TIMELINE
//
// Turns an EmployeeAction row into timeline text. Reusing the existing audit
// records (rather than writing a parallel activity table) is a hard requirement
// of this module; this function is the presentation half of that reuse.
// =============================================================================

/**
 * Coarse category used by the UI to colour/group a timeline entry. Deliberately
 * small — the timeline should read at a glance, not encode 30 distinct hues.
 */
export type ActivityCategory =
  | "AUTH"
  | "SALE"
  | "INVENTORY"
  | "CUSTOMER"
  | "CATALOG"
  | "PURCHASE"
  | "LABEL"
  | "WORKFORCE"
  | "OTHER";

const ACTION_CATEGORY: Partial<Record<ActionType, ActivityCategory>> = {
  LOGIN: "AUTH",
  LOGOUT: "AUTH",
  PASSWORD_RESET: "AUTH",
  SALE_COMPLETE: "SALE",
  EXCHANGE_COMPLETE: "SALE",
  PRINT_INVOICE: "SALE",
  INVENTORY_ADJUST: "INVENTORY",
  PURCHASE_RECEIVE: "PURCHASE",
  LABEL_PREVIEW_GENERATED: "LABEL",
  LABEL_PDF_GENERATED: "LABEL",
  LABEL_PRINT_STARTED: "LABEL",
  LABEL_PRINT_COMPLETED: "LABEL",
  LABEL_PRINT_FAILED: "LABEL",
  LABEL_REPRINTED: "LABEL",
  PRINTER_CHANGED: "LABEL",
  LABEL_TEMPLATE_CHANGED: "LABEL",
  PRINTER_SETTINGS_CHANGED: "LABEL",
  CLOCK_IN: "WORKFORCE",
  CLOCK_OUT: "WORKFORCE",
  ATTENDANCE_ADJUSTED: "WORKFORCE",
  SHIFT_ASSIGNED: "WORKFORCE",
  LEAVE_REQUESTED: "WORKFORCE",
  LEAVE_REVIEWED: "WORKFORCE",
  ROLE_CHANGED: "WORKFORCE",
  PERMISSION_CHANGED: "WORKFORCE",
  EMPLOYEE_DEACTIVATED: "WORKFORCE",
  EMPLOYEE_REACTIVATED: "WORKFORCE",
};

const MODULE_CATEGORY: Partial<Record<ActionModule, ActivityCategory>> = {
  SALE: "SALE",
  EXCHANGE: "SALE",
  INVENTORY: "INVENTORY",
  CUSTOMER: "CUSTOMER",
  PRODUCT: "CATALOG",
  VARIANT: "CATALOG",
  CATEGORY: "CATALOG",
  BRAND: "CATALOG",
  DISCOUNT: "CATALOG",
  COUPON: "CATALOG",
  PURCHASE: "PURCHASE",
  SUPPLIER: "PURCHASE",
  LABEL: "LABEL",
  PRINTER: "LABEL",
  EMPLOYEE: "WORKFORCE",
  AUTH: "AUTH",
};

/**
 * Classifies an activity. The action is checked first because it is more
 * specific than the module (a LOGIN in the EMPLOYEE module is still auth).
 */
export function activityCategory(
  action: ActionType,
  module: ActionModule
): ActivityCategory {
  return ACTION_CATEGORY[action] ?? MODULE_CATEGORY[module] ?? "OTHER";
}

// =============================================================================
// ACTIVITY SEVERITY
//
// Which actions a manager must not scroll past. The CRITICAL set below was
// chosen explicitly by the business owner, not defaulted:
//   • deletes and role/permission changes — irreversible or privilege-altering
//   • failed logins and forced logouts    — the security signal
//   • refunds and large discounts         — money leaving the till
//   • inventory adjustments               — the classic shrinkage-fraud vector
//
// Everything else is NORMAL unless it moves money, which makes it WARNING.
// =============================================================================

export type ActivitySeverity = "NORMAL" | "WARNING" | "CRITICAL";

/**
 * Discount amount, as a fraction of the sale, at or above which a discount is
 * itself CRITICAL rather than merely notable. A single deep discount is the
 * event worth interrupting someone for.
 */
export const LARGE_DISCOUNT_THRESHOLD = 0.25;

const CRITICAL_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  "DELETE",
  "ROLE_CHANGED",
  "PERMISSION_CHANGED",
  "EMPLOYEE_DEACTIVATED",
  "PASSWORD_RESET",
  "INVENTORY_ADJUST",
]);

const WARNING_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  "EXCHANGE_COMPLETE",
  "ATTENDANCE_ADJUSTED",
  "EMPLOYEE_REACTIVATED",
  "LABEL_PRINT_FAILED",
]);

/**
 * Classifies one activity row.
 *
 * `context` carries the few facts that cannot be read off the action alone — a
 * refund is a SALE row with a negative total, and a discount's severity depends
 * on its size. Callers that lack the context still get a correct action-level
 * answer; they simply cannot upgrade a discount to CRITICAL.
 */
export function activitySeverity(
  action: ActionType,
  module: ActionModule,
  context?: {
    /** True when the underlying sale was a refund/return rather than a sale. */
    isRefund?: boolean;
    /** Discount as a fraction of gross, 0–1. */
    discountRate?: number;
    /** True when this row is a failed login attempt. */
    isFailedLogin?: boolean;
    /** True when the session was force-terminated by an owner. */
    isForcedLogout?: boolean;
  }
): ActivitySeverity {
  // Context-driven cases first — they describe the specific row, whereas the
  // action only describes its kind.
  if (context?.isFailedLogin || context?.isForcedLogout) return "CRITICAL";
  if (context?.isRefund) return "CRITICAL";
  if (
    context?.discountRate !== undefined &&
    context.discountRate >= LARGE_DISCOUNT_THRESHOLD
  ) {
    return "CRITICAL";
  }

  if (CRITICAL_ACTIONS.has(action)) return "CRITICAL";
  if (WARNING_ACTIONS.has(action)) return "WARNING";

  // A discount below the threshold is still money off, so it stays notable.
  if (module === "DISCOUNT" || module === "COUPON") return "WARNING";
  if (context?.discountRate !== undefined && context.discountRate > 0) return "WARNING";

  return "NORMAL";
}

const ACTION_LABELS: Partial<Record<ActionType, string>> = {
  CREATE: "Created",
  UPDATE: "Updated",
  DELETE: "Deleted",
  LOGIN: "Logged in",
  LOGOUT: "Logged out",
  SALE_COMPLETE: "Completed a sale",
  PURCHASE_RECEIVE: "Received a purchase",
  EXCHANGE_COMPLETE: "Completed an exchange",
  INVENTORY_ADJUST: "Adjusted inventory",
  PRINT_INVOICE: "Printed an invoice",
  LABEL_PREVIEW_GENERATED: "Previewed a label",
  LABEL_PDF_GENERATED: "Generated a label PDF",
  LABEL_PRINT_STARTED: "Started a label print",
  LABEL_PRINT_COMPLETED: "Printed labels",
  LABEL_PRINT_FAILED: "Label print failed",
  LABEL_REPRINTED: "Reprinted labels",
  PRINTER_CHANGED: "Changed the printer",
  LABEL_TEMPLATE_CHANGED: "Changed a label template",
  PRINTER_SETTINGS_CHANGED: "Changed printer settings",
  PASSWORD_RESET: "Password was reset",
  ROLE_CHANGED: "Role changed",
  PERMISSION_CHANGED: "Permissions changed",
  EMPLOYEE_DEACTIVATED: "Account deactivated",
  EMPLOYEE_REACTIVATED: "Account reactivated",
  CLOCK_IN: "Clocked in",
  CLOCK_OUT: "Clocked out",
  ATTENDANCE_ADJUSTED: "Attendance adjusted",
  SHIFT_ASSIGNED: "Shift assigned",
  LEAVE_REQUESTED: "Requested leave",
  LEAVE_REVIEWED: "Leave reviewed",
};

const MODULE_NOUNS: Partial<Record<ActionModule, string>> = {
  PRODUCT: "product",
  VARIANT: "variant",
  CATEGORY: "category",
  BRAND: "brand",
  SUPPLIER: "supplier",
  PURCHASE: "purchase",
  SALE: "sale",
  EXCHANGE: "exchange",
  INVENTORY: "inventory",
  CUSTOMER: "customer",
  EMPLOYEE: "employee",
  DISCOUNT: "discount",
  COUPON: "coupon",
  EXPENSE: "expense",
  SETTINGS: "settings",
  ASSET: "asset",
  LABEL: "label",
  PRINTER: "printer",
  AUTH: "account",
};

/**
 * Builds the human sentence for a timeline row.
 *
 * A stored `description` always wins — the module that wrote the record knew
 * more about it than we can reconstruct here. This function is the fallback
 * that makes the timeline complete rather than patchy.
 */
export function describeActivity(params: {
  action: ActionType;
  module: ActionModule;
  description?: string | null;
}): string {
  if (params.description) return params.description;

  const label = ACTION_LABELS[params.action];
  const noun = MODULE_NOUNS[params.module];

  // Generic CRUD verbs are meaningless without their noun ("Created" what?).
  if (label && noun && (params.action === "CREATE" || params.action === "UPDATE" || params.action === "DELETE")) {
    return `${label} a ${noun}`;
  }

  if (label) return label;
  return noun ? `${params.action} on ${noun}` : String(params.action);
}
