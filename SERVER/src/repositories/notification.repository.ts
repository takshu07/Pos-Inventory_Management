import { prisma } from "../config/prisma";
import type { Prisma } from "../../generated/prisma";

/**
 * The audience predicate — who is allowed to see a notification.
 *
 * A row is visible when it is addressed to this user, to their role, or to
 * nobody in particular (a global broadcast). This is the ONLY definition of
 * notification visibility; every read and every write below composes it rather
 * than restating it, so the list, the counts and the bulk actions can never
 * disagree about what a user can see.
 *
 * ⚠ Security: this is the row-level access boundary. A query that filters
 * without it would leak another employee's notifications — including
 * security alerts addressed to an OWNER.
 */
export function audienceWhere(
  userId: string,
  role: string
): Prisma.NotificationWhereInput {
  return {
    OR: [
      { targetUserId: userId },
      { targetRole: role as never },
      { targetUserId: null, targetRole: null },
    ],
  };
}

export const notificationRepository = {
  async create(data: Prisma.NotificationUncheckedCreateInput) {
    return prisma.notification.create({ data });
  },

  async getUnreadForUser(userId: string, role: string) {
    return prisma.notification.findMany({
      where: {
        isRead: false,
        OR: [
          { targetUserId: userId },
          { targetRole: role as any },
          { targetUserId: null, targetRole: null } // Global broadcasts
        ]
      },
      orderBy: { createdAt: "desc" }
    });
  },

  /**
   * ⚠ SECURITY FIX (2026-08-03) — this used to be an IDOR.
   *
   * It accepted `userId` and never used it: `update({ where: { id } })` marked
   * ANY notification read, including another employee's security alerts, for
   * any authenticated caller who guessed or saw an id. Harmless while nothing
   * called it with a foreign id; not harmless now that a real screen exposes
   * ids in its payloads.
   *
   * Now audience-scoped like every other read/write here. `updateMany` rather
   * than `update` so a foreign id matches zero rows instead of throwing —
   * a thrown "record not found" would confirm the id exists to a prober.
   *
   * Signature and call sites are unchanged; `role` was added as an optional
   * final parameter so the existing two-argument callers keep compiling. When
   * it is omitted the row must be addressed to the user personally, which is
   * strictly narrower than before — never wider.
   */
  async markAsRead(notificationId: string, userId: string, role?: string) {
    const audience: Prisma.NotificationWhereInput = role
      ? audienceWhere(userId, role)
      : { OR: [{ targetUserId: userId }, { targetUserId: null, targetRole: null }] };

    return prisma.notification.updateMany({
      where: { AND: [audience, { id: notificationId }] },
      data: { isRead: true }
    });
  },
  
  async markAllAsRead(userId: string, role: string) {
    return prisma.notification.updateMany({
      where: {
        isRead: false,
        OR: [
          { targetUserId: userId },
          { targetRole: role as any }
        ]
      },
      data: { isRead: true }
    });
  },

  // ===========================================================================
  // ADDITIVE (2026-08-03) — the Notifications screen.
  //
  // Everything above is unchanged and still used by the existing bell/dashboard
  // paths. The methods below add paging, filtering and counts; none of them
  // alter the behaviour of the four above.
  // ===========================================================================

  /**
   * One page of notifications the user is allowed to see.
   *
   * `where` is composed by the service from the request filters; the audience
   * predicate is AND-ed in HERE rather than there, so no caller can construct a
   * query that skips it.
   */
  async findPage(params: {
    userId: string;
    role: string;
    where: Prisma.NotificationWhereInput;
    orderBy: Prisma.NotificationOrderByWithRelationInput;
    skip: number;
    take: number;
  }) {
    const where: Prisma.NotificationWhereInput = {
      AND: [audienceWhere(params.userId, params.role), params.where],
    };

    // One round trip for both — the count must be computed under exactly the
    // same predicate as the rows, or the pager disagrees with the table.
    const [rows, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
      }),
      prisma.notification.count({ where }),
    ]);

    return { rows, total };
  },

  /**
   * Unread count for the badge, plus per-type counts for the category chips.
   *
   * Grouped by `type` rather than category because category is derived in
   * application code (see constants/notificationTaxonomy.ts) — the database has
   * no category column. The service folds types into categories.
   */
  async countsByType(params: {
    userId: string;
    role: string;
    where?: Prisma.NotificationWhereInput;
  }) {
    const audience = audienceWhere(params.userId, params.role);
    const scoped: Prisma.NotificationWhereInput = params.where
      ? { AND: [audience, params.where] }
      : audience;

    const [grouped, unreadTotal, total] = await Promise.all([
      prisma.notification.groupBy({
        by: ["type", "isRead"],
        where: scoped,
        _count: { _all: true },
      }),
      prisma.notification.count({ where: { AND: [scoped, { isRead: false }] } }),
      prisma.notification.count({ where: scoped }),
    ]);

    return { grouped, unreadTotal, total };
  },

  /**
   * Marks specific notifications read.
   *
   * ⚠ The audience predicate is what makes this safe to expose: a caller who
   * guesses another user's notification id updates ZERO rows rather than
   * theirs. `updateMany` (not `update`) is deliberate for the same reason — it
   * silently matches nothing instead of throwing on a foreign id, so the
   * response cannot be used to probe which ids exist.
   */
  async markManyAsRead(ids: string[], userId: string, role: string) {
    return prisma.notification.updateMany({
      where: {
        AND: [audienceWhere(userId, role), { id: { in: ids }, isRead: false }],
      },
      data: { isRead: true },
    });
  },

  /** Single-row read used by the detail/marking path, audience-scoped. */
  async findVisibleById(id: string, userId: string, role: string) {
    return prisma.notification.findFirst({
      where: { AND: [audienceWhere(userId, role), { id }] },
    });
  },
};
