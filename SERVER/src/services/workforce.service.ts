// =============================================================================
// WORKFORCE SERVICE
//
// Orchestration + authorization for the Workforce Management module.
//
// The three rules this file exists to enforce:
//
//   1. RBAC IS DATA SCOPING, NOT UI HIDING. Every read runs through
//      `scopeFor(actor)`, which narrows what a MANAGER can see (no salary, no
//      OWNER rows, no cross-role compensation) before a query is built. A
//      manager hitting an owner endpoint is rejected by the route guard; a
//      manager hitting a SHARED endpoint gets a narrowed result set. Both
//      layers are required — neither alone is sufficient.
//
//   2. NO DUPLICATED BUSINESS LOGIC. Sales totals come from the sales tables,
//      activity from EmployeeAction, audit from AuditLog, notifications from
//      NotificationEngine, attendance arithmetic from workforce.engine. This
//      service joins them; it does not recompute them.
//
//   3. AGGREGATES ARE BATCHED. The roster attaches presence, attendance, sales
//      and last-activity to a PAGE of employees with a fixed number of queries.
//      Never one query per row.
// =============================================================================

import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import { logger } from "../config/logger";
import { ConfigurationEngine } from "../engines/configuration.engine";
import { NotificationEngine } from "../engines/notification.engine";
import { auditRepository } from "../repositories/audit.repository";
import { workforceRepository } from "../repositories/workforce.repository";
import * as workforceAlerts from "./workforceAlerts.service";
import { employeeRepository } from "../repositories/employee.repository";
import { invalidateAuthContext } from "../utils/authContextCache";
import { resetHeartbeat } from "../utils/presenceHeartbeat";
import { hashPassword } from "../utils/hash";
import {
  PRESENCE_THRESHOLD_MINUTES,
  attendancePercentage,
  activitySeverity,
  closeBreak,
  computeAttendance,
  derivePresence,
  describeActivity,
  activityCategory,
  openBreakMinutes,
  parseOperatingSystem,
  performanceScore,
  permissionsForRole,
  prorateMonthlyTarget,
  targetAchievement,
  toStoreDate,
  toStoreMinutes,
  type ShiftWindow,
} from "../engines/workforce.engine";
import type { AuthenticatedUser } from "../types/employee.types";
import type { PaginatedResponse } from "../types/common.types";
import type {
  ActivityQuery,
  AssignShiftInput,
  AttendanceQuery,
  ClockInput,
  CompareQuery,
  CreateNoteInput,
  LoginHistoryQuery,
  ManualAttendanceInput,
  PerformanceQuery,
  ResetPasswordInput,
  RosterQuery,
  SecurityQuery,
  ShiftInput,
  UpdateNoteInput,
  UpdateShiftInput,
  UpdateWorkforceEmployeeInput,
} from "../validation/workforce.validation";
import type {
  ActionModule,
  ActionType,
  AttendanceStatus,
  EmployeeRole,
} from "../../generated/prisma";

// =============================================================================
// SCOPING — the authorization primitive of this module
// =============================================================================

interface WorkforceScope {
  /** Roles this actor may see rows for. */
  visibleRoles: EmployeeRole[];
  /** May the actor see compensation and other owner-only profile fields? */
  canSeeCompensation: boolean;
  /** May the actor mutate the roster (create/edit/deactivate/reset password)? */
  canManage: boolean;
}

/**
 * Derives what this actor is allowed to see and do.
 *
 * MANAGER is an OPERATIONAL role: they monitor the team they work with —
 * managers and cashiers — but never the owner's record, and never anyone's
 * salary. That narrowing happens HERE, in the query inputs, so it holds no
 * matter which controller called us.
 */
function scopeFor(actor: AuthenticatedUser): WorkforceScope {
  if (actor.role === "OWNER") {
    return {
      visibleRoles: ["OWNER", "MANAGER", "CASHIER"],
      canSeeCompensation: true,
      canManage: true,
    };
  }

  if (actor.role === "MANAGER") {
    return {
      visibleRoles: ["MANAGER", "CASHIER"],
      canSeeCompensation: false,
      canManage: false,
    };
  }

  // CASHIER has no access to this module at all. The route guard rejects them
  // first; this is the defence-in-depth branch.
  throw new AppError(
    HTTP_STATUS.FORBIDDEN,
    "You do not have access to the workforce module."
  );
}

/**
 * Intersects a requested role filter with what the actor may see.
 * A manager asking for `role=OWNER` gets an empty set, not an error — the
 * filter is simply unsatisfiable within their scope.
 */
function resolveRoleFilter(
  scope: WorkforceScope,
  requested?: EmployeeRole | EmployeeRole[] | undefined
): EmployeeRole[] {
  if (!requested) return scope.visibleRoles;
  const list = Array.isArray(requested) ? requested : [requested];
  return list.filter((r) => scope.visibleRoles.includes(r));
}

/** Strips owner-only fields from a profile when the actor may not see them. */
function redactProfile<T extends { salary?: unknown }>(
  profile: T,
  scope: WorkforceScope
): T {
  if (scope.canSeeCompensation) return profile;
  const { salary: _salary, ...rest } = profile;
  return rest as T;
}

// =============================================================================
// DATE HELPERS — every window in this module is store-local, never UTC-naive.
// =============================================================================

function storeTimeZone(): string {
  try {
    return ConfigurationEngine.getTimeZone();
  } catch {
    // The engine throws if settings were never initialised (fresh install).
    // A sensible default keeps the module readable rather than 500-ing.
    return "Asia/Kolkata";
  }
}

/** Start of today, as the DATE value written to attendance.date. */
function todayDate(): Date {
  return toStoreDate(new Date(), storeTimeZone());
}

/** UTC instants bounding the store-local day that `date` falls in. */
function dayBounds(date: Date): { from: Date; to: Date } {
  const from = new Date(date);
  const to = new Date(date);
  to.setUTCHours(23, 59, 59, 999);
  return { from, to };
}

function daysAgo(days: number): Date {
  const d = todayDate();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

/** Resolves a period keyword into a concrete window. */
function resolvePeriod(period: string, from?: Date, to?: Date): { from: Date; to: Date } {
  if (from && to) return { from, to: dayBounds(to).to };

  const today = todayDate();
  switch (period) {
    case "today":
      return { from: today, to: dayBounds(today).to };
    case "week":
      return { from: daysAgo(6), to: dayBounds(today).to };
    case "month":
      return { from: daysAgo(29), to: dayBounds(today).to };
    case "quarter":
      return { from: daysAgo(89), to: dayBounds(today).to };
    case "year":
      return { from: daysAgo(364), to: dayBounds(today).to };
    default:
      return { from: daysAgo(29), to: dayBounds(today).to };
  }
}

/** Prisma Decimal | null → number. Money crosses the wire as a number, not a string. */
function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  // Prisma Decimal exposes toNumber(); a plain string falls through to Number().
  const maybe = value as { toNumber?: () => number };
  return typeof maybe.toNumber === "function" ? maybe.toNumber() : Number(value) || 0;
}

/**
 * Like toNumber, but PRESERVES null.
 *
 * Used for monthlyTarget, where null means "no target configured" and 0 would
 * mean "a target of zero". Collapsing the two would make an unconfigured
 * employee render as 0% achieved — a data gap disguised as a performance
 * finding, which is exactly what the null-safe score exists to prevent.
 */
function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return toNumber(value);
}

function paginate<T>(data: T[], total: number, page: number, limit: number): PaginatedResponse<T> {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
}

// =============================================================================
// ROSTER — the Managers and Employees tabs
// =============================================================================

/** Computed sorts cannot run in SQL; they are applied after aggregates attach. */
const COMPUTED_SORTS = new Set([
  "todayRevenue", "todayTransactions", "attendancePercentage", "workedMinutes",
]);

/**
 * Lists employees with every operational aggregate the table needs, attached in
 * a FIXED number of queries regardless of page size.
 *
 * When the caller sorts by a computed column (revenue, attendance %), we widen
 * the id set to the full filtered roster before aggregating, because ranking
 * must consider everyone — sorting only the current page would produce a
 * "top performer" who merely happened to land on page 1.
 */
export async function listRoster(query: RosterQuery, actor: AuthenticatedUser) {
  const scope = scopeFor(actor);
  const roles = resolveRoleFilter(scope, query.role);

  // A filter the actor's scope cannot satisfy yields an empty page, not a 403.
  if (roles.length === 0) {
    return paginate([], 0, query.page, query.limit);
  }

  const isComputedSort = COMPUTED_SORTS.has(query.sortBy);

  const baseFilters = {
    page: query.page,
    limit: query.limit,
    search: query.search,
    roles,
    isActive: query.isActive,
    employmentStatus: query.employmentStatus,
    shiftId: query.shiftId,
    storeCode: query.storeCode,
    joinedFrom: query.joinedFrom,
    joinedTo: query.joinedTo,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  };

  // ── Fetch the rows to enrich ──────────────────────────────────────────────
  let rows: Awaited<ReturnType<typeof workforceRepository.findRoster>>["data"];
  let total: number;

  if (isComputedSort) {
    // Rank across the whole filtered roster, then slice the requested page.
    const all = await workforceRepository.findRoster({
      ...baseFilters,
      page: 1,
      limit: 1000,
    });
    rows = all.data;
    total = all.total;
  } else {
    const paged = await workforceRepository.findRoster(baseFilters);
    rows = paged.data;
    total = paged.total;
  }

  const ids = rows.map((r) => r.id);
  const enriched = await attachRosterAggregates(ids, rows, query);

  // ── Computed sort + slice ─────────────────────────────────────────────────
  if (isComputedSort) {
    const dir = query.sortOrder === "asc" ? 1 : -1;
    enriched.sort((a, b) => {
      const av = (a[query.sortBy as keyof typeof a] as number) ?? 0;
      const bv = (b[query.sortBy as keyof typeof b] as number) ?? 0;
      return (av - bv) * dir;
    });

    const start = (query.page - 1) * query.limit;
    return paginate(enriched.slice(start, start + query.limit), total, query.page, query.limit);
  }

  return paginate(enriched, total, query.page, query.limit);
}

