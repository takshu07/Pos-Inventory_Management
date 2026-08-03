// =============================================================================
// AUDIT LOG SERVICE  —  READ-ONLY
//
// The read side of the audit trail. There is no create/update/delete here by
// design: audit entries are written by `auditRepository.create` from the module
// that performed the action, and an audit trail the application can rewrite is
// not an audit trail. Nothing in this file mutates.
//
// THE TWO THINGS THIS FILE EXISTS TO GET RIGHT
// --------------------------------------------
// 1. SEVERITY WITHOUT A COLUMN. `audit_logs` has no severity field. The engine
//    derives it from `action`; this service translates a severity FILTER into
//    an `action IN (...)` predicate before it reaches the database, so the
//    filter stays indexed. Deriving on read and filtering in SQL are reconciled
//    here, in one place.
//
// 2. NEVER READING MORE THAN NEEDED. This is the largest table in the system.
//    The list query selects no JSON snapshots, counts are capped, and paging
//    depth is bounded. See the constants below.
// =============================================================================

import type { ActionModule, ActionType, Prisma } from "../../generated/prisma";
import { HTTP_STATUS } from "../constants/httpStatus";
import { prisma } from "../config/prisma";
import { AppError } from "../errors/AppError";
import {
  actionLabel,
  diffSnapshots,
  entityLabel,
  moduleLabel,
  resolvePeriod,
  severityForAction,
  severityRank,
  SEVERITY_LEVELS,
  type AuditFieldChange,
  type AuditSeverity,
} from "../engines/audit.engine";
import { auditRepository } from "../repositories/audit.repository";
import { AUDIT_ACTIONS, AUDIT_MODULES } from "../validation/audit.validation";
import type {
  AuditListQuery,
  AuditRelatedQuery,
  AuditSummaryQuery,
} from "../validation/audit.validation";

// =============================================================================
// LIMITS
// =============================================================================

/**
 * Exact totals stop at 10,000.
 *
 * Past this the count is reported as "10,000+" and `totalIsExact` is false. The
 * UI says "10,000+" rather than inventing a page count it cannot honour. See
 * `countCapped` in the repository for why an exact COUNT is the expensive part.
 */
const COUNT_CAP = 10_000;

/**
 * Offset paging is refused past row 10,000.
 *
 * `OFFSET 250000` makes Postgres walk and discard a quarter of a million rows
 * for one page — the deeper you go, the slower it gets, and nobody audits by
 * paging to 5,000. Past the cap the answer is to narrow the filters, and the
 * error says exactly that rather than returning a slow empty page.
 *
 * This is the documented trade-off of the offset model chosen for this screen:
 * it keeps jump-to-page and matches every other table in the app, at the cost
 * of a bounded reachable depth.
 */
const MAX_OFFSET = 10_000;

/** Related-entry lookups are capped hard; this is a sidebar, not a report. */
const RELATED_DEFAULT_LIMIT = 5;

// =============================================================================
// FILTER TRANSLATION
// =============================================================================

const ALL_ACTIONS = AUDIT_ACTIONS as readonly ActionType[];

/**
 * Turns the requested severities into the set of actions they cover.
 *
 * This is the hinge of the whole "no severity column" design. Filtering by a
 * derived value normally forces a full scan; inverting the map at query-build
 * time turns it back into an ordinary indexed enum predicate.
 *
 * Returns `null` when every severity is selected — an `IN` listing all 41
 * actions is strictly worse than no predicate at all.
 */
function actionsForSeverities(severities: AuditSeverity[]): ActionType[] | null {
  const wanted = new Set(severities);
  if (wanted.size >= SEVERITY_LEVELS.length) return null;
  return ALL_ACTIONS.filter((action) => wanted.has(severityForAction(action)));
}

