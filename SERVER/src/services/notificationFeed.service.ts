// =============================================================================
// NOTIFICATION FEED SERVICE
//
// The read model behind the Notifications screen: paging, filtering, search,
// counts and bulk read.
//
// SEPARATE FILE, NOT AN EDIT TO notification.service.ts
// ----------------------------------------------------
// `notification.service.ts` is the existing bell/dashboard path — three thin
// methods that the Navbar and dashboard already depend on. This file is
// additive: nothing here changes what those three do, so the existing callers
// cannot regress. They share `notification.repository`.
//
// CATEGORY AND SEVERITY ARE DERIVED, NEVER STORED
// -----------------------------------------------
// See constants/notificationTaxonomy.ts for why. The consequence for this file
// is that a category filter never reaches SQL as a category — it is expanded
// into a `type IN (...)` (or `notIn`, for the SYSTEM fallback bucket) over the
// indexed `type` column before the query is built.
// =============================================================================

import type { Prisma } from "../../generated/prisma";
import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationSeverity,
  allMappedTypes,
  categoryForType,
  metaForType,
  severityForType,
  severityRank,
  typeFilterForCategories,
} from "../constants/notificationTaxonomy";
import { notificationRepository } from "../repositories/notification.repository";
import type { NotificationListQuery } from "../validation/notification.validation";

export interface NotificationListItem {
  id: string;
  type: string;
  /** Human label for the type — "Low stock" rather than "LOW_STOCK". */
  typeLabel: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  message: string;
  isRead: boolean;
  referenceId: string | null;
  referenceType: string | null;
  createdAt: Date;
}

/**
 * Builds the Prisma filter from validated query params.
 *
 * Audience scoping is deliberately NOT here — the repository AND-s it in, so
 * this function cannot accidentally produce a query that sees everyone's rows.
 */
function buildWhere(query: NotificationListQuery): Prisma.NotificationWhereInput {
  const and: Prisma.NotificationWhereInput[] = [];

  if (query.isRead !== undefined) and.push({ isRead: query.isRead });

  // Category → type expansion. SYSTEM is the unmapped-type bucket, so it
  // becomes `notIn` rather than `in`; both together become an OR.
  if (query.category?.length) {
    const filter = typeFilterForCategories(query.category);
    if (filter && "OR" in filter) {
      and.push(filter as Prisma.NotificationWhereInput);
    } else if (filter) {
      and.push({ type: filter as Prisma.StringFilter });
    }
  }

  // Severity has no column either. Unlike category it does not partition the
  // type space cleanly, so it is expressed as the set of types carrying that
  // severity — still an indexed `IN`.
  if (query.severity?.length) {
    const wanted = new Set<NotificationSeverity>(query.severity);
    const mapped = allMappedTypes();
    const types = mapped.filter((t) => wanted.has(severityForType(t)));

    // An unmapped type derives to INFO, so a request for INFO must ALSO match
    // everything unmapped — otherwise SYSTEM notifications become invisible
    // whenever someone filters by the very severity they carry.
    and.push(
      wanted.has("INFO")
        ? { OR: [{ type: { in: types } }, { type: { notIn: mapped } }] }
        : { type: { in: types } }
    );
  }

  if (query.search) {
    and.push({
      OR: [
        { title: { contains: query.search, mode: "insensitive" } },
        { message: { contains: query.search, mode: "insensitive" } },
      ],
    });
  }

  if (query.startDate || query.endDate) {
    and.push({
      createdAt: {
        ...(query.startDate && { gte: query.startDate }),
        ...(query.endDate && { lte: endOfDay(query.endDate) }),
      },
    });
  }

  return and.length > 0 ? { AND: and } : {};
}

/**
 * `endDate` arrives as a midnight date, which would exclude everything that
 * happened during the chosen day. Widening to 23:59:59.999 makes an inclusive
 * range mean what a user reading "to 5 Aug" expects.
 */
function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

function toListItem(row: {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  referenceId: string | null;
  referenceType: string | null;
  createdAt: Date;
}): NotificationListItem {
  const meta = metaForType(row.type);
  return {
    id: row.id,
    type: row.type,
    typeLabel: meta.label,
    category: meta.category,
    severity: meta.severity,
    title: row.title,
    message: row.message,
    isRead: row.isRead,
    referenceId: row.referenceId,
    referenceType: row.referenceType,
    createdAt: row.createdAt,
  };
}

