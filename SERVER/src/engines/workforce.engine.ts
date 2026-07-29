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
