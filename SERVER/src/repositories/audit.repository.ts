// =============================================================================
// AUDIT LOG REPOSITORY
// All database writes to the audit_logs table.
//
// Design decisions:
// - Audit writes are ALWAYS fire-and-forget. An audit failure must NEVER
//   cause a business operation to fail or roll back. We log errors to Pino.
// - oldData/newData are stored as JSON snapshots of the Prisma record shape.
// - Sensitive fields (password, refreshTokenVersion) are stripped before
//   writing to audit_logs to prevent credentials ending up in the audit trail.
// =============================================================================

import type { ActionModule, ActionType } from "../../generated/prisma";
import { Prisma } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";

// Fields that must never appear in an audit log snapshot
const SENSITIVE_KEYS = new Set(["password", "refreshTokenVersion"]);

function stripSensitive(
  data: Record<string, unknown>
): Prisma.InputJsonValue {
  const cleaned: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!SENSITIVE_KEYS.has(key)) {
      // Prisma InputJsonValue is a recursive type — cast needed for unknown values.
      cleaned[key] = value as Prisma.InputJsonValue;
    }
  }
  return cleaned;
}

export interface CreateAuditLogInput {
  performedBy: string;        // employeeId who performed the action
  action: ActionType;
  module: ActionModule;
  tableName: string;          // e.g. "employees"
  recordId: string;           // cuid of the affected record
  oldData?: Record<string, unknown> | null;
  newData?: Record<string, unknown> | null;
}

/**
 * Creates an audit log entry.
 *
 * This function is intended to be called as fire-and-forget:
 *   auditRepository.create({ ... }).catch(() => {})
 *
 * Errors are swallowed silently because an audit write failure must never
 * block or roll back the actual business operation.
 */
async function create(input: CreateAuditLogInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        employeeId: input.performedBy,
        action: input.action,
        module: input.module,
        tableName: input.tableName,
        recordId: input.recordId,
        // Only include oldData/newData keys if data is present.
        // Conditional spread avoids passing undefined to Prisma with
        // exactOptionalPropertyTypes enabled.
        ...(input.oldData != null && {
          oldData: stripSensitive(input.oldData),
        }),
        ...(input.newData != null && {
          newData: stripSensitive(input.newData),
        }),
      },
    });
  } catch (err) {
    // Log the failure but never re-throw — audit writes are non-critical.
    logger.error({ err, input }, "[AuditRepository] Failed to write audit log");
  }
}

// =============================================================================
// READS  —  added for the Audit Logs module (2026-08-03)
//
// Everything below is ADDITIVE. `create` above is unchanged, and nothing here
// writes. The audit trail's value depends on it being an append-only record
// that the app itself cannot rewrite, so this repository exposes no update and
// no delete — not even a soft one.
//
// PERFORMANCE CONTRACT (audit_logs is the largest table in the system)
// -------------------------------------------------------------------
//   • Every filter maps to an indexed column. The schema indexes employeeId,
//     module, (tableName, recordId) and createdAt.
//   • Severity is NOT a column. It is translated by the service into
//     `action IN (...)` before reaching this layer, so it stays indexable —
//     see engines/audit.engine.ts.
//   • `select` is always explicit and the LIST never reads oldData/newData.
//     Those JSON blobs are the heaviest thing in the row and are useless in a
//     table view; they are fetched only by `findById` for one record. Reading
//     them on a 50-row page would move megabytes per request to render nothing.
//   • Counting is CAPPED (`countCapped`). An exact COUNT(*) on a filtered scan
//     of a huge table is the slowest part of offset pagination, and nobody
//     needs to know they are on page 4,912 of 60,000.
// =============================================================================

import type { Prisma as PrismaTypes } from "../../generated/prisma";

/** Row shape for the list view. Deliberately excludes oldData/newData. */
const LIST_SELECT = {
  id: true,
  action: true,
  module: true,
  tableName: true,
  recordId: true,
  createdAt: true,
  employee: {
    select: { id: true, firstName: true, lastName: true, role: true, email: true },
  },
} satisfies PrismaTypes.AuditLogSelect;

/** Detail adds the JSON snapshots — the only place they are ever read. */
const DETAIL_SELECT = {
  ...LIST_SELECT,
  oldData: true,
  newData: true,
  employee: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
      email: true,
      phone: true,
      employeeCode: true,
    },
  },
} satisfies PrismaTypes.AuditLogSelect;

export type AuditLogListRow = PrismaTypes.AuditLogGetPayload<{
  select: typeof LIST_SELECT;
}>;
export type AuditLogDetailRow = PrismaTypes.AuditLogGetPayload<{
  select: typeof DETAIL_SELECT;
}>;

export interface FindManyOptions {
  where: PrismaTypes.AuditLogWhereInput;
  orderBy: PrismaTypes.AuditLogOrderByWithRelationInput[];
  skip: number;
  take: number;
}

/** One page of log rows. No snapshots — see LIST_SELECT. */
async function findMany(options: FindManyOptions): Promise<AuditLogListRow[]> {
  return prisma.auditLog.findMany({
    where: options.where,
    orderBy: options.orderBy,
    skip: options.skip,
    take: options.take,
    select: LIST_SELECT,
  });
}

