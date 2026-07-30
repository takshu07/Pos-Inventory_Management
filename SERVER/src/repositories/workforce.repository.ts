// =============================================================================
// WORKFORCE REPOSITORY
//
// Sole owner of every Prisma call the Workforce module makes. No business
// logic lives here — the arithmetic is in workforce.engine, the orchestration
// and RBAC scoping in workforce.service.
//
// Design decisions worth stating:
//   1. The roster query fans out its aggregates (sales, attendance, presence,
//      last activity) as SEPARATE batched queries keyed by the page's employee
//      ids, rather than as per-row subqueries. Against a network-latency-bound
//      Postgres (Neon), N+1 is the dominant cost; this makes a 50-row page a
//      fixed ~6 round-trips instead of ~200.
//   2. Every list is server-side paginated. Nothing here returns an unbounded
//      set.
//   3. `groupBy` is preferred over raw SQL wherever Prisma can express the
//      aggregate, so the queries stay type-checked against the schema.
//   4. Raw SQL uses LOWERCASE table names — the models are @@map'd, so
//      "Employee" does not exist as a relation in Postgres.
// =============================================================================

import { Prisma } from "../../generated/prisma";
import type {
  ActionModule,
  ActionType,
  AttendanceStatus,
  EmployeeNoteCategory,
  EmployeeRole,
  EmploymentStatus,
} from "../../generated/prisma";
import { prisma } from "../config/prisma";

// =============================================================================
// SELECTS
// Explicit everywhere — a repository never issues SELECT *.
// =============================================================================

/**
 * The roster row. Deliberately excludes `salary`: the roster is a monitoring
 * surface a MANAGER can read, and compensation is not theirs to see. The owner
 * detail endpoint adds it back explicitly.
 */
const ROSTER_SELECT = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  role: true,
  photoUrl: true,
  isActive: true,
  employmentStatus: true,
  joiningDate: true,
  lastLogin: true,
  storeCode: true,
  shiftId: true,
  // Enterprise upgrade: the roster tables surface the assigned till and the
  // target. `monthlyTarget` is compensation-adjacent but not compensation —
  // it is an operational goal a manager legitimately needs to see.
  assignedRegister: true,
  monthlyTarget: true,
  shift: {
    select: {
      id: true,
      name: true,
      code: true,
      startMinute: true,
      endMinute: true,
      breakMinutes: true,
      graceMinutes: true,
      expectedMinutes: true,
      colorHex: true,
    },
  },
} as const;

/** Full profile for the drawer Overview tab. Owner-only fields are gated in the service. */
const PROFILE_SELECT = {
  ...ROSTER_SELECT,
  gender: true,
  address: true,
  dateOfBirth: true,
  salary: true,
  exitDate: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  emergencyContactRelation: true,
  createdAt: true,
  updatedAt: true,
} as const;

const SHIFT_SELECT = {
  id: true,
  name: true,
  code: true,
  startMinute: true,
  endMinute: true,
  breakMinutes: true,
  graceMinutes: true,
  expectedMinutes: true,
  workingDays: true,
  colorHex: true,
  isActive: true,
} as const;

export type RosterRow = Prisma.EmployeeGetPayload<{ select: typeof ROSTER_SELECT }>;
export type EmployeeProfileRow = Prisma.EmployeeGetPayload<{ select: typeof PROFILE_SELECT }>;

// =============================================================================
// ROSTER
// =============================================================================

export interface RosterFilters {
  page: number;
  limit: number;
  search?: string | undefined;
  role?: EmployeeRole | undefined;
  roles?: EmployeeRole[] | undefined;
  isActive?: boolean | undefined;
  employmentStatus?: string | undefined;
  shiftId?: string | undefined;
  storeCode?: string | undefined;
  joinedFrom?: Date | undefined;
  joinedTo?: Date | undefined;
  sortBy: string;
  sortOrder: "asc" | "desc";
}

/**
 * Builds the WHERE clause shared by the roster list and its count.
 * Extracted so the two can never drift apart and report inconsistent totals.
 */
function buildRosterWhere(filters: RosterFilters): Prisma.EmployeeWhereInput {
  const where: Prisma.EmployeeWhereInput = {};

  if (filters.roles?.length) where.role = { in: filters.roles };
  else if (filters.role) where.role = filters.role;

  if (filters.isActive !== undefined) where.isActive = filters.isActive;
  if (filters.employmentStatus) {
    where.employmentStatus = filters.employmentStatus as EmploymentStatus;
  }
  if (filters.shiftId) where.shiftId = filters.shiftId;
  if (filters.storeCode) where.storeCode = filters.storeCode;

  if (filters.joinedFrom || filters.joinedTo) {
    where.joiningDate = {
      ...(filters.joinedFrom ? { gte: filters.joinedFrom } : {}),
      ...(filters.joinedTo ? { lte: filters.joinedTo } : {}),
    };
  }

  if (filters.search) {
    const term = filters.search.trim();
    where.OR = [
      { firstName: { contains: term, mode: "insensitive" } },
      { lastName: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } },
      { phone: { contains: term } },
      { employeeCode: { contains: term, mode: "insensitive" } },
    ];
  }

  return where;
}