/**
 * Attaches presence, today's attendance, today's sales and last activity to a
 * set of roster rows. Five parallel queries, independent of row count.
 */
async function attachRosterAggregates(
  ids: string[],
  rows: Awaited<ReturnType<typeof workforceRepository.findRoster>>["data"],
  query: { attendanceWindowDays?: number | undefined }
) {
  if (ids.length === 0) return [];

  const today = todayDate();
  const { from: dayFrom, to: dayTo } = dayBounds(today);
  const windowDays = query.attendanceWindowDays ?? 30;
  const windowFrom = daysAgo(windowDays - 1);

  // The roster tables show month-to-date money alongside today's, so the
  // aggregate set spans both windows. Still a FIXED query count — nine batched
  // queries for the page, not nine per row.
  const monthFrom = daysAgo(29);

  const [
    sessions, attendanceToday, salesToday, lastActivity, attendanceWindow,
    salesMonth, unitsMonth, returnsMonth, lastSale,
  ] = await Promise.all([
    workforceRepository.findOpenSessions(ids),
    workforceRepository.findAttendanceForDate(ids, today),
    workforceRepository.groupSalesByEmployee(ids, dayFrom, dayTo),
    workforceRepository.findLastActivity(ids),
    workforceRepository.groupAttendanceByEmployeeAndStatus(ids, windowFrom, dayTo),
    workforceRepository.groupSalesByEmployee(ids, monthFrom, dayTo),
    workforceRepository.sumUnitsByEmployee(ids, monthFrom, dayTo),
    workforceRepository.groupReturnsByEmployee(ids, monthFrom, dayTo),
    workforceRepository.lastSaleByEmployee(ids),
  ]);

  // Index every aggregate by employeeId so the join below is O(1) per row.
  const sessionBy = new Map(sessions.map((s) => [s.employeeId, s]));
  const attendanceBy = new Map(attendanceToday.map((a) => [a.employeeId, a]));
  const salesBy = new Map(salesToday.map((s) => [s.employeeId, s]));
  const activityBy = new Map(lastActivity.map((a) => [a.employeeId, a]));
  const monthBy = new Map(salesMonth.map((s) => [s.employeeId, s]));
  const unitsBy = new Map(unitsMonth.map((u) => [u.employeeId, Number(u.units)]));
  const returnsBy = new Map(returnsMonth.map((r) => [r.employeeId, r]));
  const lastSaleBy = new Map(lastSale.map((s) => [s.employeeId, s._max.saleDate]));

  const attendanceCounts = new Map<string, Partial<Record<AttendanceStatus, number>>>();
  const workedMinutesBy = new Map<string, number>();
  for (const row of attendanceWindow) {
    const bucket = attendanceCounts.get(row.employeeId) ?? {};
    bucket[row.status] = (bucket[row.status] ?? 0) + row._count._all;
    attendanceCounts.set(row.employeeId, bucket);
    workedMinutesBy.set(
      row.employeeId,
      (workedMinutesBy.get(row.employeeId) ?? 0) + (row._sum.workedMinutes ?? 0)
    );
  }

  const now = new Date();

  return rows.map((row) => {
    const session = sessionBy.get(row.id);
    const attendance = attendanceBy.get(row.id);
    const sales = salesBy.get(row.id);
    const activity = activityBy.get(row.id);

    // ── Month-to-date figures + the composite rating ──────────────────────
    const month = monthBy.get(row.id);
    const monthlyRevenue = toNumber(month?._sum.grandTotal);
    const monthlyTransactions = month?._count._all ?? 0;
    const monthlyReturns = returnsBy.get(row.id)?._count._all ?? 0;
    const monthlyDiscount =
      toNumber(month?._sum.discountAmount) + toNumber(month?._sum.manualDiscountAmount);

    const attendancePct = attendancePercentage(attendanceCounts.get(row.id) ?? {});

    // The rating uses the SAME engine call as the Performance page, over the
    // same 30-day window, so a roster row and the leaderboard can never
    // disagree about someone's score.
    const rating = performanceScore({
      revenue: monthlyRevenue,
      target: prorateMonthlyTarget(toNumberOrNull(row.monthlyTarget), monthFrom, dayTo),
      attendancePercentage: attendancePct,
      returnRate: monthlyTransactions > 0 ? monthlyReturns / monthlyTransactions : 0,
      discountRate:
        monthlyRevenue + monthlyDiscount > 0
          ? monthlyDiscount / (monthlyRevenue + monthlyDiscount)
          : 0,
    });

    return {
      id: row.id,
      employeeCode: row.employeeCode,
      firstName: row.firstName,
      lastName: row.lastName,
      fullName: `${row.firstName} ${row.lastName}`.trim(),
      email: row.email,
      phone: row.phone,
      role: row.role,
      photoUrl: row.photoUrl,
      isActive: row.isActive,
      employmentStatus: row.employmentStatus,
      joiningDate: row.joiningDate,
      lastLogin: row.lastLogin,
      storeCode: row.storeCode,

      shift: row.shift,

      presence: derivePresence(session ?? null, now),
      sessionStartedAt: session?.loginAt ?? null,
      device: session?.device ?? null,

      attendanceStatus: attendance?.status ?? null,
      clockInAt: attendance?.clockInAt ?? null,
      clockOutAt: attendance?.clockOutAt ?? null,
      workedMinutesToday: attendance?.workedMinutes ?? 0,
      lateMinutesToday: attendance?.lateMinutes ?? 0,
      isWorkingNow: Boolean(attendance?.clockInAt && !attendance?.clockOutAt),

      todayRevenue: toNumber(sales?._sum.grandTotal),
      todayTransactions: sales?._count._all ?? 0,

      currentActivity: activity
        ? describeActivity({
            action: activity.actionType,
            module: activity.module,
            description: activity.description,
          })
        : null,
      currentActivityAt: activity?.createdAt ?? null,

      attendancePercentage: attendancePct,
      workedMinutes: workedMinutesBy.get(row.id) ?? 0,

      // ── Enterprise roster columns ──────────────────────────────────────
      assignedRegister: row.assignedRegister,
      monthlyTarget: toNumberOrNull(row.monthlyTarget),

      monthlyRevenue,
      monthlyTransactions,
      // Guarded: an employee with no sales reads ₹0, never NaN.
      averageBill: monthlyTransactions > 0 ? monthlyRevenue / monthlyTransactions : 0,
      unitsSold: unitsBy.get(row.id) ?? 0,
      lastSaleAt: lastSaleBy.get(row.id) ?? null,

      // Null when no target is set — the roster renders "Not set", not 0.
      performanceScore: rating.score,
    };
  });
}

// =============================================================================
// DASHBOARD SUMMARY
// =============================================================================

/**
 * The summary cards above the roster. Every number is a COUNT — no rows cross
 * the wire — so this stays cheap enough to poll for live presence.
 */
export async function getWorkforceSummary(actor: AuthenticatedUser) {
  const scope = scopeFor(actor);
  const today = todayDate();

  const { from: dayFrom, to: dayTo } = dayBounds(today);

  const [byRole, byStatus, attendanceToday, onlineCount, roster, actionCounts] =
    await Promise.all([
      workforceRepository.countByRole({ role: { in: scope.visibleRoles }, isActive: true }),
      workforceRepository.countByEmploymentStatus({ role: { in: scope.visibleRoles } }),
      workforceRepository.groupAttendanceByStatus(today),
      workforceRepository.countOnline(PRESENCE_THRESHOLD_MINUTES),
      workforceRepository.findRosterIds({
        page: 1, limit: 1000, roles: scope.visibleRoles,
        sortBy: "firstName", sortOrder: "asc",
      }),
      // Today's operational counters come from the EXISTING audit records —
      // labels printed, customers added and inventory edits are already written
      // by those modules, so this module counts them rather than re-tracking.
      workforceRepository.groupActivityByTypeAndModule({ dateFrom: dayFrom, dateTo: dayTo }),
    ]);

  const visibleIds = roster.map((r) => r.id);

  const [salesTodayRows, refundsTodayRows] = await Promise.all([
    workforceRepository.groupSalesByEmployee(visibleIds, dayFrom, dayTo),
    workforceRepository.groupReturnsByEmployee(visibleIds, dayFrom, dayTo),
  ]);

  /**
   * Sums grouped action counts.
   *
   * Both parameters are the Prisma enum types, NOT strings — a typo like
   * "CREATE_CUSTOMER" (which does not exist; creating a customer is CREATE on
   * the CUSTOMER module) is then a compile error rather than a card that
   * silently reads zero forever.
   */
  const actionCount = (types: ActionType[], modules?: ActionModule[]) =>
    actionCounts
      .filter(
        (a) => types.includes(a.actionType) && (!modules || modules.includes(a.module))
      )
      .reduce((sum, a) => sum + a._count._all, 0);

  const roleCount = (role: EmployeeRole) =>
    byRole.find((r) => r.role === role)?._count._all ?? 0;

  const statusCount = (status: AttendanceStatus) =>
    attendanceToday.find((a) => a.status === status)?._count._all ?? 0;

  const totalEmployees = byRole.reduce((sum, r) => sum + r._count._all, 0);

  // Working today = anyone whose day is marked present-ish. Late is still
  // working; counting it as absent would misrepresent the floor.
  const workingToday = statusCount("PRESENT") + statusCount("LATE") + statusCount("HALF_DAY");

  return {
    totalEmployees,
    managers: roleCount("MANAGER"),
    cashiers: roleCount("CASHIER"),
    owners: roleCount("OWNER"),

    online: onlineCount,
    offline: Math.max(0, totalEmployees - onlineCount),

    workingToday,
    onLeave: statusCount("ON_LEAVE"),
    absentToday: statusCount("ABSENT"),
    lateToday: statusCount("LATE"),

    employmentStatus: Object.fromEntries(
      byStatus.map((s) => [s.employmentStatus, s._count._all])
    ),

    // ── Today's operational counters (live dashboard strip) ────────────────
    salesToday: salesTodayRows.reduce((sum, s) => sum + toNumber(s._sum.grandTotal), 0),
    transactionsToday: salesTodayRows.reduce((sum, s) => sum + s._count._all, 0),
    refundsToday: refundsTodayRows.reduce((sum, r) => sum + r._count._all, 0),
    refundValueToday: refundsTodayRows.reduce(
      (sum, r) => sum + toNumber(r._sum.grandTotal),
      0
    ),

    labelsPrinted: actionCount(["LABEL_PRINT_COMPLETED", "LABEL_REPRINTED"]),
    // Creating a customer is a generic CREATE — only the module distinguishes
    // it from creating a product, hence the second argument.
    customersAdded: actionCount(["CREATE"], ["CUSTOMER"]),
    inventoryUpdates: actionCount(["INVENTORY_ADJUST"], ["INVENTORY"]),
  };
}