/**
 * Intersects an explicit `action` filter with the severity-derived action set.
 *
 * Both filters can be applied at once ("CRITICAL things, but only deletions").
 * The intersection can legitimately be EMPTY — asking for LOW severity and the
 * DELETE action describes no possible row. That must produce an empty result,
 * never an unfiltered one, which is why the empty array is preserved rather
 * than treated as "no filter".
 */
function resolveActionFilter(
  actions: ActionType[] | undefined,
  severities: AuditSeverity[] | undefined
): ActionType[] | undefined {
  const fromSeverity = severities ? actionsForSeverities(severities) : null;

  if (!actions && !fromSeverity) return undefined;
  if (!actions) return fromSeverity ?? undefined;
  if (!fromSeverity) return actions;

  const allowed = new Set(fromSeverity);
  return actions.filter((action) => allowed.has(action));
}

interface DateWindow {
  from: Date | null;
  to: Date | null;
}

/** Named period, or the explicit range when the period is "custom". */
function resolveWindow(
  period: AuditListQuery["period"],
  from: Date | undefined,
  to: Date | undefined,
  now: Date
): DateWindow {
  if (period === "custom") {
    return { from: from ?? null, to: to ?? null };
  }
  return resolvePeriod(period, now);
}

/**
 * Builds the Prisma `where` shared by the list, the count and the summary.
 *
 * Every branch here targets an indexed column: employeeId, module, action,
 * (tableName, recordId), createdAt.
 */
function buildWhere(
  query: {
    module?: readonly string[] | undefined;
    action?: readonly string[] | undefined;
    severity?: readonly string[] | undefined;
    employeeId?: string | undefined;
    tableName?: string | undefined;
    recordId?: string | undefined;
    search?: string | undefined;
    period: AuditListQuery["period"];
    from?: Date | undefined;
    to?: Date | undefined;
  },
  now: Date
): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};

  if (query.employeeId) where.employeeId = query.employeeId;

  if (query.module && query.module.length > 0) {
    where.module = { in: query.module as ActionModule[] };
  }

  const actionFilter = resolveActionFilter(
    query.action as ActionType[] | undefined,
    query.severity as AuditSeverity[] | undefined
  );
  if (actionFilter) {
    where.action = { in: actionFilter };
  }

  if (query.tableName) where.tableName = query.tableName;
  if (query.recordId) where.recordId = query.recordId;

  const window = resolveWindow(query.period, query.from, query.to, now);
  if (window.from || window.to) {
    where.createdAt = {
      ...(window.from ? { gte: window.from } : {}),
      // Half-open: `lt`, not `lte`. resolvePeriod returns the first instant
      // AFTER the window, so `lte` would leak one row from the next period.
      ...(window.to ? { lt: window.to } : {}),
    };
  }

  // Search targets the affected record id and the actor's identity — both
  // selective and indexed-adjacent. It deliberately does NOT reach into the
  // JSON snapshots; see the note on `search` in audit.validation.ts.
  if (query.search) {
    const term = query.search;
    where.OR = [
      { recordId: { equals: term } },
      { recordId: { contains: term, mode: "insensitive" } },
      { employee: { firstName: { contains: term, mode: "insensitive" } } },
      { employee: { lastName: { contains: term, mode: "insensitive" } } },
      { employee: { email: { contains: term, mode: "insensitive" } } },
      { employee: { employeeCode: { contains: term, mode: "insensitive" } } },
    ];
  }

  return where;
}

/**
 * ORDER BY for the requested sort.
 *
 * `severity` is not a column, so it cannot be sorted in SQL. Sorting by the
 * action enum is the closest INDEXED approximation, and the service then
 * orders the returned page by true severity rank (see `sortRowsBySeverity`).
 * That means severity sort is exact WITHIN a page rather than across the whole
 * result set — an acceptable and documented limitation, and the reason the
 * default sort is `createdAt`. Filtering by severity is exact regardless, and
 * is what someone actually wants when hunting for critical events.
 *
 * `id` is always the final tiebreaker: without it, rows sharing a timestamp
 * can appear in a different order on each request, which makes offset paging
 * skip or repeat rows.
 */