/**
 * Sort fields that map directly to an Employee column. Computed sorts
 * (revenue, transactions, attendance %) cannot be expressed here because the
 * value lives in another table; the service sorts those in-page after the
 * aggregates are attached, which is correct because the page is already bounded.
 */
const DB_SORTABLE = new Set([
  "firstName", "lastName", "createdAt", "joiningDate", "role",
  "employeeCode", "lastLogin", "employmentStatus",
]);

async function findRoster(filters: RosterFilters) {
  const where = buildRosterWhere(filters);
  const skip = (filters.page - 1) * filters.limit;

  const orderBy: Prisma.EmployeeOrderByWithRelationInput = DB_SORTABLE.has(filters.sortBy)
    ? { [filters.sortBy]: filters.sortOrder }
    : { firstName: "asc" };

  const [total, data] = await prisma.$transaction([
    prisma.employee.count({ where }),
    prisma.employee.findMany({
      where,
      select: ROSTER_SELECT,
      skip,
      take: filters.limit,
      orderBy,
    }),
  ]);

  return { total, data };
}

/**
 * Full roster ids matching the filters, WITHOUT pagination.
 *
 * Needed only by the computed-sort path (sort by revenue / attendance), where
 * ranking must consider every matching employee, not just the current page.
 * Capped so a pathological filter cannot pull an unbounded set into memory —
 * a retail workforce is hundreds, not millions.
 */
async function findRosterIds(filters: RosterFilters, cap = 1000) {
  return prisma.employee.findMany({
    where: buildRosterWhere(filters),
    select: { id: true },
    take: cap,
  });
}

async function findEmployeeProfile(id: string) {
  return prisma.employee.findUnique({
    where: { id },
    select: PROFILE_SELECT,
  });
}

/** Headcount grouped by role — powers the dashboard summary cards. */
async function countByRole(where: Prisma.EmployeeWhereInput = {}) {
  return prisma.employee.groupBy({
    by: ["role"],
    where,
    _count: { _all: true },
  });
}

async function countByEmploymentStatus(where: Prisma.EmployeeWhereInput = {}) {
  return prisma.employee.groupBy({
    by: ["employmentStatus"],
    where,
    _count: { _all: true },
  });
}

// =============================================================================
// PRESENCE — derived from open sessions, never a stored boolean.
// =============================================================================

/**
 * The most recent OPEN session per employee, for the ids given.
 *
 * DISTINCT ON is the right tool: it returns the newest row per employee in a
 * single index-ordered pass, where a GROUP BY + self-join would need two.
 * Raw SQL is unavoidable because Prisma cannot express DISTINCT ON.
 * Table name is lowercase — the model is @@map'd to "login_history".
 */
async function findOpenSessions(employeeIds: string[]) {
  if (employeeIds.length === 0) return [];

  return prisma.$queryRaw<
    Array<{
      employeeId: string;
      loginAt: Date;
      logoutAt: Date | null;
      lastSeenAt: Date | null;
      device: string | null;
      browser: string | null;
      ipAddress: string | null;
    }>
  >`
    SELECT DISTINCT ON ("employeeId")
      "employeeId", "loginAt", "logoutAt", "lastSeenAt", "device", "browser", "ipAddress"
    FROM "login_history"
    WHERE "employeeId" IN (${Prisma.join(employeeIds)})
      AND "isSuccessful" = true
      AND "logoutAt" IS NULL
    ORDER BY "employeeId", "loginAt" DESC
  `;
}