/**
 * Role-scoped statistics strip for the Managers / Employees tabs.
 * Same shape for both so the frontend renders one component.
 */
export async function getRosterStats(
  roleFilter: EmployeeRole[],
  actor: AuthenticatedUser
) {
  const scope = scopeFor(actor);
  const roles = resolveRoleFilter(scope, roleFilter);

  if (roles.length === 0) {
    return {
      total: 0, online: 0, offline: 0, working: 0, onLeave: 0, absent: 0,
      todayRevenue: 0, todayTransactions: 0,
    };
  }

  const today = todayDate();
  const { from, to } = dayBounds(today);

  // The id set is needed to scope both attendance and sales to this role.
  const roster = await workforceRepository.findRosterIds({
    page: 1, limit: 1000, roles, isActive: true,
    sortBy: "firstName", sortOrder: "asc",
  });
  const ids = roster.map((r) => r.id);

  const [attendance, sales, online] = await Promise.all([
    workforceRepository.groupAttendanceByStatus(today, ids),
    workforceRepository.groupSalesByEmployee(ids, from, to),
    // countOnline takes a single role; for a multi-role strip we sum them.
    Promise.all(roles.map((r) => workforceRepository.countOnline(PRESENCE_THRESHOLD_MINUTES, { role: r })))
      .then((counts) => counts.reduce((a, b) => a + b, 0)),
  ]);

  const statusCount = (status: AttendanceStatus) =>
    attendance.find((a) => a.status === status)?._count._all ?? 0;

  return {
    total: ids.length,
    online,
    offline: Math.max(0, ids.length - online),
    working: statusCount("PRESENT") + statusCount("LATE") + statusCount("HALF_DAY"),
    onLeave: statusCount("ON_LEAVE"),
    absent: statusCount("ABSENT"),
    todayRevenue: sales.reduce((sum, s) => sum + toNumber(s._sum.grandTotal), 0),
    todayTransactions: sales.reduce((sum, s) => sum + s._count._all, 0),
  };
}

// =============================================================================
// EMPLOYEE DETAIL (drawer)
// =============================================================================

/**
 * Loads one employee's profile for the drawer's Overview tab.
 * The other tabs are lazy — they call their own endpoints when opened, so
 * opening a drawer never pays for six tabs of data the user may not look at.
 */
export async function getEmployeeDetail(id: string, actor: AuthenticatedUser) {
  const scope = scopeFor(actor);

  const profile = await workforceRepository.findEmployeeProfile(id);
  if (!profile) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Employee not found.");
  }

  // A manager may not open the owner's record. 404 rather than 403 — revealing
  // "this exists but you can't see it" is itself information.
  if (!scope.visibleRoles.includes(profile.role)) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Employee not found.");
  }

  const today = todayDate();
  const [session, attendance] = await Promise.all([
    workforceRepository.findOpenSessions([id]),
    workforceRepository.findAttendanceForDate([id], today),
  ]);

  const openSession = session[0] ?? null;
  const todayAttendance = attendance[0] ?? null;

  return redactProfile(
    {
      ...profile,
      fullName: `${profile.firstName} ${profile.lastName}`.trim(),
      presence: derivePresence(openSession, new Date()),
      sessionStartedAt: openSession?.loginAt ?? null,
      attendanceStatus: todayAttendance?.status ?? null,
      clockInAt: todayAttendance?.clockInAt ?? null,
      clockOutAt: todayAttendance?.clockOutAt ?? null,
      isWorkingNow: Boolean(todayAttendance?.clockInAt && !todayAttendance?.clockOutAt),
      permissions: permissionsForRole(profile.role),
    },
    scope
  );
}

// =============================================================================
// SALES TAB / PERFORMANCE
// =============================================================================

/**
 * Operational sales metrics for one employee across today / week / month.
 *
 * Reads the sales and exchange tables directly rather than going through the
 * analytics service, because analytics answers "how is the STORE doing" and
 * this answers "how is this PERSON doing" — different grouping, same source of
 * truth. No totals are recomputed or cached here.
 */
export async function getEmployeeSales(
  id: string,
  query: PerformanceQuery,
  actor: AuthenticatedUser
) {
  const scope = scopeFor(actor);

  const profile = await workforceRepository.findEmployeeProfile(id);
  if (!profile || !scope.visibleRoles.includes(profile.role)) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Employee not found.");
  }

  const today = todayDate();
  const dayWindow = dayBounds(today);
  const weekFrom = daysAgo(6);
  const monthFrom = daysAgo(29);
  const custom = resolvePeriod(query.period, query.dateFrom, query.dateTo);

  const [
    todaySales, weekSales, monthSales, periodSales, units, exchanges, returns, trend,
    topCategory, customers, attendanceRows,
  ] = await Promise.all([
    workforceRepository.groupSalesByEmployee([id], dayWindow.from, dayWindow.to),
    workforceRepository.groupSalesByEmployee([id], weekFrom, dayWindow.to),
    workforceRepository.groupSalesByEmployee([id], monthFrom, dayWindow.to),
    workforceRepository.groupSalesByEmployee([id], custom.from, custom.to),
    workforceRepository.sumUnitsByEmployee([id], custom.from, custom.to),
    workforceRepository.groupExchangesByEmployee([id], custom.from, custom.to),
    workforceRepository.groupReturnsByEmployee([id], custom.from, custom.to),
    workforceRepository.salesTrendByEmployee([id], custom.from, custom.to),
    workforceRepository.topCategoryByEmployee([id], custom.from, custom.to),
    workforceRepository.countCustomersByEmployee([id], custom.from, custom.to),
    // Worked minutes are the denominator of sales-per-hour. Read from the
    // attendance the employee actually recorded, not from their shift's nominal
    // hours — the metric is productivity per hour WORKED.
    workforceRepository.groupAttendanceByEmployeeAndStatus([id], custom.from, custom.to),
  ]);

  const revenueOf = (rows: typeof todaySales) => toNumber(rows[0]?._sum.grandTotal);
  const countOf = (rows: typeof todaySales) => rows[0]?._count._all ?? 0;

  const periodRevenue = revenueOf(periodSales);
  const periodTransactions = countOf(periodSales);

  const discountGiven =
    toNumber(periodSales[0]?._sum.discountAmount) +
    toNumber(periodSales[0]?._sum.manualDiscountAmount);

  const workedMinutes = attendanceRows.reduce(
    (sum, row) => sum + (row._sum.workedMinutes ?? 0),
    0
  );

  return {
    todayRevenue: revenueOf(todaySales),
    todayTransactions: countOf(todaySales),
    weeklyRevenue: revenueOf(weekSales),
    weeklyTransactions: countOf(weekSales),
    monthlyRevenue: revenueOf(monthSales),
    monthlyTransactions: countOf(monthSales),

    periodRevenue,
    periodTransactions,
    // Guard the division — an employee with no sales must read ₹0, not NaN.
    averageBillValue: periodTransactions > 0 ? periodRevenue / periodTransactions : 0,
    unitsSold: Number(units[0]?.units ?? 0),

    returns: returns[0]?._count._all ?? 0,
    returnsValue: toNumber(returns[0]?._sum.grandTotal),
    exchanges: exchanges[0]?._count._all ?? 0,
    exchangeValue: toNumber(exchanges[0]?._sum.issuedValue),

    discountGiven,
    discountPercentage: periodRevenue > 0 ? (discountGiven / (periodRevenue + discountGiven)) * 100 : 0,

    topCategory: topCategory[0]?.categoryName ?? null,
    topCategoryUnits: Number(topCategory[0]?.units ?? 0),
    customerCount: Number(customers[0]?.customers ?? 0),

    // Null rather than 0 when no hours were recorded: dividing revenue by zero
    // hours is undefined, and rendering "₹0/hr" would claim the employee sold
    // nothing when in fact they never clocked in.
    workedMinutes,
    salesPerHour: workedMinutes > 0 ? periodRevenue / (workedMinutes / 60) : null,

    trend: trend.map((t) => ({
      date: t.day,
      revenue: Number(t.revenue),
      transactions: Number(t.transactions),
    })),
  };
}

/**
 * The Performance module — every visible employee ranked.
 *
 * OWNER sees the whole organisation. MANAGER sees only their operational team
 * (managers + cashiers), enforced by `scopeFor`, not by the UI.
 */