export interface NotificationListResult {
  data: NotificationListItem[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    unreadTotal: number;
  };
}

/**
 * Lists notifications for the signed-in user.
 *
 * SEVERITY SORTING IS PAGE-LOCAL, like Audit Logs. There is no severity column
 * to ORDER BY, so SQL orders by `createdAt` and the returned page is re-sorted
 * by true severity rank. Sorting exactly across the whole table would mean
 * loading it, which is the trade Audit Logs already made and documented.
 */
export async function listNotifications(
  userId: string,
  role: string,
  query: NotificationListQuery
): Promise<NotificationListResult> {
  const where = buildWhere(query);
  const skip = (query.page - 1) * query.limit;

  const orderBy: Prisma.NotificationOrderByWithRelationInput =
    query.sortBy === "severity"
      ? { createdAt: "desc" } // re-sorted below; SQL cannot rank a derived value
      : { createdAt: query.sortOrder };

  const { rows, total } = await notificationRepository.findPage({
    userId,
    role,
    where,
    orderBy,
    skip,
    take: query.limit,
  });

  let data = rows.map(toListItem);

  if (query.sortBy === "severity") {
    // `rank(a) - rank(b)` is ASCENDING (INFO first), so "desc" — the useful
    // default, most urgent first — must NEGATE it. Getting this backwards puts
    // the critical alerts at the bottom of the page, which is the one place
    // nobody looks.
    const direction = query.sortOrder === "desc" ? -1 : 1;
    data = [...data].sort((a, b) => {
      const delta = severityRank(a.severity) - severityRank(b.severity);
      if (delta !== 0) return delta * direction;
      // Ties break newest-first regardless of severity direction: among equally
      // urgent alerts, the recent one is the actionable one.
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
  }

  // Unread total is unfiltered by read-state on purpose: the badge must show
  // "how many unread do I have", not "how many unread match this filter".
  const { unreadTotal } = await notificationRepository.countsByType({
    userId,
    role,
  });

  const totalPages = Math.max(1, Math.ceil(total / query.limit));

  return {
    data,
    meta: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages,
      hasNextPage: query.page < totalPages,
      unreadTotal,
    },
  };
}

export interface NotificationSummary {
  total: number;
  unreadTotal: number;
  byCategory: Array<{
    category: NotificationCategory;
    total: number;
    unread: number;
  }>;
  bySeverity: Array<{
    severity: NotificationSeverity;
    total: number;
    unread: number;
  }>;
}

/**
 * Counts for the badge and the category/severity chips.
 *
 * Folds the database's per-type grouping into categories and severities in
 * application code, because neither exists as a column.
 */
export async function getNotificationSummary(
  userId: string,
  role: string
): Promise<NotificationSummary> {
  const { grouped, unreadTotal, total } =
    await notificationRepository.countsByType({ userId, role });

  const byCategory = new Map<NotificationCategory, { total: number; unread: number }>();
  const bySeverity = new Map<NotificationSeverity, { total: number; unread: number }>();

  for (const category of NOTIFICATION_CATEGORIES) {
    byCategory.set(category, { total: 0, unread: 0 });
  }

  for (const row of grouped) {
    const count = row._count._all;
    const category = categoryForType(row.type);
    const severity = severityForType(row.type);

    const c = byCategory.get(category) ?? { total: 0, unread: 0 };
    c.total += count;
    if (!row.isRead) c.unread += count;
    byCategory.set(category, c);

    const s = bySeverity.get(severity) ?? { total: 0, unread: 0 };
    s.total += count;
    if (!row.isRead) s.unread += count;
    bySeverity.set(severity, s);
  }

  return {
    total,
    unreadTotal,
    byCategory: [...byCategory.entries()].map(([category, counts]) => ({
      category,
      ...counts,
    })),
    bySeverity: [...bySeverity.entries()].map(([severity, counts]) => ({
      severity,
      ...counts,
    })),
  };
}

/**
 * Marks a specific set of notifications read.
 *
 * Returns the number actually updated. That can be lower than `ids.length` for
 * two legitimate reasons — some were already read, or some are not visible to
 * this user — and the caller does not get to distinguish them, deliberately:
 * reporting "3 of 5 were not yours" would confirm the other ids exist.
 */
export async function markManyAsRead(
  ids: string[],
  userId: string,
  role: string
): Promise<{ updated: number }> {
  const result = await notificationRepository.markManyAsRead(ids, userId, role);
  return { updated: result.count };
}