/** Count of employees currently holding an open, recently-active session. */
async function countOnline(thresholdMinutes: number, where?: { role?: EmployeeRole }) {
  const cutoff = new Date(Date.now() - thresholdMinutes * 60_000);

  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(DISTINCT lh."employeeId")::bigint AS count
    FROM "login_history" lh
    INNER JOIN "employees" e ON e."id" = lh."employeeId"
    WHERE lh."logoutAt" IS NULL
      AND lh."isSuccessful" = true
      AND COALESCE(lh."lastSeenAt", lh."loginAt") >= ${cutoff}
      AND e."isActive" = true
      ${where?.role ? Prisma.sql`AND e."role" = ${where.role}::"EmployeeRole"` : Prisma.empty}
  `;

  return Number(rows[0]?.count ?? 0);
}

// =============================================================================
// LOGIN HISTORY / SESSIONS
// =============================================================================

const LOGIN_HISTORY_SELECT = {
  id: true,
  employeeId: true,
  loginAt: true,
  logoutAt: true,
  device: true,
  browser: true,
  ipAddress: true,
  userAgent: true,
  isSuccessful: true,
  lastSeenAt: true,
  durationMinutes: true,
  endReason: true,
  failureReason: true,
  operatingSystem: true,
  terminatedById: true,
} as const;

export interface LoginHistoryFilters {
  page: number;
  limit: number;
  employeeId?: string | undefined;
  employeeIds?: string[] | undefined;
  search?: string | undefined;
  isSuccessful?: boolean | undefined;
  activeOnly?: boolean | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
}

async function findLoginHistory(filters: LoginHistoryFilters) {
  const where: Prisma.LoginHistoryWhereInput = {};

  if (filters.employeeId) where.employeeId = filters.employeeId;
  else if (filters.employeeIds) where.employeeId = { in: filters.employeeIds };

  if (filters.isSuccessful !== undefined) where.isSuccessful = filters.isSuccessful;
  if (filters.activeOnly) where.logoutAt = null;

  if (filters.dateFrom || filters.dateTo) {
    where.loginAt = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }

  if (filters.search) {
    const term = filters.search.trim();
    where.OR = [
      { ipAddress: { contains: term, mode: "insensitive" } },
      { device: { contains: term, mode: "insensitive" } },
      { browser: { contains: term, mode: "insensitive" } },
      { employee: { firstName: { contains: term, mode: "insensitive" } } },
      { employee: { lastName: { contains: term, mode: "insensitive" } } },
      { employee: { employeeCode: { contains: term, mode: "insensitive" } } },
    ];
  }

  const skip = (filters.page - 1) * filters.limit;

  const [total, data] = await prisma.$transaction([
    prisma.loginHistory.count({ where }),
    prisma.loginHistory.findMany({
      where,
      select: {
        ...LOGIN_HISTORY_SELECT,
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true, role: true, photoUrl: true },
        },
      },
      skip,
      take: filters.limit,
      orderBy: { loginAt: "desc" },
    }),
  ]);

  return { total, data };
}

/** Opens a session row at login. Returns the id so logout can close this exact session. */
async function createLoginSession(data: {
  employeeId: string;
  device: string | null;
  browser: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  operatingSystem?: string | null;
  isSuccessful: boolean;
  failureReason?: string | null;
  storeCode?: string | null;
}) {
  return prisma.loginHistory.create({
    data: {
      employeeId: data.employeeId,
      device: data.device,
      browser: data.browser,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      operatingSystem: data.operatingSystem ?? null,
      isSuccessful: data.isSuccessful,
      failureReason: data.failureReason ?? null,
      storeCode: data.storeCode ?? null,
      lastSeenAt: data.isSuccessful ? new Date() : null,
    },
    select: { id: true, loginAt: true },
  });
}

/**
 * Closes the employee's open session(s).
 *
 * updateMany (not update) is deliberate: if a previous session was never closed
 * — a killed process, a lost tab — leaving it open would keep the employee
 * permanently "online". Closing all of them on any logout is self-healing.
 */
async function closeOpenSessions(
  employeeId: string,
  endReason: string,
  now: Date = new Date()
) {
  // durationMinutes needs per-row arithmetic against that row's loginAt, which
  // updateMany cannot express — hence raw SQL for the one field.
  await prisma.$executeRaw`
    UPDATE "login_history"
    SET "logoutAt" = ${now},
        "endReason" = ${endReason},
        "durationMinutes" = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (${now}::timestamp - "loginAt")) / 60)::int)
    WHERE "employeeId" = ${employeeId}
      AND "logoutAt" IS NULL
      AND "isSuccessful" = true
  `;
}

/** Heartbeat. Fire-and-forget from the auth middleware — never blocks a request. */
async function touchSession(employeeId: string, now: Date = new Date()) {
  await prisma.loginHistory.updateMany({
    where: { employeeId, logoutAt: null, isSuccessful: true },
    data: { lastSeenAt: now },
  });
}

// =============================================================================
// ACTIVITY — reads the EXISTING EmployeeAction table. No parallel activity log.
// =============================================================================

export interface ActivityFilters {
  page: number;
  limit: number;
  employeeId?: string | undefined;
  employeeIds?: string[] | undefined;
  actionType?: ActionType | undefined;
  module?: ActionModule | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
}

async function findActivity(filters: ActivityFilters) {
  const where: Prisma.EmployeeActionWhereInput = {};

  if (filters.employeeId) where.employeeId = filters.employeeId;
  else if (filters.employeeIds) where.employeeId = { in: filters.employeeIds };

  if (filters.actionType) where.actionType = filters.actionType;
  if (filters.module) where.module = filters.module;

  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }

  const skip = (filters.page - 1) * filters.limit;

  const [total, data] = await prisma.$transaction([
    prisma.employeeAction.count({ where }),
    prisma.employeeAction.findMany({
      where,
      select: {
        id: true,
        employeeId: true,
        actionType: true,
        module: true,
        description: true,
        referenceType: true,
        referenceId: true,
        createdAt: true,
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true, role: true, photoUrl: true },
        },
      },
      skip,
      take: filters.limit,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return { total, data };
}

/** Timestamp of each employee's most recent action — the "current activity" column. */
async function findLastActivity(employeeIds: string[]) {
  if (employeeIds.length === 0) return [];

  return prisma.$queryRaw<
    Array<{
      employeeId: string;
      actionType: ActionType;
      module: ActionModule;
      description: string | null;
      createdAt: Date;
    }>
  >`
    SELECT DISTINCT ON ("employeeId")
      "employeeId", "actionType", "module", "description", "createdAt"
    FROM "employee_actions"
    WHERE "employeeId" IN (${Prisma.join(employeeIds)})
    ORDER BY "employeeId", "createdAt" DESC
  `;
}

/** Activity-type distribution for the analytics charts. */
async function groupActivityByType(filters: {
  employeeIds?: string[] | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
}) {
  const where: Prisma.EmployeeActionWhereInput = {};
  if (filters.employeeIds) where.employeeId = { in: filters.employeeIds };
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }

  return prisma.employeeAction.groupBy({
    by: ["actionType"],
    where,
    _count: { _all: true },
    orderBy: { _count: { actionType: "desc" } },
  });
}

/**
 * Activity counts grouped by (actionType, module).
 *
 * The module half is what makes "customers added" countable at all: creating a
 * customer is a generic CREATE, and only the module distinguishes it from
 * creating a product. Grouping by actionType alone cannot express that.
 */
async function groupActivityByTypeAndModule(filters: {
  employeeIds?: string[] | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
}) {
  const where: Prisma.EmployeeActionWhereInput = {};
  if (filters.employeeIds) where.employeeId = { in: filters.employeeIds };
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }

  return prisma.employeeAction.groupBy({
    by: ["actionType", "module"],
    where,
    _count: { _all: true },
  });
}

// =============================================================================
// ATTENDANCE
// =============================================================================

export interface AttendanceFilters {
  page: number;
  limit: number;
  employeeId?: string | undefined;
  employeeIds?: string[] | undefined;
  status?: AttendanceStatus | undefined;
  shiftId?: string | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
  search?: string | undefined;
}

function buildAttendanceWhere(filters: AttendanceFilters): Prisma.AttendanceWhereInput {
  const where: Prisma.AttendanceWhereInput = {};

  if (filters.employeeId) where.employeeId = filters.employeeId;
  else if (filters.employeeIds) where.employeeId = { in: filters.employeeIds };

  if (filters.status) where.status = filters.status;
  if (filters.shiftId) where.shiftId = filters.shiftId;

  if (filters.dateFrom || filters.dateTo) {
    where.date = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }

  if (filters.search) {
    const term = filters.search.trim();
    where.employee = {
      OR: [
        { firstName: { contains: term, mode: "insensitive" } },
        { lastName: { contains: term, mode: "insensitive" } },
        { employeeCode: { contains: term, mode: "insensitive" } },
      ],
    };
  }

  return where;
}

async function findAttendance(filters: AttendanceFilters) {
  const where = buildAttendanceWhere(filters);
  const skip = (filters.page - 1) * filters.limit;

  const [total, data] = await prisma.$transaction([
    prisma.attendance.count({ where }),
    prisma.attendance.findMany({
      where,
      select: {
        id: true,
        employeeId: true,
        date: true,
        clockInAt: true,
        clockOutAt: true,
        status: true,
        source: true,
        workedMinutes: true,
        lateMinutes: true,
        earlyExitMinutes: true,
        overtimeMinutes: true,
        breakMinutes: true,
        breakStartedAt: true,
        notes: true,
        shiftId: true,
        shiftStartMinute: true,
        shiftEndMinute: true,
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true, role: true, photoUrl: true },
        },
        shift: { select: { id: true, name: true, code: true, colorHex: true } },
      },
      skip,
      take: filters.limit,
      orderBy: [{ date: "desc" }, { clockInAt: "desc" }],
    }),
  ]);

  return { total, data };
}

/** Today's attendance row for a set of employees — the roster's status column. */
async function findAttendanceForDate(employeeIds: string[], date: Date) {
  if (employeeIds.length === 0) return [];

  return prisma.attendance.findMany({
    where: { employeeId: { in: employeeIds }, date },
    select: {
      employeeId: true,
      status: true,
      clockInAt: true,
      clockOutAt: true,
      workedMinutes: true,
      lateMinutes: true,
    },
  });
}

/** Status counts over a window, per employee — the attendance % denominator. */
async function groupAttendanceByEmployeeAndStatus(
  employeeIds: string[],
  dateFrom: Date,
  dateTo: Date
) {
  if (employeeIds.length === 0) return [];

  return prisma.attendance.groupBy({
    by: ["employeeId", "status"],
    where: { employeeId: { in: employeeIds }, date: { gte: dateFrom, lte: dateTo } },
    _count: { _all: true },
    _sum: { workedMinutes: true, lateMinutes: true, overtimeMinutes: true },
  });
}

/** Store-wide status counts for a single date — the dashboard cards. */
async function groupAttendanceByStatus(date: Date, employeeIds?: string[]) {
  return prisma.attendance.groupBy({
    by: ["status"],
    where: {
      date,
      ...(employeeIds ? { employeeId: { in: employeeIds } } : {}),
    },
    _count: { _all: true },
  });
}

/** Daily trend for the attendance chart — one row per (date, status). */
async function attendanceTrend(dateFrom: Date, dateTo: Date, employeeIds?: string[]) {
  return prisma.attendance.groupBy({
    by: ["date", "status"],
    where: {
      date: { gte: dateFrom, lte: dateTo },
      ...(employeeIds ? { employeeId: { in: employeeIds } } : {}),
    },
    _count: { _all: true },
    _sum: { workedMinutes: true },
    orderBy: { date: "asc" },
  });
}

async function findAttendanceByEmployeeAndDate(employeeId: string, date: Date) {
  return prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId, date } },
  });
}

async function upsertAttendance(params: {
  employeeId: string;
  date: Date;
  create: Prisma.AttendanceUncheckedCreateInput;
  update: Prisma.AttendanceUncheckedUpdateInput;
}) {
  return prisma.attendance.upsert({
    where: { employeeId_date: { employeeId: params.employeeId, date: params.date } },
    create: params.create,
    update: params.update,
  });
}

// =============================================================================
// PERFORMANCE — reads the EXISTING sales/exchange tables. No duplicated totals.
// =============================================================================

/**
 * Per-employee sales aggregates over a window.
 *
 * groupBy on the indexed (status, saleDate) pair means this is one query for
 * the whole page, not one per employee.
 */
async function groupSalesByEmployee(
  employeeIds: string[],
  dateFrom: Date,
  dateTo: Date
) {
  if (employeeIds.length === 0) return [];

  return prisma.sale.groupBy({
    by: ["employeeId"],
    where: {
      employeeId: { in: employeeIds },
      status: "COMPLETED",
      saleDate: { gte: dateFrom, lte: dateTo },
    },
    _sum: { grandTotal: true, discountAmount: true, manualDiscountAmount: true },
    _count: { _all: true },
    _avg: { grandTotal: true },
  });
}

/** Units sold per employee — needs the item join, so it is its own query. */
async function sumUnitsByEmployee(
  employeeIds: string[],
  dateFrom: Date,
  dateTo: Date
) {
  if (employeeIds.length === 0) return [];

  return prisma.$queryRaw<Array<{ employeeId: string; units: bigint }>>`
    SELECT s."employeeId", COALESCE(SUM(si."quantity"), 0)::bigint AS units
    FROM "sales" s
    INNER JOIN "sale_items" si ON si."saleId" = s."id"
    WHERE s."employeeId" IN (${Prisma.join(employeeIds)})
      AND s."status" = 'COMPLETED'
      AND s."saleDate" >= ${dateFrom}
      AND s."saleDate" <= ${dateTo}
    GROUP BY s."employeeId"
  `;
}

/**
 * The category an employee sells most of, by units, in a window.
 *
 * DISTINCT ON returns just the top row per employee in one index-ordered pass;
 * the alternative (fetch every category per employee, sort in JS) would move
 * the whole sales history over the wire to read one label off it.
 */
async function topCategoryByEmployee(
  employeeIds: string[],
  dateFrom: Date,
  dateTo: Date
) {
  if (employeeIds.length === 0) return [];

  return prisma.$queryRaw<
    Array<{ employeeId: string; categoryName: string | null; units: bigint }>
  >`
    SELECT DISTINCT ON (t."employeeId")
      t."employeeId", t."categoryName", t."units"
    FROM (
      SELECT
        s."employeeId",
        c."name" AS "categoryName",
        SUM(si."quantity")::bigint AS units
      FROM "sales" s
      INNER JOIN "sale_items"       si ON si."saleId"    = s."id"
      INNER JOIN "product_variants" pv ON pv."id"        = si."variantId"
      INNER JOIN "products"         p  ON p."id"         = pv."productId"
      LEFT  JOIN "categories"       c  ON c."id"         = p."categoryId"
      WHERE s."employeeId" IN (${Prisma.join(employeeIds)})
        AND s."status" = 'COMPLETED'
        AND s."saleDate" >= ${dateFrom}
        AND s."saleDate" <= ${dateTo}
      GROUP BY s."employeeId", c."name"
    ) t
    ORDER BY t."employeeId", t."units" DESC
  `;
}

/**
 * Distinct customers served per employee.
 *
 * Counts PEOPLE, not transactions — a regular who visits five times is one
 * customer served, which is the number this metric is asked for.
 */
async function countCustomersByEmployee(
  employeeIds: string[],
  dateFrom: Date,
  dateTo: Date
) {
  if (employeeIds.length === 0) return [];

  return prisma.$queryRaw<Array<{ employeeId: string; customers: bigint }>>`
    SELECT s."employeeId", COUNT(DISTINCT s."customerId")::bigint AS customers
    FROM "sales" s
    WHERE s."employeeId" IN (${Prisma.join(employeeIds)})
      AND s."status" = 'COMPLETED'
      AND s."saleDate" >= ${dateFrom}
      AND s."saleDate" <= ${dateTo}
    GROUP BY s."employeeId"
  `;
}

/** Exchange counts and value per employee. */
async function groupExchangesByEmployee(
  employeeIds: string[],
  dateFrom: Date,
  dateTo: Date
) {
  if (employeeIds.length === 0) return [];

  return prisma.exchange.groupBy({
    by: ["employeeId"],
    where: {
      employeeId: { in: employeeIds },
      status: "COMPLETED",
      exchangeDate: { gte: dateFrom, lte: dateTo },
    },
    _count: { _all: true },
    _sum: { returnedValue: true, issuedValue: true },
  });
}

/** Cancelled/refunded sales per employee — the "returns" figure. */
async function groupReturnsByEmployee(
  employeeIds: string[],
  dateFrom: Date,
  dateTo: Date
) {
  if (employeeIds.length === 0) return [];

  return prisma.sale.groupBy({
    by: ["employeeId"],
    where: {
      employeeId: { in: employeeIds },
      status: { in: ["CANCELLED", "REFUNDED"] },
      saleDate: { gte: dateFrom, lte: dateTo },
    },
    _count: { _all: true },
    _sum: { grandTotal: true },
  });
}

/**
 * Most recent completed sale per employee — the roster's "Last Sale" column.
 *
 * MAX() rather than a per-employee ORDER BY ... LIMIT 1: one grouped pass over
 * the (employeeId, saleDate) index answers it for the whole page at once.
 */
async function lastSaleByEmployee(employeeIds: string[]) {
  if (employeeIds.length === 0) return [];

  return prisma.sale.groupBy({
    by: ["employeeId"],
    where: { employeeId: { in: employeeIds }, status: "COMPLETED" },
    _max: { saleDate: true },
  });
}

/** Daily revenue per employee for the sparkline / trend chart. */
async function salesTrendByEmployee(
  employeeIds: string[],
  dateFrom: Date,
  dateTo: Date
) {
  if (employeeIds.length === 0) return [];

  return prisma.$queryRaw<
    Array<{ employeeId: string; day: Date; revenue: string; transactions: bigint }>
  >`
    SELECT s."employeeId",
           DATE_TRUNC('day', s."saleDate") AS day,
           COALESCE(SUM(s."grandTotal"), 0)::text AS revenue,
           COUNT(*)::bigint AS transactions
    FROM "sales" s
    WHERE s."employeeId" IN (${Prisma.join(employeeIds)})
      AND s."status" = 'COMPLETED'
      AND s."saleDate" >= ${dateFrom}
      AND s."saleDate" <= ${dateTo}
    GROUP BY s."employeeId", DATE_TRUNC('day', s."saleDate")
    ORDER BY day ASC
  `;
}

// =============================================================================
// SHIFTS
// =============================================================================

async function findShifts(activeOnly = false) {
  return prisma.shift.findMany({
    where: activeOnly ? { isActive: true } : {},
    select: SHIFT_SELECT,
    orderBy: { startMinute: "asc" },
  });
}

async function findShiftById(id: string) {
  return prisma.shift.findUnique({ where: { id }, select: SHIFT_SELECT });
}

async function createShift(data: Prisma.ShiftUncheckedCreateInput) {
  return prisma.shift.create({ data, select: SHIFT_SELECT });
}

async function updateShift(id: string, data: Prisma.ShiftUncheckedUpdateInput) {
  return prisma.shift.update({ where: { id }, data, select: SHIFT_SELECT });
}

/**
 * Bulk shift assignment. One updateMany rather than a loop of updates — the
 * whole point of the bulk action is that assigning 40 cashiers to the morning
 * shift is one round trip, not forty.
 */
async function assignShiftToEmployees(employeeIds: string[], shiftId: string | null) {
  const result = await prisma.employee.updateMany({
    where: { id: { in: employeeIds } },
    data: { shiftId },
  });
  return result.count;
}

/** Employees per shift, for the shift-management screen's headcount badges. */
async function countEmployeesByShift() {
  return prisma.employee.groupBy({
    by: ["shiftId"],
    where: { isActive: true },
    _count: { _all: true },
  });
}

// =============================================================================
// MUTATIONS (OWNER-only paths; authorization enforced in the service)
// =============================================================================

async function updateEmployeeWorkforceFields(
  id: string,
  data: Prisma.EmployeeUncheckedUpdateInput
) {
  return prisma.employee.update({
    where: { id },
    data,
    select: PROFILE_SELECT,
  });
}

// =============================================================================
// BREAK TRACKING
// =============================================================================

/**
 * Opens or closes a break on an existing attendance day.
 *
 * Break state lives on the attendance row rather than in its own table because
 * a break is an attribute of a worked day, and the (employeeId, date) unique
 * constraint already gives us exactly one row to hold it.
 */
async function updateAttendanceBreak(
  attendanceId: string,
  data: { breakStartedAt?: Date | null; breakMinutes?: number }
) {
  return prisma.attendance.update({
    where: { id: attendanceId },
    data,
  });
}

// =============================================================================
// SESSION TERMINATION & SECURITY (Login History dashboard)
// =============================================================================

/**
 * Force-ends ONE specific session, attributing it to the owner who did it.
 *
 * Distinct from closeOpenSessions (which ends every session for an employee,
 * used by password reset and deactivation): the security dashboard terminates a
 * single suspicious session and must leave the employee's other devices alone.
 */
async function terminateSession(
  sessionId: string,
  terminatedById: string,
  now: Date = new Date()
) {
  // Same per-row duration arithmetic as closeOpenSessions — updateMany cannot
  // subtract against the row's own loginAt.
  const affected = await prisma.$executeRaw`
    UPDATE "login_history"
    SET "logoutAt" = ${now},
        "endReason" = 'TERMINATED',
        "terminatedById" = ${terminatedById},
        "durationMinutes" = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (${now}::timestamp - "loginAt")) / 60)::int)
    WHERE "id" = ${sessionId}
      AND "logoutAt" IS NULL
      AND "isSuccessful" = true
  `;

  // 0 means the session was already closed — the caller reports that rather
  // than claiming a termination that did not happen.
  return affected > 0;
}

/** One session row, for authorization checks before terminating it. */
async function findSessionById(sessionId: string) {
  return prisma.loginHistory.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      employeeId: true,
      logoutAt: true,
      isSuccessful: true,
      employee: { select: { id: true, role: true, firstName: true, lastName: true } },
    },
  });
}

/**
 * Security counters for the Login History dashboard.
 *
 * Deliberately COUNT-only and computed in one round trip: this strip sits above
 * a polled table, so it must not cost a scan per card.
 */
async function loginSecurityStats(params: {
  employeeIds?: string[] | undefined;
  since: Date;
  presenceThresholdMinutes: number;
}) {
  const scope = params.employeeIds?.length
    ? Prisma.sql`AND lh."employeeId" = ANY(${params.employeeIds}::text[])`
    : Prisma.empty;

  const cutoff = new Date(Date.now() - params.presenceThresholdMinutes * 60_000);

  const rows = await prisma.$queryRaw<
    Array<{
      active_sessions: bigint;
      failed_logins: bigint;
      logged_in_today: bigint;
      avg_session_minutes: number | null;
      concurrent_peak: bigint;
    }>
  >`
    SELECT
      COUNT(*) FILTER (
        WHERE lh."logoutAt" IS NULL
          AND lh."isSuccessful" = true
          AND COALESCE(lh."lastSeenAt", lh."loginAt") >= ${cutoff}
      )::bigint AS active_sessions,

      COUNT(*) FILTER (
        WHERE lh."isSuccessful" = false AND lh."loginAt" >= ${params.since}
      )::bigint AS failed_logins,

      COUNT(DISTINCT lh."employeeId") FILTER (
        WHERE lh."isSuccessful" = true AND lh."loginAt" >= ${params.since}
      )::bigint AS logged_in_today,

      AVG(lh."durationMinutes") FILTER (
        WHERE lh."durationMinutes" IS NOT NULL AND lh."loginAt" >= ${params.since}
      )::float AS avg_session_minutes,

      -- Distinct employees holding an open session right now. "Concurrent" in
      -- the sense a licence audit means it: people, not tabs.
      COUNT(DISTINCT lh."employeeId") FILTER (
        WHERE lh."logoutAt" IS NULL AND lh."isSuccessful" = true
      )::bigint AS concurrent_peak
    FROM "login_history" lh
    WHERE TRUE ${scope}
  `;

  const row = rows[0];
  return {
    activeSessions: Number(row?.active_sessions ?? 0),
    failedLogins: Number(row?.failed_logins ?? 0),
    loggedInToday: Number(row?.logged_in_today ?? 0),
    averageSessionMinutes: Math.round(row?.avg_session_minutes ?? 0),
    concurrentSessions: Number(row?.concurrent_peak ?? 0),
  };
}

/**
 * Failed sign-in attempts grouped by (employee, IP) for the security table.
 *
 * Grouped rather than listed because the question is "who is being hammered,
 * and from where" — twenty rows of the same IP answer it far worse than one row
 * with a count of twenty.
 */
async function failedLoginAttempts(params: {
  employeeIds?: string[] | undefined;
  since: Date;
  limit: number;
}) {
  const scope = params.employeeIds?.length
    ? Prisma.sql`AND lh."employeeId" = ANY(${params.employeeIds}::text[])`
    : Prisma.empty;

  return prisma.$queryRaw<
    Array<{
      employeeId: string;
      fullName: string | null;
      employeeCode: string | null;
      ipAddress: string | null;
      failureReason: string | null;
      attempts: bigint;
      lastAttemptAt: Date;
    }>
  >`
    SELECT
      lh."employeeId",
      (e."firstName" || ' ' || e."lastName") AS "fullName",
      e."employeeCode",
      lh."ipAddress",
      MAX(lh."failureReason") AS "failureReason",
      COUNT(*)::bigint      AS attempts,
      MAX(lh."loginAt")     AS "lastAttemptAt"
    FROM "login_history" lh
    LEFT JOIN "employees" e ON e."id" = lh."employeeId"
    WHERE lh."isSuccessful" = false
      AND lh."loginAt" >= ${params.since}
      ${scope}
    GROUP BY lh."employeeId", e."firstName", e."lastName", e."employeeCode", lh."ipAddress"
    ORDER BY attempts DESC, "lastAttemptAt" DESC
    LIMIT ${params.limit}
  `;
}

// =============================================================================
// EMPLOYEE NOTES — OWNER-only. The service is the gate; this is plain storage.
// =============================================================================

const NOTE_SELECT = {
  id: true,
  employeeId: true,
  authorId: true,
  category: true,
  body: true,
  isPinned: true,
  createdAt: true,
  updatedAt: true,
  author: {
    select: { id: true, firstName: true, lastName: true, employeeCode: true },
  },
} as const;

/** One employee's notes: pinned first, then newest — matching the tab's index. */
async function findNotes(employeeId: string) {
  return prisma.employeeNote.findMany({
    where: { employeeId },
    select: NOTE_SELECT,
    orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
  });
}

async function findNoteById(id: string) {
  return prisma.employeeNote.findUnique({
    where: { id },
    select: NOTE_SELECT,
  });
}

async function createNote(data: {
  employeeId: string;
  authorId: string;
  category: EmployeeNoteCategory;
  body: string;
  isPinned?: boolean;
  storeCode?: string | null;
}) {
  return prisma.employeeNote.create({
    data: {
      employeeId: data.employeeId,
      authorId: data.authorId,
      category: data.category,
      body: data.body,
      isPinned: data.isPinned ?? false,
      storeCode: data.storeCode ?? null,
    },
    select: NOTE_SELECT,
  });
}

async function updateNote(
  id: string,
  data: Prisma.EmployeeNoteUncheckedUpdateInput
) {
  return prisma.employeeNote.update({
    where: { id },
    data,
    select: NOTE_SELECT,
  });
}

async function deleteNote(id: string) {
  await prisma.employeeNote.delete({ where: { id } });
}

/** Note counts per employee, so the roster/drawer can badge without loading bodies. */
async function countNotesByEmployee(employeeIds: string[]) {
  if (employeeIds.length === 0) return [];
  return prisma.employeeNote.groupBy({
    by: ["employeeId"],
    where: { employeeId: { in: employeeIds } },
    _count: { _all: true },
  });
}

export const workforceRepository = {
  // roster
  findRoster,
  findRosterIds,
  findEmployeeProfile,
  countByRole,
  countByEmploymentStatus,
  updateEmployeeWorkforceFields,
  // presence + sessions
  findOpenSessions,
  countOnline,
  findLoginHistory,
  createLoginSession,
  closeOpenSessions,
  touchSession,
  // activity
  findActivity,
  findLastActivity,
  groupActivityByType,
  groupActivityByTypeAndModule,
  // attendance
  findAttendance,
  findAttendanceForDate,
  findAttendanceByEmployeeAndDate,
  groupAttendanceByEmployeeAndStatus,
  groupAttendanceByStatus,
  attendanceTrend,
  upsertAttendance,
  updateAttendanceBreak,
  // performance
  groupSalesByEmployee,
  sumUnitsByEmployee,
  topCategoryByEmployee,
  countCustomersByEmployee,
  lastSaleByEmployee,
  groupExchangesByEmployee,
  groupReturnsByEmployee,
  salesTrendByEmployee,
  // shifts
  findShifts,
  findShiftById,
  createShift,
  updateShift,
  assignShiftToEmployees,
  countEmployeesByShift,
  // security / sessions
  terminateSession,
  findSessionById,
  loginSecurityStats,
  failedLoginAttempts,
  // notes (OWNER-only at the service layer)
  findNotes,
  findNoteById,
  createNote,
  updateNote,
  deleteNote,
  countNotesByEmployee,
} as const;