export async function getPerformance(query: PerformanceQuery, actor: AuthenticatedUser) {
  const scope = scopeFor(actor);
  const roles = resolveRoleFilter(scope, query.role);
  if (roles.length === 0) return { period: resolvePeriod(query.period, query.dateFrom, query.dateTo), data: [] };

  const window = resolvePeriod(query.period, query.dateFrom, query.dateTo);

  const roster = await workforceRepository.findRoster({
    page: 1, limit: 500, roles, isActive: true,
    sortBy: "firstName", sortOrder: "asc",
  });
  const ids = roster.data.map((r) => r.id);

  const [sales, units, exchanges, returns, attendance] = await Promise.all([
    workforceRepository.groupSalesByEmployee(ids, window.from, window.to),
    workforceRepository.sumUnitsByEmployee(ids, window.from, window.to),
    workforceRepository.groupExchangesByEmployee(ids, window.from, window.to),
    workforceRepository.groupReturnsByEmployee(ids, window.from, window.to),
    workforceRepository.groupAttendanceByEmployeeAndStatus(ids, window.from, window.to),
  ]);

  const salesBy = new Map(sales.map((s) => [s.employeeId, s]));
  const unitsBy = new Map(units.map((u) => [u.employeeId, Number(u.units)]));
  const exchangeBy = new Map(exchanges.map((e) => [e.employeeId, e]));
  const returnBy = new Map(returns.map((r) => [r.employeeId, r]));

  const attendanceCounts = new Map<string, Partial<Record<AttendanceStatus, number>>>();
  for (const row of attendance) {
    const bucket = attendanceCounts.get(row.employeeId) ?? {};
    bucket[row.status] = (bucket[row.status] ?? 0) + row._count._all;
    attendanceCounts.set(row.employeeId, bucket);
  }

  const rows = roster.data.map((emp) => {
    const s = salesBy.get(emp.id);
    const revenue = toNumber(s?._sum.grandTotal);
    const transactions = s?._count._all ?? 0;
    const discount =
      toNumber(s?._sum.discountAmount) + toNumber(s?._sum.manualDiscountAmount);

    const returns = returnBy.get(emp.id)?._count._all ?? 0;
    const attendancePct = attendancePercentage(attendanceCounts.get(emp.id) ?? {});

    // Rates as fractions for the score; the percentages below are for display.
    const returnRate = transactions > 0 ? returns / transactions : 0;
    const discountRate = revenue + discount > 0 ? discount / (revenue + discount) : 0;

    // The monthly target is pro-rated onto THIS window, so "82% of target"
    // means the same thing whether the user picked a week or a quarter.
    const proratedTarget = prorateMonthlyTarget(
      toNumberOrNull(emp.monthlyTarget),
      window.from,
      window.to
    );

    const score = performanceScore({
      revenue,
      target: proratedTarget,
      attendancePercentage: attendancePct,
      returnRate,
      discountRate,
    });

    return {
      id: emp.id,
      employeeCode: emp.employeeCode,
      fullName: `${emp.firstName} ${emp.lastName}`.trim(),
      role: emp.role,
      photoUrl: emp.photoUrl,
      revenue,
      transactions,
      averageBill: transactions > 0 ? revenue / transactions : 0,
      unitsSold: unitsBy.get(emp.id) ?? 0,
      returns,
      refundValue: toNumber(returnBy.get(emp.id)?._sum.grandTotal),
      returnPercentage: returnRate * 100,
      exchanges: exchangeBy.get(emp.id)?._count._all ?? 0,
      discountGiven: discount,
      discountPercentage: discountRate * 100,
      attendancePercentage: attendancePct,

      // Null-safe by construction: both are null when no target is configured,
      // and the UI renders "Not set" rather than a misleading 0%.
      monthlyTarget: toNumberOrNull(emp.monthlyTarget),
      proratedTarget,
      targetAchievement: targetAchievement(revenue, proratedTarget),
      performanceScore: score.score,
      performanceBreakdown: score.breakdown,

      rank: 0,
    };
  });

  // Rank by revenue. Assigned after the map so every row is comparable.
  rows.sort((a, b) => b.revenue - a.revenue);
  rows.forEach((row, index) => { row.rank = index + 1; });

  return { period: window, data: rows };
}

// =============================================================================
// ACTIVITY TIMELINE — reuses EmployeeAction. No parallel activity table.
// =============================================================================

export async function getActivity(query: ActivityQuery, actor: AuthenticatedUser) {
  const scope = scopeFor(actor);

  // Scope the timeline to employees the actor may see. Without this a manager
  // could read the owner's activity by passing an employeeId directly.
  let employeeIds: string[] | undefined;
  if (query.employeeId) {
    const target = await workforceRepository.findEmployeeProfile(query.employeeId);
    if (!target || !scope.visibleRoles.includes(target.role)) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Employee not found.");
    }
  } else if (actor.role !== "OWNER") {
    const visible = await workforceRepository.findRosterIds({
      page: 1, limit: 1000, roles: scope.visibleRoles,
      sortBy: "firstName", sortOrder: "asc",
    });
    employeeIds = visible.map((v) => v.id);
  }

  const { total, data } = await workforceRepository.findActivity({
    page: query.page,
    limit: query.limit,
    employeeId: query.employeeId,
    employeeIds,
    actionType: query.actionType,
    module: query.module,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
  });

  const rows = data.map((row) => ({
    id: row.id,
    employeeId: row.employeeId,
    employee: row.employee
      ? {
          id: row.employee.id,
          fullName: `${row.employee.firstName} ${row.employee.lastName}`.trim(),
          employeeCode: row.employee.employeeCode,
          role: row.employee.role,
          photoUrl: row.employee.photoUrl,
        }
      : null,
    actionType: row.actionType,
    module: row.module,
    category: activityCategory(row.actionType, row.module),
    // Severity is derived from the action, never stored — so re-classifying
    // (say, promoting inventory edits to Critical) is one engine change and
    // applies retroactively to the whole history.
    severity: activitySeverity(row.actionType, row.module),
    description: describeActivity({
      action: row.actionType,
      module: row.module,
      description: row.description,
    }),
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    createdAt: row.createdAt,
  }));

  return paginate(rows, total, query.page, query.limit);
}

// =============================================================================
// LOGIN HISTORY
// =============================================================================

export async function getLoginHistory(query: LoginHistoryQuery, actor: AuthenticatedUser) {
  const scope = scopeFor(actor);

  let employeeIds: string[] | undefined;
  if (query.employeeId) {
    const target = await workforceRepository.findEmployeeProfile(query.employeeId);
    if (!target || !scope.visibleRoles.includes(target.role)) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Employee not found.");
    }
  } else if (actor.role !== "OWNER") {
    const visible = await workforceRepository.findRosterIds({
      page: 1, limit: 1000, roles: scope.visibleRoles,
      sortBy: "firstName", sortOrder: "asc",
    });
    employeeIds = visible.map((v) => v.id);
  }

  const { total, data } = await workforceRepository.findLoginHistory({
    page: query.page,
    limit: query.limit,
    employeeId: query.employeeId,
    employeeIds,
    search: query.search,
    isSuccessful: query.isSuccessful,
    activeOnly: query.activeOnly,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
  });

  const now = new Date();

  const rows = data.map((row) => ({
    id: row.id,
    employeeId: row.employeeId,
    employee: row.employee
      ? {
          id: row.employee.id,
          fullName: `${row.employee.firstName} ${row.employee.lastName}`.trim(),
          employeeCode: row.employee.employeeCode,
          role: row.employee.role,
          photoUrl: row.employee.photoUrl,
        }
      : null,
    loginAt: row.loginAt,
    logoutAt: row.logoutAt,
    // Stored duration for closed sessions; live elapsed for open ones.
    durationMinutes:
      row.durationMinutes ??
      (row.logoutAt
        ? Math.round((row.logoutAt.getTime() - row.loginAt.getTime()) / 60000)
        : Math.round((now.getTime() - row.loginAt.getTime()) / 60000)),
    device: row.device,
    browser: row.browser,
    operatingSystem: row.operatingSystem,
    ipAddress: row.ipAddress,
    isSuccessful: row.isSuccessful,
    failureReason: row.failureReason,
    endReason: row.endReason,
    // Distinguishes an owner-forced logout from a self-service one in the UI.
    wasTerminated: row.endReason === "TERMINATED",
    terminatedById: row.terminatedById,
    sessionStatus: row.logoutAt
      ? ("ENDED" as const)
      : derivePresence({ loginAt: row.loginAt, logoutAt: row.logoutAt, lastSeenAt: row.lastSeenAt }, now) === "ONLINE"
        ? ("ACTIVE" as const)
        : ("IDLE" as const),
  }));

  return paginate(rows, total, query.page, query.limit);
}

// =============================================================================
// ATTENDANCE
// =============================================================================

export async function getAttendance(query: AttendanceQuery, actor: AuthenticatedUser) {
  const scope = scopeFor(actor);

  let employeeIds: string[] | undefined;
  if (query.employeeId) {
    const target = await workforceRepository.findEmployeeProfile(query.employeeId);
    if (!target || !scope.visibleRoles.includes(target.role)) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Employee not found.");
    }
  } else if (actor.role !== "OWNER") {
    const visible = await workforceRepository.findRosterIds({
      page: 1, limit: 1000, roles: scope.visibleRoles,
      sortBy: "firstName", sortOrder: "asc",
    });
    employeeIds = visible.map((v) => v.id);
  }

  const window = resolvePeriod(query.period, query.dateFrom, query.dateTo);

  const { total, data } = await workforceRepository.findAttendance({
    page: query.page,
    limit: query.limit,
    employeeId: query.employeeId,
    employeeIds,
    status: query.status,
    shiftId: query.shiftId,
    search: query.search,
    dateFrom: window.from,
    dateTo: window.to,
  });

  const rows = data.map((row) => ({
    id: row.id,
    employeeId: row.employeeId,
    employee: row.employee
      ? {
          id: row.employee.id,
          fullName: `${row.employee.firstName} ${row.employee.lastName}`.trim(),
          employeeCode: row.employee.employeeCode,
          role: row.employee.role,
          photoUrl: row.employee.photoUrl,
        }
      : null,
    date: row.date,
    clockInAt: row.clockInAt,
    clockOutAt: row.clockOutAt,
    status: row.status,
    source: row.source,
    workedMinutes: row.workedMinutes,
    lateMinutes: row.lateMinutes,
    earlyExitMinutes: row.earlyExitMinutes,
    overtimeMinutes: row.overtimeMinutes,
    // Accumulated break plus any break still running, so the column reads
    // correctly mid-break instead of jumping when the break ends.
    breakMinutes: row.breakMinutes + openBreakMinutes(row.breakStartedAt),
    isOnBreak: row.breakStartedAt !== null,
    notes: row.notes,
    shift: row.shift,
  }));

  return paginate(rows, total, query.page, query.limit);
}