/**
 * Counts matching rows, but stops counting past `cap`.
 *
 * WHY NOT `prisma.auditLog.count()`
 * ---------------------------------
 * On the largest table in the system a filtered COUNT(*) has to walk every
 * matching row — it is routinely slower than fetching the page itself, and it
 * gets slower as the business succeeds. The UI only needs the exact total while
 * it is small enough to be meaningful; beyond that "10,000+" is just as useful
 * and costs a bounded amount of work.
 *
 * The implementation reads at most `cap + 1` ids and counts them, so Postgres
 * stops early. Getting `cap + 1` back means "at least this many", which the
 * service reports as `totalIsExact: false`.
 */
async function countCapped(
  where: PrismaTypes.AuditLogWhereInput,
  cap: number
): Promise<{ total: number; totalIsExact: boolean }> {
  // Prisma has no public "compile this where clause to SQL" API, so the capped
  // count is expressed with findMany selecting only the id — the planner still
  // stops at `take`, and the payload is one short string per row. This keeps
  // the query type-safe and reuses the exact same `where` as the page query,
  // which a hand-written SQL clause could drift from.
  const rows = await prisma.auditLog.findMany({
    where,
    select: { id: true },
    take: cap + 1,
  });

  if (rows.length > cap) {
    return { total: cap, totalIsExact: false };
  }
  return { total: rows.length, totalIsExact: true };
}

/**
 * A page of rows plus its capped count, in ONE round trip.
 *
 * `$transaction([...])` batches both queries to the database together. Against
 * Neon's pooler every query is a real network round-trip, so issuing these
 * sequentially would double the latency of the screen's primary request.
 */
async function findPage(
  options: FindManyOptions,
  countCap: number
): Promise<{ rows: AuditLogListRow[]; total: number; totalIsExact: boolean }> {
  const [rows, countRows] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where: options.where,
      orderBy: options.orderBy,
      skip: options.skip,
      take: options.take,
      select: LIST_SELECT,
    }),
    prisma.auditLog.findMany({
      where: options.where,
      select: { id: true },
      take: countCap + 1,
    }),
  ]);

  const exceeded = countRows.length > countCap;
  return {
    rows,
    total: exceeded ? countCap : countRows.length,
    totalIsExact: !exceeded,
  };
}

/** One entry WITH its JSON snapshots. Null when the id does not exist. */
async function findById(id: string): Promise<AuditLogDetailRow | null> {
  return prisma.auditLog.findUnique({
    where: { id },
    select: DETAIL_SELECT,
  });
}

/**
 * The other entries touching the SAME record, newest first.
 *
 * Served by the existing `@@index([tableName, recordId])`. This is what turns a
 * single entry into a history — "what else happened to this product?" — and it
 * excludes the entry being viewed so the detail view does not list itself.
 */
async function findRelated(
  tableName: string,
  recordId: string,
  excludeId: string,
  take: number
): Promise<AuditLogListRow[]> {
  return prisma.auditLog.findMany({
    where: { tableName, recordId, id: { not: excludeId } },
    orderBy: { createdAt: "desc" },
    take,
    select: LIST_SELECT,
  });
}

/**
 * Distinct `tableName` values actually present in the table.
 *
 * The entity filter is populated from real data rather than a hardcoded list,
 * so it can never offer an option that matches zero rows, and a module that
 * starts auditing a new table appears without a code change.
 *
 * `distinct` on an indexed-enough column over a bounded set of values is cheap;
 * the result is cached by the service because it changes almost never.
 */
async function findDistinctTableNames(): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({
    distinct: ["tableName"],
    select: { tableName: true },
    orderBy: { tableName: "asc" },
  });
  return rows.map((row) => row.tableName);
}

/**
 * The actors who appear in the audit trail, for the "user" filter.
 *
 * Sourced from `groupBy` on audit_logs rather than from the employees table:
 * the filter should list people who have actually done something auditable,
 * and it should keep listing a deactivated employee whose historical actions
 * are still in the trail. Includes each actor's entry count, which is genuinely
 * useful ordering for this filter.
 */
async function findActors(): Promise<Array<{ employeeId: string; count: number }>> {
  const rows = await prisma.auditLog.groupBy({
    by: ["employeeId"],
    _count: { _all: true },
    orderBy: { _count: { employeeId: "desc" } },
  });
  return rows.map((row) => ({
    employeeId: row.employeeId,
    count: row._count._all,
  }));
}

/** Per-module and per-action totals for the summary strip. */
async function countByModule(
  where: PrismaTypes.AuditLogWhereInput
): Promise<Array<{ module: string; count: number }>> {
  const rows = await prisma.auditLog.groupBy({
    by: ["module"],
    where,
    _count: { _all: true },
  });
  return rows.map((row) => ({ module: row.module, count: row._count._all }));
}

async function countByAction(
  where: PrismaTypes.AuditLogWhereInput
): Promise<Array<{ action: string; count: number }>> {
  const rows = await prisma.auditLog.groupBy({
    by: ["action"],
    where,
    _count: { _all: true },
  });
  return rows.map((row) => ({ action: row.action, count: row._count._all }));
}

export const auditRepository = {
  create,
  findMany,
  findPage,
  countCapped,
  findById,
  findRelated,
  findDistinctTableNames,
  findActors,
  countByModule,
  countByAction,
} as const;