function buildOrderBy(
  sortBy: AuditListQuery["sortBy"],
  sortOrder: AuditListQuery["sortOrder"]
): Prisma.AuditLogOrderByWithRelationInput[] {
  if (sortBy === "severity") {
    return [{ action: sortOrder }, { createdAt: "desc" }, { id: "desc" }];
  }
  return [{ createdAt: sortOrder }, { id: sortOrder }];
}

// =============================================================================
// SHAPING
// =============================================================================

export interface AuditActorView {
  id: string;
  name: string;
  role: string;
  email: string | null;
}

export interface AuditLogListItem {
  id: string;
  action: ActionType;
  actionLabel: string;
  module: ActionModule;
  moduleLabel: string;
  severity: AuditSeverity;
  entity: { table: string; label: string; recordId: string };
  actor: AuditActorView;
  createdAt: Date;
}

function toActor(employee: {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  email: string | null;
}): AuditActorView {
  return {
    id: employee.id,
    name: `${employee.firstName} ${employee.lastName}`.trim(),
    role: employee.role,
    email: employee.email,
  };
}

function toListItem(row: {
  id: string;
  action: ActionType;
  module: ActionModule;
  tableName: string;
  recordId: string;
  createdAt: Date;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
    email: string | null;
  };
}): AuditLogListItem {
  return {
    id: row.id,
    action: row.action,
    actionLabel: actionLabel(row.action),
    module: row.module,
    moduleLabel: moduleLabel(row.module),
    severity: severityForAction(row.action),
    entity: {
      table: row.tableName,
      label: entityLabel(row.tableName),
      recordId: row.recordId,
    },
    actor: toActor(row.employee),
    createdAt: row.createdAt,
  };
}