/** Attendance summary + trend for the Attendance page and the drawer tab. */
export async function getAttendanceSummary(
  query: AttendanceQuery,
  actor: AuthenticatedUser
) {
  const scope = scopeFor(actor);
  const window = resolvePeriod(query.period, query.dateFrom, query.dateTo);

  let ids: string[];
  if (query.employeeId) {
    const target = await workforceRepository.findEmployeeProfile(query.employeeId);
    if (!target || !scope.visibleRoles.includes(target.role)) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Employee not found.");
    }
    ids = [query.employeeId];
  } else {
    const visible = await workforceRepository.findRosterIds({
      page: 1, limit: 1000, roles: scope.visibleRoles, isActive: true,
      sortBy: "firstName", sortOrder: "asc",
    });
    ids = visible.map((v) => v.id);
  }

  const today = todayDate();

  const [byStatus, todayStatus, trend] = await Promise.all([
    workforceRepository.groupAttendanceByEmployeeAndStatus(ids, window.from, window.to),
    workforceRepository.groupAttendanceByStatus(today, ids),
    workforceRepository.attendanceTrend(window.from, window.to, ids),
  ]);

  const counts: Partial<Record<AttendanceStatus, number>> = {};
  let workedMinutes = 0;
  let lateMinutes = 0;
  let overtimeMinutes = 0;

  for (const row of byStatus) {
    counts[row.status] = (counts[row.status] ?? 0) + row._count._all;
    workedMinutes += row._sum.workedMinutes ?? 0;
    lateMinutes += row._sum.lateMinutes ?? 0;
    overtimeMinutes += row._sum.overtimeMinutes ?? 0;
  }

  // Collapse the (date, status) grid into one row per day for the chart.
  const trendByDate = new Map<
    string,
    { date: Date; present: number; late: number; absent: number; onLeave: number; workedMinutes: number }
  >();

  for (const row of trend) {
    const key = row.date.toISOString().slice(0, 10);
    const entry = trendByDate.get(key) ?? {
      date: row.date, present: 0, late: 0, absent: 0, onLeave: 0, workedMinutes: 0,
    };
    if (row.status === "PRESENT" || row.status === "HALF_DAY") entry.present += row._count._all;
    else if (row.status === "LATE") entry.late += row._count._all;
    else if (row.status === "ABSENT") entry.absent += row._count._all;
    else if (row.status === "ON_LEAVE") entry.onLeave += row._count._all;
    entry.workedMinutes += row._sum.workedMinutes ?? 0;
    trendByDate.set(key, entry);
  }

  const statusToday = (status: AttendanceStatus) =>
    todayStatus.find((t) => t.status === status)?._count._all ?? 0;

  return {
    period: window,
    headcount: ids.length,
    presentToday: statusToday("PRESENT") + statusToday("LATE") + statusToday("HALF_DAY"),
    absentToday: statusToday("ABSENT"),
    onLeaveToday: statusToday("ON_LEAVE"),
    lateToday: statusToday("LATE"),
    counts,
    workedMinutes,
    lateMinutes,
    overtimeMinutes,
    attendancePercentage: attendancePercentage(counts),
    trend: [...trendByDate.values()].sort((a, b) => a.date.getTime() - b.date.getTime()),
  };
}

// =============================================================================
// CLOCK IN / OUT
// =============================================================================

/**
 * Clocks an employee in. Idempotent by construction: the (employeeId, date)
 * unique constraint means a second call on the same day updates rather than
 * duplicating, so a double-tap or a retried request cannot create two days.
 */
export async function clockIn(input: ClockInput, actor: AuthenticatedUser) {
  // An employee always clocks themselves in; an OWNER may clock in on behalf of
  // someone (a forgotten punch), which is recorded as a MANUAL source.
  const targetId = input.employeeId ?? actor.id;
  const onBehalf = targetId !== actor.id;

  if (onBehalf && actor.role !== "OWNER") {
    throw new AppError(
      HTTP_STATUS.FORBIDDEN,
      "Only the owner can record attendance on behalf of another employee."
    );
  }

  const employee = await workforceRepository.findEmployeeProfile(targetId);
  if (!employee) throw new AppError(HTTP_STATUS.NOT_FOUND, "Employee not found.");

  const now = input.at ?? new Date();
  const timeZone = storeTimeZone();
  const date = toStoreDate(now, timeZone);

  const existing = await workforceRepository.findAttendanceByEmployeeAndDate(targetId, date);
  if (existing?.clockInAt) {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      "Already clocked in for today.",
      { attendanceId: existing.id, clockInAt: existing.clockInAt }
    );
  }

  const shift = employee.shift;
  const computed = computeAttendance({
    clockInAt: now,
    clockOutAt: null,
    shift: shift as ShiftWindow | null,
    timeZone,
  });

  const record = await workforceRepository.upsertAttendance({
    employeeId: targetId,
    date,
    create: {
      employeeId: targetId,
      date,
      clockInAt: now,
      shiftId: shift?.id ?? null,
      shiftStartMinute: shift?.startMinute ?? null,
      shiftEndMinute: shift?.endMinute ?? null,
      status: computed.status,
      source: onBehalf ? "MANUAL" : "SYSTEM",
      lateMinutes: computed.lateMinutes,
      markedById: onBehalf ? actor.id : null,
      storeCode: employee.storeCode,
    },
    update: {
      clockInAt: now,
      status: computed.status,
      lateMinutes: computed.lateMinutes,
      ...(onBehalf ? { source: "MANUAL", markedById: actor.id } : {}),
    },
  });

  // Reuse the existing audit engine — never a parallel activity log.
  auditRepository.create({
    performedBy: actor.id,
    action: "CLOCK_IN",
    module: "EMPLOYEE",
    tableName: "attendance",
    recordId: record.id,
    newData: { employeeId: targetId, clockInAt: now, lateMinutes: computed.lateMinutes },
  });

  // A late arrival is exactly the kind of exception a manager should be told
  // about rather than have to go looking for. Wording and delivery live in
  // workforceAlerts so every workforce alert reads consistently.
  if (computed.lateMinutes > 0) {
    workforceAlerts.employeeLate({
      employeeId: targetId,
      employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
      lateMinutes: computed.lateMinutes,
      attendanceId: record.id,
    });
  }

  return record;
}

/** Closes the day and writes the DERIVED figures. */
export async function clockOut(input: ClockInput, actor: AuthenticatedUser) {
  const targetId = input.employeeId ?? actor.id;
  const onBehalf = targetId !== actor.id;

  if (onBehalf && actor.role !== "OWNER") {
    throw new AppError(
      HTTP_STATUS.FORBIDDEN,
      "Only the owner can record attendance on behalf of another employee."
    );
  }

  const employee = await workforceRepository.findEmployeeProfile(targetId);
  if (!employee) throw new AppError(HTTP_STATUS.NOT_FOUND, "Employee not found.");

  const now = input.at ?? new Date();
  const timeZone = storeTimeZone();
  const date = toStoreDate(now, timeZone);

  const existing = await workforceRepository.findAttendanceByEmployeeAndDate(targetId, date);
  if (!existing?.clockInAt) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "No clock-in recorded for today.");
  }
  if (existing.clockOutAt) {
    throw new AppError(HTTP_STATUS.CONFLICT, "Already clocked out for today.");
  }

  // Use the SNAPSHOT taken at clock-in, not the employee's current shift — the
  // shift may have been reassigned mid-day, and history must not rewrite itself.
  const shiftSnapshot: ShiftWindow | null =
    existing.shiftStartMinute !== null && existing.shiftEndMinute !== null
      ? {
          startMinute: existing.shiftStartMinute,
          endMinute: existing.shiftEndMinute,
          breakMinutes: employee.shift?.breakMinutes ?? 0,
          graceMinutes: employee.shift?.graceMinutes ?? 0,
          expectedMinutes: employee.shift?.expectedMinutes ?? 480,
        }
      : null;

  const computed = computeAttendance({
    clockInAt: existing.clockInAt,
    clockOutAt: now,
    shift: shiftSnapshot,
    timeZone,
  });

  const record = await workforceRepository.upsertAttendance({
    employeeId: targetId,
    date,
    create: {
      employeeId: targetId, date, clockOutAt: now,
      status: computed.status, source: "SYSTEM",
      workedMinutes: computed.workedMinutes,
    },
    update: {
      clockOutAt: now,
      status: computed.status,
      workedMinutes: computed.workedMinutes,
      lateMinutes: computed.lateMinutes,
      earlyExitMinutes: computed.earlyExitMinutes,
      overtimeMinutes: computed.overtimeMinutes,
      ...(onBehalf ? { source: "MANUAL", markedById: actor.id } : {}),
    },
  });

  auditRepository.create({
    performedBy: actor.id,
    action: "CLOCK_OUT",
    module: "EMPLOYEE",
    tableName: "attendance",
    recordId: record.id,
    newData: {
      employeeId: targetId,
      clockOutAt: now,
      workedMinutes: computed.workedMinutes,
      overtimeMinutes: computed.overtimeMinutes,
    },
  });

  return record;
}

/** OWNER-only manual correction of an attendance day. */
export async function upsertManualAttendance(
  input: ManualAttendanceInput,
  actor: AuthenticatedUser
) {
  if (actor.role !== "OWNER") {
    throw new AppError(HTTP_STATUS.FORBIDDEN, "Only the owner can adjust attendance.");
  }

  const employee = await workforceRepository.findEmployeeProfile(input.employeeId);
  if (!employee) throw new AppError(HTTP_STATUS.NOT_FOUND, "Employee not found.");

  const timeZone = storeTimeZone();
  const date = toStoreDate(input.date, timeZone);

  const before = await workforceRepository.findAttendanceByEmployeeAndDate(input.employeeId, date);

  // Recompute from the supplied punches so a manual entry obeys the same rules
  // as a system one — an adjusted day must not be able to claim impossible hours.
  const computed =
    input.clockInAt && input.clockOutAt
      ? computeAttendance({
          clockInAt: input.clockInAt,
          clockOutAt: input.clockOutAt,
          shift: employee.shift as ShiftWindow | null,
          timeZone,
        })
      : null;

  const status = input.status ?? computed?.status ?? "ABSENT";

  const record = await workforceRepository.upsertAttendance({
    employeeId: input.employeeId,
    date,
    create: {
      employeeId: input.employeeId,
      date,
      clockInAt: input.clockInAt ?? null,
      clockOutAt: input.clockOutAt ?? null,
      shiftId: employee.shift?.id ?? null,
      shiftStartMinute: employee.shift?.startMinute ?? null,
      shiftEndMinute: employee.shift?.endMinute ?? null,
      status,
      source: "MANUAL",
      workedMinutes: computed?.workedMinutes ?? 0,
      lateMinutes: computed?.lateMinutes ?? 0,
      earlyExitMinutes: computed?.earlyExitMinutes ?? 0,
      overtimeMinutes: computed?.overtimeMinutes ?? 0,
      notes: input.notes ?? null,
      markedById: actor.id,
      storeCode: employee.storeCode,
    },
    update: {
      clockInAt: input.clockInAt ?? null,
      clockOutAt: input.clockOutAt ?? null,
      status,
      source: "MANUAL",
      workedMinutes: computed?.workedMinutes ?? 0,
      lateMinutes: computed?.lateMinutes ?? 0,
      earlyExitMinutes: computed?.earlyExitMinutes ?? 0,
      overtimeMinutes: computed?.overtimeMinutes ?? 0,
      notes: input.notes ?? null,
      markedById: actor.id,
    },
  });

  auditRepository.create({
    performedBy: actor.id,
    action: "ATTENDANCE_ADJUSTED",
    module: "EMPLOYEE",
    tableName: "attendance",
    recordId: record.id,
    oldData: before as unknown as Record<string, unknown>,
    newData: record as unknown as Record<string, unknown>,
  });

  return record;
}

