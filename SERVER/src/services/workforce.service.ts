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
import { employeeRepository } from "../repositories/employee.repository";
import { invalidateAuthContext } from "../utils/authContextCache";
import { resetHeartbeat } from "../utils/presenceHeartbeat";
import { hashPassword } from "../utils/hash";
import {
  PRESENCE_THRESHOLD_MINUTES,
  attendancePercentage,
  computeAttendance,
  derivePresence,
  describeActivity,
  activityCategory,
  permissionsForRole,
  toStoreDate,
  toStoreMinutes,
  type ShiftWindow,
} from "../engines/workforce.engine";
import type { AuthenticatedUser } from "../types/employee.types";
import type { PaginatedResponse } from "../types/common.types";
import type {
  ActivityQuery,
  AttendanceQuery,
  ClockInput,
  LoginHistoryQuery,
  ManualAttendanceInput,
  PerformanceQuery,
  ResetPasswordInput,
  RosterQuery,
  UpdateWorkforceEmployeeInput,
} from "../validation/workforce.validation";
import type { AttendanceStatus, EmployeeRole } from "../../generated/prisma";

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

  const [sessions, attendanceToday, salesToday, lastActivity, attendanceWindow] =
    await Promise.all([
      workforceRepository.findOpenSessions(ids),
      workforceRepository.findAttendanceForDate(ids, today),
      workforceRepository.groupSalesByEmployee(ids, dayFrom, dayTo),
      workforceRepository.findLastActivity(ids),
      workforceRepository.groupAttendanceByEmployeeAndStatus(ids, windowFrom, dayTo),
    ]);

  // Index every aggregate by employeeId so the join below is O(1) per row.
  const sessionBy = new Map(sessions.map((s) => [s.employeeId, s]));
  const attendanceBy = new Map(attendanceToday.map((a) => [a.employeeId, a]));
  const salesBy = new Map(salesToday.map((s) => [s.employeeId, s]));
  const activityBy = new Map(lastActivity.map((a) => [a.employeeId, a]));

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

      attendancePercentage: attendancePercentage(attendanceCounts.get(row.id) ?? {}),
      workedMinutes: workedMinutesBy.get(row.id) ?? 0,
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

  const [byRole, byStatus, attendanceToday, onlineCount] = await Promise.all([
    workforceRepository.countByRole({ role: { in: scope.visibleRoles }, isActive: true }),
    workforceRepository.countByEmploymentStatus({ role: { in: scope.visibleRoles } }),
    workforceRepository.groupAttendanceByStatus(today),
    workforceRepository.countOnline(PRESENCE_THRESHOLD_MINUTES),
  ]);

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

  const [todaySales, weekSales, monthSales, periodSales, units, exchanges, returns, trend] =
    await Promise.all([
      workforceRepository.groupSalesByEmployee([id], dayWindow.from, dayWindow.to),
      workforceRepository.groupSalesByEmployee([id], weekFrom, dayWindow.to),
      workforceRepository.groupSalesByEmployee([id], monthFrom, dayWindow.to),
      workforceRepository.groupSalesByEmployee([id], custom.from, custom.to),
      workforceRepository.sumUnitsByEmployee([id], custom.from, custom.to),
      workforceRepository.groupExchangesByEmployee([id], custom.from, custom.to),
      workforceRepository.groupReturnsByEmployee([id], custom.from, custom.to),
      workforceRepository.salesTrendByEmployee([id], custom.from, custom.to),
    ]);

  const revenueOf = (rows: typeof todaySales) => toNumber(rows[0]?._sum.grandTotal);
  const countOf = (rows: typeof todaySales) => rows[0]?._count._all ?? 0;

  const periodRevenue = revenueOf(periodSales);
  const periodTransactions = countOf(periodSales);

  const discountGiven =
    toNumber(periodSales[0]?._sum.discountAmount) +
    toNumber(periodSales[0]?._sum.manualDiscountAmount);

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
      returns: returnBy.get(emp.id)?._count._all ?? 0,
      refundValue: toNumber(returnBy.get(emp.id)?._sum.grandTotal),
      exchanges: exchangeBy.get(emp.id)?._count._all ?? 0,
      discountGiven: discount,
      discountPercentage: revenue + discount > 0 ? (discount / (revenue + discount)) * 100 : 0,
      attendancePercentage: attendancePercentage(attendanceCounts.get(emp.id) ?? {}),
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
    ipAddress: row.ipAddress,
    isSuccessful: row.isSuccessful,
    failureReason: row.failureReason,
    endReason: row.endReason,
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
  // about rather than have to go looking for.
  if (computed.lateMinutes > 0) {
    NotificationEngine.dispatch({
      type: "ATTENDANCE_LATE",
      title: "Late arrival",
      message: `${employee.firstName} ${employee.lastName} clocked in ${computed.lateMinutes} minutes late.`,
      referenceId: record.id,
      referenceType: "ATTENDANCE",
      targetRole: "OWNER",
    }).catch((err: unknown) => {
      logger.error({ err }, "[WorkforceService] Late-arrival notification failed");
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
// SHIFTS & PERMISSIONS (read-only surfaces)
// =============================================================================

export async function listShifts() {
  return workforceRepository.findShifts(false);
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

  return workforceRepository.createLoginSession({
    employeeId: params.employeeId,
    device: parsed.device,
    browser: parsed.browser,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    isSuccessful: params.isSuccessful,
    failureReason: params.failureReason ?? null,
  });
}

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