/** True severity ordering, applied to the page after SQL has ordered by action. */
function sortRowsBySeverity(
  items: AuditLogListItem[],
  order: "asc" | "desc"
): AuditLogListItem[] {
  const direction = order === "asc" ? -1 : 1;
  return [...items].sort((a, b) => {
    const delta = severityRank(a.severity) - severityRank(b.severity);
    if (delta !== 0) return delta * direction;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

// =============================================================================
// LIST
// =============================================================================

export interface AuditListResult {
  data: AuditLogListItem[];
  meta: {
    total: number;
    /** False when the count hit COUNT_CAP — render as "10,000+". */
    totalIsExact: boolean;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export async function listAuditLogs(
  query: AuditListQuery,
  now: Date = new Date()
): Promise<AuditListResult> {
  const skip = (query.page - 1) * query.limit;

  // Refuse the request rather than serve a slow one. See MAX_OFFSET.
  if (skip > MAX_OFFSET) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      `Cannot page beyond ${MAX_OFFSET.toLocaleString()} entries. Narrow the date range or add a filter to reach older activity.`
    );
  }

  const where = buildWhere(query, now);
  const orderBy = buildOrderBy(query.sortBy, query.sortOrder);

  const { rows, total, totalIsExact } = await auditRepository.findPage(
    { where, orderBy, skip, take: query.limit },
    COUNT_CAP
  );

  const items = rows.map(toListItem);
  const data =
    query.sortBy === "severity"
      ? sortRowsBySeverity(items, query.sortOrder)
      : items;

  const totalPages = Math.max(1, Math.ceil(total / query.limit));

  return {
    data,
    meta: {
      total,
      totalIsExact,
      page: query.page,
      limit: query.limit,
      totalPages,
      // When the count is capped there are more pages than `totalPages` says,
      // so a full page is itself the signal that another one exists.
      hasNextPage: !totalIsExact ? rows.length === query.limit : query.page < totalPages,
      hasPreviousPage: query.page > 1,
    },
  };
}

// =============================================================================
// DETAIL
// =============================================================================

export interface AuditContextView {
  /** Where this came from — never presented as if it were stored on the entry. */
  source: "SESSION";
  ipAddress: string | null;
  device: string | null;
  browser: string | null;
  operatingSystem: string | null;
  sessionStartedAt: Date | null;
}

export interface AuditLogDetail extends AuditLogListItem {
  oldData: unknown;
  newData: unknown;
  changes: AuditFieldChange[];
  actor: AuditActorView & { employeeCode: string | null; phone: string | null };
  /** Null when no session covering this timestamp was found. */
  context: AuditContextView | null;
}

/**
 * IP / device for an entry, correlated from `login_history`.
 *
 * ⚠ THIS IS DERIVED, NOT RECORDED. `audit_logs` stores no network context —
 * the columns do not exist, and adding them would mean changing every writer,
 * which this milestone deliberately does not do. What we CAN do is find the
 * session the actor had open when the entry was written.
 *
 * The match is: the actor's most recent login at or before the entry, whose
 * session had not already ended before it. That is a strong correlation for a
 * single-session user and a reasonable one otherwise, but it is an INFERENCE.
 * The response tags it `source: "SESSION"` and the UI labels it as coming from
 * the session rather than the entry, because presenting inferred provenance as
 * recorded fact is precisely the kind of thing an audit trail must not do.
 *
 * Served by `login_history_employeeid_loginat_idx` — one indexed lookup.
 */
async function findSessionContext(
  employeeId: string,
  at: Date
): Promise<AuditContextView | null> {
  const session = await prisma.loginHistory.findFirst({
    where: {
      employeeId,
      isSuccessful: true,
      loginAt: { lte: at },
      // Either still open, or closed after this entry was written.
      OR: [{ logoutAt: null }, { logoutAt: { gte: at } }],
    },
    orderBy: { loginAt: "desc" },
    select: {
      ipAddress: true,
      device: true,
      browser: true,
      operatingSystem: true,
      loginAt: true,
    },
  });

  if (!session) return null;

  // A session row with no network detail at all tells the reader nothing;
  // returning null lets the UI say "not recorded" instead of showing blanks.
  if (
    !session.ipAddress &&
    !session.device &&
    !session.browser &&
    !session.operatingSystem
  ) {
    return null;
  }

  return {
    source: "SESSION",
    ipAddress: session.ipAddress,
    device: session.device,
    browser: session.browser,
    operatingSystem: session.operatingSystem,
    sessionStartedAt: session.loginAt,
  };
}

export async function getAuditLog(id: string): Promise<AuditLogDetail> {
  const row = await auditRepository.findById(id);
  if (!row) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Audit entry not found.");
  }

  // `employee.id` is the same value as the row's employeeId FK; the select
  // joins the actor anyway, so there is no reason to fetch the raw column too.
  const context = await findSessionContext(row.employee.id, row.createdAt);

  const base = toListItem(row);
  return {
    ...base,
    oldData: row.oldData ?? null,
    newData: row.newData ?? null,
    changes: diffSnapshots(row.oldData, row.newData),
    actor: {
      ...base.actor,
      employeeCode: row.employee.employeeCode ?? null,
      phone: row.employee.phone ?? null,
    },
    context,
  };
}

/** Other entries against the same record — the "history of this thing" panel. */
export async function getRelatedAuditLogs(
  id: string,
  query: AuditRelatedQuery
): Promise<AuditLogListItem[]> {
  const row = await auditRepository.findById(id);
  if (!row) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Audit entry not found.");
  }

  const rows = await auditRepository.findRelated(
    row.tableName,
    row.recordId,
    row.id,
    query.limit ?? RELATED_DEFAULT_LIMIT
  );
  return rows.map(toListItem);
}

// =============================================================================
// FILTER OPTIONS
// =============================================================================

export interface AuditFilterOptions {
  modules: Array<{ value: string; label: string }>;
  actions: Array<{ value: string; label: string; severity: AuditSeverity }>;
  severities: Array<{ value: AuditSeverity; label: string }>;
  entities: Array<{ value: string; label: string }>;
  actors: Array<{ value: string; label: string; role: string; count: number }>;
}

/**
 * Everything the filter bar needs, in one request.
 *
 * Modules, actions and severities come from the enums (a complete, stable
 * list). Entities and actors come from the DATA, so the entity dropdown never
 * offers a table with zero rows and the actor list keeps showing a deactivated
 * employee whose history is still in the trail.
 */
export async function getFilterOptions(): Promise<AuditFilterOptions> {
  const [tableNames, actorCounts] = await Promise.all([
    auditRepository.findDistinctTableNames(),
    auditRepository.findActors(),
  ]);

  // One query for the names behind the ids from groupBy, rather than N.
  const employees = actorCounts.length
    ? await prisma.employee.findMany({
        where: { id: { in: actorCounts.map((a) => a.employeeId) } },
        select: { id: true, firstName: true, lastName: true, role: true },
      })
    : [];
  const byId = new Map(employees.map((e) => [e.id, e]));

  return {
    modules: AUDIT_MODULES.map((value) => ({
      value,
      label: moduleLabel(value as ActionModule),
    })),
    actions: AUDIT_ACTIONS.map((value) => ({
      value,
      label: actionLabel(value as ActionType),
      severity: severityForAction(value as ActionType),
    })),
    severities: SEVERITY_LEVELS.map((value) => ({
      value,
      label: value.charAt(0) + value.slice(1).toLowerCase(),
    })),
    entities: tableNames.map((value) => ({ value, label: entityLabel(value) })),
    actors: actorCounts
      .map((actor) => {
        const employee = byId.get(actor.employeeId);
        return {
          value: actor.employeeId,
          label: employee
            ? `${employee.firstName} ${employee.lastName}`.trim()
            : "Unknown user",
          role: employee?.role ?? "UNKNOWN",
          count: actor.count,
        };
      })
      // Deleted-employee rows cannot happen (the FK is Restrict), but an actor
      // we cannot name is still filterable — just sorted last.
      .sort((a, b) => b.count - a.count),
  };
}

// =============================================================================
// SUMMARY
// =============================================================================

export interface AuditSummary {
  total: number;
  totalIsExact: boolean;
  bySeverity: Array<{ severity: AuditSeverity; count: number }>;
  byModule: Array<{ module: string; label: string; count: number }>;
  topActions: Array<{ action: string; label: string; count: number }>;
}

/**
 * Counts for the summary strip, under the SAME filters as the list.
 *
 * Severity totals are assembled from per-action counts rather than a separate
 * pass: `groupBy(action)` returns at most 41 rows, and folding them by derived
 * severity is free. That is one aggregate query instead of four filtered
 * counts, which matters on this table.
 */
export async function getAuditSummary(
  query: AuditSummaryQuery,
  now: Date = new Date()
): Promise<AuditSummary> {
  const where = buildWhere(query, now);

  const [moduleCounts, actionCounts] = await Promise.all([
    auditRepository.countByModule(where),
    auditRepository.countByAction(where),
  ]);

  const severityTotals = new Map<AuditSeverity, number>(
    SEVERITY_LEVELS.map((level) => [level, 0])
  );
  let total = 0;
  for (const row of actionCounts) {
    const severity = severityForAction(row.action as ActionType);
    severityTotals.set(severity, (severityTotals.get(severity) ?? 0) + row.count);
    total += row.count;
  }

  return {
    total,
    // groupBy counts are exact — it aggregates rather than paging.
    totalIsExact: true,
    bySeverity: SEVERITY_LEVELS.map((severity) => ({
      severity,
      count: severityTotals.get(severity) ?? 0,
    })),
    byModule: moduleCounts
      .map((row) => ({
        module: row.module,
        label: moduleLabel(row.module as ActionModule),
        count: row.count,
      }))
      .sort((a, b) => b.count - a.count),
    topActions: actionCounts
      .map((row) => ({
        action: row.action,
        label: actionLabel(row.action as ActionType),
        count: row.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
  };
}