// =============================================================================
// OWNER MUTATIONS
// =============================================================================

/**
 * Updates the workforce-specific fields of an employee (shift, employment
 * status, photo, emergency contact). Core identity fields stay with the
 * existing employee.service so there is one place that owns them.
 */
export async function updateWorkforceProfile(
  id: string,
  input: UpdateWorkforceEmployeeInput,
  actor: AuthenticatedUser
) {
  if (actor.role !== "OWNER") {
    throw new AppError(HTTP_STATUS.FORBIDDEN, "Only the owner can edit employee records.");
  }

  const before = await workforceRepository.findEmployeeProfile(id);
  if (!before) throw new AppError(HTTP_STATUS.NOT_FOUND, "Employee not found.");

  // Guard: the owner account is the system's root of access. Deactivating it
  // would lock everyone out with no recovery path.
  if (before.role === "OWNER" && input.isActive === false) {
    throw new AppError(
      HTTP_STATUS.FORBIDDEN,
      "The owner account cannot be deactivated. Transfer ownership first."
    );
  }

  if (input.shiftId) {
    const shift = await workforceRepository.findShiftById(input.shiftId);
    if (!shift) throw new AppError(HTTP_STATUS.BAD_REQUEST, "Shift not found.");
  }

  const updated = await workforceRepository.updateEmployeeWorkforceFields(id, {
    ...(input.photoUrl !== undefined ? { photoUrl: input.photoUrl } : {}),
    ...(input.employmentStatus !== undefined ? { employmentStatus: input.employmentStatus } : {}),
    ...(input.shiftId !== undefined ? { shiftId: input.shiftId } : {}),
    ...(input.storeCode !== undefined ? { storeCode: input.storeCode } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    ...(input.exitDate !== undefined ? { exitDate: input.exitDate } : {}),
    ...(input.emergencyContactName !== undefined ? { emergencyContactName: input.emergencyContactName } : {}),
    ...(input.emergencyContactPhone !== undefined ? { emergencyContactPhone: input.emergencyContactPhone } : {}),
    ...(input.emergencyContactRelation !== undefined ? { emergencyContactRelation: input.emergencyContactRelation } : {}),
    ...(input.assignedRegister !== undefined ? { assignedRegister: input.assignedRegister } : {}),
    ...(input.monthlyTarget !== undefined ? { monthlyTarget: input.monthlyTarget } : {}),
  });

  // Deactivation must take effect on the NEXT request, not when a cached auth
  // context happens to expire.
  if (input.isActive !== undefined) {
    invalidateAuthContext(id);
    if (input.isActive === false) {
      await workforceRepository.closeOpenSessions(id, "FORCED");
    }
  }

  const action =
    input.isActive === false ? "EMPLOYEE_DEACTIVATED"
    : input.isActive === true ? "EMPLOYEE_REACTIVATED"
    : input.shiftId !== undefined ? "SHIFT_ASSIGNED"
    : "UPDATE";

  auditRepository.create({
    performedBy: actor.id,
    action,
    module: "EMPLOYEE",
    tableName: "employees",
    recordId: id,
    oldData: before as unknown as Record<string, unknown>,
    newData: updated as unknown as Record<string, unknown>,
  });

  return updated;
}

/**
 * OWNER-only password reset.
 *
 * Bumping refreshTokenVersion (via the existing employee repository path) plus
 * closing open sessions is what makes this a real reset: every device the
 * employee was signed in on stops working immediately.
 */
export async function resetPassword(
  id: string,
  input: ResetPasswordInput,
  actor: AuthenticatedUser
) {
  if (actor.role !== "OWNER") {
    throw new AppError(HTTP_STATUS.FORBIDDEN, "Only the owner can reset passwords.");
  }

  const target = await workforceRepository.findEmployeeProfile(id);
  if (!target) throw new AppError(HTTP_STATUS.NOT_FOUND, "Employee not found.");

  const hashed = await hashPassword(input.newPassword);

  await workforceRepository.updateEmployeeWorkforceFields(id, {
    password: hashed,
    refreshTokenVersion: { increment: 1 },
  });

  invalidateAuthContext(id);
  await workforceRepository.closeOpenSessions(id, "FORCED");

  auditRepository.create({
    performedBy: actor.id,
    action: "PASSWORD_RESET",
    module: "AUTH",
    tableName: "employees",
    recordId: id,
  });

  NotificationEngine.dispatch({
    type: "PASSWORD_RESET",
    title: "Password reset",
    message: "Your password was reset by the owner. Please log in again.",
    referenceId: id,
    referenceType: "EMPLOYEE",
    targetUserId: id,
  }).catch((err: unknown) => {
    logger.error({ err }, "[WorkforceService] Password-reset notification failed");
  });

  logger.info({ resetBy: actor.id, targetId: id }, "Employee password reset");
}

/**
 * Role change. Delegates the actual write to the existing employee.service so
 * hierarchy enforcement and uniqueness checks are not duplicated here; this
 * wrapper adds the workforce-specific audit action and session invalidation.
 */
export async function changeRole(
  id: string,
  role: EmployeeRole,
  actor: AuthenticatedUser
) {
  if (actor.role !== "OWNER") {
    throw new AppError(HTTP_STATUS.FORBIDDEN, "Only the owner can change roles.");
  }

  const before = await employeeRepository.findById(id);
  if (!before) throw new AppError(HTTP_STATUS.NOT_FOUND, "Employee not found.");

  if (before.role === "OWNER") {
    throw new AppError(
      HTTP_STATUS.FORBIDDEN,
      "The owner's role cannot be changed. Transfer ownership instead."
    );
  }

  const updated = await workforceRepository.updateEmployeeWorkforceFields(id, { role });

  // The role is embedded in the JWT, so the old token now claims a stale role.
  invalidateAuthContext(id);
  await workforceRepository.closeOpenSessions(id, "FORCED");

  auditRepository.create({
    performedBy: actor.id,
    action: "ROLE_CHANGED",
    module: "EMPLOYEE",
    tableName: "employees",
    recordId: id,
    oldData: { role: before.role },
    newData: { role },
  });

  return updated;
}

// =============================================================================
// EMPLOYEE COMPARISON (OWNER-only)
// =============================================================================

/**
 * Side-by-side comparison of two employees over one window.
 *
 * Built by calling getEmployeeSales twice rather than by writing a third
 * aggregation path: the comparison MUST agree with what each employee's own
 * drawer shows, and the only way to guarantee that is to read the same
 * function. A bespoke query here would drift the moment either changed.
 */
export async function compareEmployees(query: CompareQuery, actor: AuthenticatedUser) {
  if (actor.role !== "OWNER") {
    throw new AppError(HTTP_STATUS.FORBIDDEN, "Only the owner can compare employees.");
  }

  if (query.employeeA === query.employeeB) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Choose two different employees.");
  }

  const window = resolvePeriod(query.period, query.dateFrom, query.dateTo);

  const perQuery: PerformanceQuery = {
    period: query.period,
    ...(query.dateFrom ? { dateFrom: query.dateFrom } : {}),
    ...(query.dateTo ? { dateTo: query.dateTo } : {}),
  } as PerformanceQuery;

  const attendanceQuery = (id: string) =>
    ({
      period: query.period,
      employeeId: id,
      page: 1,
      limit: 1,
      ...(query.dateFrom ? { dateFrom: query.dateFrom } : {}),
      ...(query.dateTo ? { dateTo: query.dateTo } : {}),
    }) as AttendanceQuery;

  const [profileA, profileB, salesA, salesB, attA, attB] = await Promise.all([
    workforceRepository.findEmployeeProfile(query.employeeA),
    workforceRepository.findEmployeeProfile(query.employeeB),
    getEmployeeSales(query.employeeA, perQuery, actor),
    getEmployeeSales(query.employeeB, perQuery, actor),
    getAttendanceSummary(attendanceQuery(query.employeeA), actor),
    getAttendanceSummary(attendanceQuery(query.employeeB), actor),
  ]);

  if (!profileA || !profileB) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Employee not found.");
  }

  const side = (
    profile: NonNullable<typeof profileA>,
    sales: Awaited<ReturnType<typeof getEmployeeSales>>,
    attendance: Awaited<ReturnType<typeof getAttendanceSummary>>
  ) => {
    const returnRate =
      sales.periodTransactions > 0 ? sales.returns / sales.periodTransactions : 0;
    const discountRate =
      sales.periodRevenue + sales.discountGiven > 0
        ? sales.discountGiven / (sales.periodRevenue + sales.discountGiven)
        : 0;

    const proratedTarget = prorateMonthlyTarget(
      toNumberOrNull(profile.monthlyTarget),
      window.from,
      window.to
    );

    const score = performanceScore({
      revenue: sales.periodRevenue,
      target: proratedTarget,
      attendancePercentage: attendance.attendancePercentage,
      returnRate,
      discountRate,
    });

    return {
      id: profile.id,
      employeeCode: profile.employeeCode,
      fullName: `${profile.firstName} ${profile.lastName}`.trim(),
      role: profile.role,
      photoUrl: profile.photoUrl,

      revenue: sales.periodRevenue,
      transactions: sales.periodTransactions,
      averageBill: sales.averageBillValue,
      unitsSold: sales.unitsSold,
      returns: sales.returns,
      refundValue: sales.returnsValue,
      exchanges: sales.exchanges,
      discountGiven: sales.discountGiven,
      discountPercentage: sales.discountPercentage,

      attendancePercentage: attendance.attendancePercentage,
      workedMinutes: attendance.workedMinutes,
      overtimeMinutes: attendance.overtimeMinutes,
      lateMinutes: attendance.lateMinutes,

      targetAchievement: targetAchievement(sales.periodRevenue, proratedTarget),
      performanceScore: score.score,
    };
  };

  return {
    period: window,
    a: side(profileA, salesA, attA),
    b: side(profileB, salesB, attB),
  };
}

// =============================================================================
// SHIFTS & PERMISSIONS
// =============================================================================

export async function listShifts() {
  return workforceRepository.findShifts(false);
}

/**
 * Shift expectedMinutes is DERIVED, never accepted from the client.
 *
 * It is the denominator of every attendance percentage, so letting a caller
 * post an arbitrary value would let them make attendance look however they
 * like. Computing it from start/end/break is the single source of truth.
 */
function deriveExpectedMinutes(input: {
  startMinute: number;
  endMinute: number;
  breakMinutes: number;
}): number {
  const end =
    input.endMinute <= input.startMinute ? input.endMinute + 1440 : input.endMinute;
  return Math.max(0, end - input.startMinute - input.breakMinutes);
}

export async function createShift(input: ShiftInput, actor: AuthenticatedUser) {
  if (actor.role !== "OWNER") {
    throw new AppError(HTTP_STATUS.FORBIDDEN, "Only the owner can manage shifts.");
  }

  const shift = await workforceRepository.createShift({
    name: input.name,
    code: input.code,
    startMinute: input.startMinute,
    endMinute: input.endMinute,
    breakMinutes: input.breakMinutes,
    graceMinutes: input.graceMinutes,
    workingDays: input.workingDays,
    isActive: input.isActive,
    colorHex: input.colorHex ?? null,
    storeCode: input.storeCode ?? null,
    expectedMinutes: deriveExpectedMinutes(input),
  });

  auditRepository.create({
    performedBy: actor.id,
    action: "CREATE",
    module: "EMPLOYEE",
    tableName: "shifts",
    recordId: shift.id,
    newData: shift as unknown as Record<string, unknown>,
  });

  return shift;
}

export async function updateShift(
  id: string,
  input: UpdateShiftInput,
  actor: AuthenticatedUser
) {
  if (actor.role !== "OWNER") {
    throw new AppError(HTTP_STATUS.FORBIDDEN, "Only the owner can manage shifts.");
  }

  const before = await workforceRepository.findShiftById(id);
  if (!before) throw new AppError(HTTP_STATUS.NOT_FOUND, "Shift not found.");

  // Recompute expectedMinutes whenever any of its inputs move, using the new
  // value where supplied and the stored one otherwise.
  const touchesWindow =
    input.startMinute !== undefined ||
    input.endMinute !== undefined ||
    input.breakMinutes !== undefined;

  const expectedMinutes = touchesWindow
    ? deriveExpectedMinutes({
        startMinute: input.startMinute ?? before.startMinute,
        endMinute: input.endMinute ?? before.endMinute,
        breakMinutes: input.breakMinutes ?? before.breakMinutes,
      })
    : undefined;

  // Key-by-key for the same exactOptionalPropertyTypes reason as updateNote.
  const updated = await workforceRepository.updateShift(id, {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.code !== undefined ? { code: input.code } : {}),
    ...(input.startMinute !== undefined ? { startMinute: input.startMinute } : {}),
    ...(input.endMinute !== undefined ? { endMinute: input.endMinute } : {}),
    ...(input.breakMinutes !== undefined ? { breakMinutes: input.breakMinutes } : {}),
    ...(input.graceMinutes !== undefined ? { graceMinutes: input.graceMinutes } : {}),
    ...(input.workingDays !== undefined ? { workingDays: input.workingDays } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    ...(input.colorHex !== undefined ? { colorHex: input.colorHex } : {}),
    ...(input.storeCode !== undefined ? { storeCode: input.storeCode } : {}),
    ...(expectedMinutes !== undefined ? { expectedMinutes } : {}),
  });

  auditRepository.create({
    performedBy: actor.id,
    action: "UPDATE",
    module: "EMPLOYEE",
    tableName: "shifts",
    recordId: id,
    oldData: before as unknown as Record<string, unknown>,
    newData: updated as unknown as Record<string, unknown>,
  });

  return updated;
}

/** Bulk-assigns (or clears, with a null shiftId) a shift across employees. */
export async function assignShift(input: AssignShiftInput, actor: AuthenticatedUser) {
  if (actor.role !== "OWNER") {
    throw new AppError(HTTP_STATUS.FORBIDDEN, "Only the owner can assign shifts.");
  }

  if (input.shiftId) {
    const shift = await workforceRepository.findShiftById(input.shiftId);
    if (!shift) throw new AppError(HTTP_STATUS.BAD_REQUEST, "Shift not found.");
  }

  const count = await workforceRepository.assignShiftToEmployees(
    input.employeeIds,
    input.shiftId
  );

  auditRepository.create({
    performedBy: actor.id,
    action: "SHIFT_ASSIGNED",
    module: "EMPLOYEE",
    tableName: "employees",
    recordId: input.shiftId ?? "unassigned",
    newData: { shiftId: input.shiftId, employeeIds: input.employeeIds },
  });

  return { assigned: count, shiftId: input.shiftId };
}

/** The read-only Permissions tab. Served from the engine's matrix, not the DB. */
export async function getPermissions(id: string, actor: AuthenticatedUser) {
  const scope = scopeFor(actor);

  const employee = await workforceRepository.findEmployeeProfile(id);
  if (!employee || !scope.visibleRoles.includes(employee.role)) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Employee not found.");
  }

  return {
    employeeId: id,
    role: employee.role,
    // Only the owner may CHANGE permissions; everyone else reads them.
    editable: actor.role === "OWNER",
    permissions: permissionsForRole(employee.role),
  };
}

// =============================================================================
// EMPLOYEE NOTES — OWNER-ONLY AT EVERY ENTRY POINT
//
// The privacy requirement here is absolute: "Private notes must never be
// visible to Managers." That is enforced by a single guard used by all five
// functions rather than by five separate role checks, because five checks is
// five chances to forget one. There is deliberately no per-note visibility
// flag — the whole table is owner-only, so there is no flag to get wrong.
// =============================================================================

/** The one gate. Every note operation calls this first. */
function assertNotesAccess(actor: AuthenticatedUser): void {
  if (actor.role !== "OWNER") {
    throw new AppError(
      HTTP_STATUS.FORBIDDEN,
      "Employee notes are visible to the owner only."
    );
  }
}

export async function listNotes(employeeId: string, actor: AuthenticatedUser) {
  assertNotesAccess(actor);

  const employee = await workforceRepository.findEmployeeProfile(employeeId);
  if (!employee) throw new AppError(HTTP_STATUS.NOT_FOUND, "Employee not found.");

  const notes = await workforceRepository.findNotes(employeeId);

  return notes.map((note) => ({
    ...note,
    author: note.author
      ? {
          id: note.author.id,
          fullName: `${note.author.firstName} ${note.author.lastName}`.trim(),
          employeeCode: note.author.employeeCode,
        }
      : null,
  }));
}

export async function createNote(
  employeeId: string,
  input: CreateNoteInput,
  actor: AuthenticatedUser
) {
  assertNotesAccess(actor);

  const employee = await workforceRepository.findEmployeeProfile(employeeId);
  if (!employee) throw new AppError(HTTP_STATUS.NOT_FOUND, "Employee not found.");

  const note = await workforceRepository.createNote({
    employeeId,
    authorId: actor.id,
    category: input.category,
    body: input.body,
    isPinned: input.isPinned,
    storeCode: employee.storeCode,
  });

  // Audited like any other owner action. The BODY is deliberately not written
  // to the audit log — it would leak the private note into a table managers can
  // read, defeating the whole point of the guard above.
  auditRepository.create({
    performedBy: actor.id,
    action: "CREATE",
    module: "EMPLOYEE",
    tableName: "employee_notes",
    recordId: note.id,
    newData: { employeeId, category: input.category, isPinned: input.isPinned },
  });

  return note;
}

export async function updateNote(
  noteId: string,
  input: UpdateNoteInput,
  actor: AuthenticatedUser
) {
  assertNotesAccess(actor);

  const existing = await workforceRepository.findNoteById(noteId);
  if (!existing) throw new AppError(HTTP_STATUS.NOT_FOUND, "Note not found.");

  // Built key-by-key rather than spread: `exactOptionalPropertyTypes` makes an
  // explicitly-undefined key different from an absent one, and Prisma treats
  // the former as "write undefined" rather than "leave alone".
  const updated = await workforceRepository.updateNote(noteId, {
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.isPinned !== undefined ? { isPinned: input.isPinned } : {}),
  });

  auditRepository.create({
    performedBy: actor.id,
    action: "UPDATE",
    module: "EMPLOYEE",
    tableName: "employee_notes",
    recordId: noteId,
    newData: { category: updated.category, isPinned: updated.isPinned },
  });

  return updated;
}

export async function deleteNote(noteId: string, actor: AuthenticatedUser) {
  assertNotesAccess(actor);

  const existing = await workforceRepository.findNoteById(noteId);
  if (!existing) throw new AppError(HTTP_STATUS.NOT_FOUND, "Note not found.");

  await workforceRepository.deleteNote(noteId);

  auditRepository.create({
    performedBy: actor.id,
    action: "DELETE",
    module: "EMPLOYEE",
    tableName: "employee_notes",
    recordId: noteId,
    oldData: { employeeId: existing.employeeId, category: existing.category },
  });
}

// =============================================================================
// BREAK TRACKING
// =============================================================================

/**
 * Starts or ends a break on today's attendance row.
 *
 * `breakStartedAt` being non-null IS the open-break state — there is no
 * separate boolean to desync. Toggling is expressed as two explicit endpoints
 * rather than one toggle so a retried request cannot accidentally invert the
 * state the caller intended.
 */
export async function startBreak(input: ClockInput, actor: AuthenticatedUser) {
  const targetId = input.employeeId ?? actor.id;
  if (targetId !== actor.id && actor.role !== "OWNER") {
    throw new AppError(
      HTTP_STATUS.FORBIDDEN,
      "Only the owner can record breaks on behalf of another employee."
    );
  }

  const date = todayDate();
  const existing = await workforceRepository.findAttendanceByEmployeeAndDate(targetId, date);

  if (!existing?.clockInAt) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Clock in before starting a break.");
  }
  if (existing.clockOutAt) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "The day is already closed.");
  }
  if (existing.breakStartedAt) {
    throw new AppError(HTTP_STATUS.CONFLICT, "A break is already in progress.");
  }

  return workforceRepository.updateAttendanceBreak(existing.id, {
    breakStartedAt: input.at ?? new Date(),
  });
}

export async function endBreak(input: ClockInput, actor: AuthenticatedUser) {
  const targetId = input.employeeId ?? actor.id;
  if (targetId !== actor.id && actor.role !== "OWNER") {
    throw new AppError(
      HTTP_STATUS.FORBIDDEN,
      "Only the owner can record breaks on behalf of another employee."
    );
  }

  const date = todayDate();
  const existing = await workforceRepository.findAttendanceByEmployeeAndDate(targetId, date);

  if (!existing?.breakStartedAt) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "No break is in progress.");
  }

  // Accumulate rather than overwrite — several breaks a day is normal.
  const total = closeBreak({
    accumulatedMinutes: existing.breakMinutes,
    breakStartedAt: existing.breakStartedAt,
    at: input.at ?? new Date(),
  });

  return workforceRepository.updateAttendanceBreak(existing.id, {
    breakMinutes: total,
    breakStartedAt: null,
  });
}

// =============================================================================
// SECURITY DASHBOARD (Login History page)
// =============================================================================

/**
 * Counters + failed-attempt groups for the security view.
 *
 * Scoped the same way the login history list is: a manager sees only their
 * operational team's sessions, never the owner's.
 */
export async function getSecurityOverview(
  query: SecurityQuery,
  actor: AuthenticatedUser
) {
  const scope = scopeFor(actor);
  const window = resolvePeriod(query.period, query.dateFrom, query.dateTo);

  let employeeIds: string[] | undefined;
  if (actor.role !== "OWNER") {
    const visible = await workforceRepository.findRosterIds({
      page: 1, limit: 1000, roles: scope.visibleRoles,
      sortBy: "firstName", sortOrder: "asc",
    });
    employeeIds = visible.map((v) => v.id);
  }

  const [stats, failures] = await Promise.all([
    workforceRepository.loginSecurityStats({
      employeeIds,
      since: window.from,
      presenceThresholdMinutes: PRESENCE_THRESHOLD_MINUTES,
    }),
    workforceRepository.failedLoginAttempts({
      employeeIds,
      since: window.from,
      limit: query.limit,
    }),
  ]);

  return {
    period: window,
    ...stats,
    failedAttempts: failures.map((f) => ({
      employeeId: f.employeeId,
      fullName: f.fullName,
      employeeCode: f.employeeCode,
      ipAddress: f.ipAddress,
      reason: f.failureReason,
      attempts: Number(f.attempts),
      lastAttemptAt: f.lastAttemptAt,
      // Repeated failures from one source is the pattern worth surfacing; the
      // threshold matches what a lockout policy would use.
      isSuspicious: Number(f.attempts) >= 5,
    })),
  };
}

/**
 * OWNER-only force-termination of a single session.
 *
 * Deliberately narrower than closeOpenSessions (which ends EVERY session for an
 * employee and is what password-reset uses): the security dashboard revokes one
 * suspicious device without signing the person out of the till they are working.
 */
export async function terminateSession(sessionId: string, actor: AuthenticatedUser) {
  if (actor.role !== "OWNER") {
    throw new AppError(HTTP_STATUS.FORBIDDEN, "Only the owner can terminate sessions.");
  }

  const session = await workforceRepository.findSessionById(sessionId);
  if (!session) throw new AppError(HTTP_STATUS.NOT_FOUND, "Session not found.");

  if (session.logoutAt) {
    throw new AppError(HTTP_STATUS.CONFLICT, "That session has already ended.");
  }

  const terminated = await workforceRepository.terminateSession(sessionId, actor.id);
  if (!terminated) {
    throw new AppError(HTTP_STATUS.CONFLICT, "That session has already ended.");
  }

  // The token must stop working on the NEXT request, not whenever a cached auth
  // context happens to expire — otherwise "terminate" is advisory.
  invalidateAuthContext(session.employeeId);

  auditRepository.create({
    performedBy: actor.id,
    action: "LOGOUT",
    module: "AUTH",
    tableName: "login_history",
    recordId: sessionId,
    newData: { employeeId: session.employeeId, endReason: "TERMINATED" },
  });

  logger.info(
    { terminatedBy: actor.id, employeeId: session.employeeId, sessionId },
    "Session force-terminated by owner"
  );

  return { sessionId, employeeId: session.employeeId };
}

/** OWNER-only: end every session for one employee ("force logout"). */
export async function forceLogout(employeeId: string, actor: AuthenticatedUser) {
  if (actor.role !== "OWNER") {
    throw new AppError(HTTP_STATUS.FORBIDDEN, "Only the owner can force a logout.");
  }

  const employee = await workforceRepository.findEmployeeProfile(employeeId);
  if (!employee) throw new AppError(HTTP_STATUS.NOT_FOUND, "Employee not found.");

  await workforceRepository.closeOpenSessions(employeeId, "TERMINATED");
  invalidateAuthContext(employeeId);
  resetHeartbeat(employeeId);

  auditRepository.create({
    performedBy: actor.id,
    action: "LOGOUT",
    module: "AUTH",
    tableName: "employees",
    recordId: employeeId,
    newData: { endReason: "TERMINATED", scope: "ALL_SESSIONS" },
  });

  return { employeeId };
}

// =============================================================================
// SESSION TRACKING — called by the auth module
// =============================================================================

/**
 * Records a login. Called by auth.service on every attempt, successful or not:
 * failed attempts are precisely what a security review needs to see.
 */
export async function recordLogin(params: {
  employeeId: string;
  ipAddress: string | null;
  userAgent: string | null;
  isSuccessful: boolean;
  failureReason?: string | null;
}) {
  const parsed = parseUserAgent(params.userAgent);

  // A burst of failures from one source is the security signal worth waking
  // someone for. Checked only on FAILURE so a normal login pays nothing, and
  // fire-and-forget so a slow count can never delay the auth response.
  if (!params.isSuccessful) {
    void raiseFailedLoginAlert(params.employeeId, params.ipAddress);
  }

  return workforceRepository.createLoginSession({
    employeeId: params.employeeId,
    device: parsed.device,
    browser: parsed.browser,
    // Parsed once at write time so the security table can filter and group by
    // OS in SQL rather than re-parsing a UA string per row on every read.
    operatingSystem: parseOperatingSystem(params.userAgent),
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    isSuccessful: params.isSuccessful,
    failureReason: params.failureReason ?? null,
  });
}

/**
 * Alerts when failed attempts for one employee cross the threshold.
 *
 * Fires only ON the threshold, not above it: alerting at 5, 6, 7… would turn a
 * single brute-force attempt into a notification flood that hides the signal it
 * exists to raise.
 */
async function raiseFailedLoginAlert(
  employeeId: string,
  ipAddress: string | null
): Promise<void> {
  try {
    const since = new Date(Date.now() - 60 * 60_000);
    const attempts = await workforceRepository.failedLoginAttempts({
      employeeIds: [employeeId],
      since,
      limit: 5,
    });

    // The row for THIS source; +1 because the current attempt is not written yet.
    const forThisIp = attempts.find((a) => a.ipAddress === ipAddress);
    const count = Number(forThisIp?.attempts ?? 0) + 1;

    if (count !== ALERT_THRESHOLD_FAILED_LOGINS) return;

    const employee = await workforceRepository.findEmployeeProfile(employeeId);
    if (!employee) return;

    workforceAlerts.multipleFailedLogins({
      employeeId,
      employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
      attempts: count,
      ipAddress,
    });
  } catch (err) {
    // Never let alerting break a login path — including a failing one.
    logger.error({ err, employeeId }, "[WorkforceService] Failed-login alert check failed");
  }
}

const ALERT_THRESHOLD_FAILED_LOGINS = workforceAlerts.ALERT_THRESHOLDS.failedLogins;

export async function recordLogout(employeeId: string, reason = "MANUAL") {
  await workforceRepository.closeOpenSessions(employeeId, reason);
  // Drop the throttle slot so the next login's first request beats immediately
  // instead of waiting out the previous session's interval.
  resetHeartbeat(employeeId);
}

export async function touchSession(employeeId: string) {
  await workforceRepository.touchSession(employeeId);
}

/**
 * Minimal UA parsing — enough to fill the Device/Browser columns without
 * adding a dependency. The raw string is stored alongside, so a richer parser
 * can be swapped in later without losing any historical evidence.
 */
function parseUserAgent(ua: string | null): { device: string | null; browser: string | null } {
  if (!ua) return { device: null, browser: null };

  const device =
    /iPad|Tablet/i.test(ua) ? "Tablet"
    : /Mobile|Android|iPhone/i.test(ua) ? "Mobile"
    : "Desktop";

  // Order matters: Edge and Opera both contain "Chrome" in their UA strings,
  // and Chrome contains "Safari". Most specific first.
  const browser =
    /Edg\//i.test(ua) ? "Edge"
    : /OPR\//i.test(ua) ? "Opera"
    : /Firefox\//i.test(ua) ? "Firefox"
    : /Chrome\//i.test(ua) ? "Chrome"
    : /Safari\//i.test(ua) ? "Safari"
    : "Unknown";

  return { device, browser };
}

// Re-exported so the auth module can compute a display string without importing
// the engine directly.
export { toStoreMinutes };
