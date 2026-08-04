/**
 * Notifications — PERMANENT SECURITY REGRESSION SUITE.
 *
 * ⚠ DO NOT DELETE, SKIP, OR WEAKEN THESE TESTS. They exist because a real IDOR
 * shipped in `notificationRepository.markAsRead`, which accepted a `userId` and
 * never used it (`update({ where: { id } })`). Any authenticated caller could
 * mark ANY notification read — including security alerts addressed to the
 * OWNER — by supplying an id they did not own. Notification ids are exposed in
 * the feed payloads the Notifications screen renders, so the id was not secret.
 *
 * WHAT IS BEING PROTECTED
 * -----------------------
 * Notification visibility is row-level and audience-based, not role-based:
 * a row is visible when it is addressed to the user, to their role, or to
 * everyone. That predicate (`audienceWhere`) is the ONLY access boundary on
 * this module — the routes deliberately carry no `requireRole`, because every
 * employee legitimately has notifications. If the predicate stops being AND-ed
 * into a query, there is nothing else standing between a cashier and an
 * owner's alerts.
 *
 * WHY THIS IS A UNIT SUITE AND NOT AN INTEGRATION ONE
 * --------------------------------------------------
 * Prisma is mocked at the module boundary, so these tests assert the SHAPE of
 * every query the repository builds, with no database. That is deliberate:
 * integration suites here self-skip when no wipeable test database is
 * configured (`hasTestDatabase()`), and a security test that silently skips on
 * most checkouts is not a security test. This one runs everywhere, always.
 *
 * It follows that these assert query construction, not database behaviour. The
 * end-to-end behaviour was verified live against the running server on
 * 2026-08-03 (cashier POSTing an owner's notification id → `200 {updated: 0}`,
 * row still unread); this suite is what keeps a refactor from undoing it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Prisma mock. Every method the repository touches records the args it was
// called with so the tests can inspect the generated `where`.
// ---------------------------------------------------------------------------

const notification = {
  create: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
  groupBy: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
};

vi.mock("../config/prisma", () => ({
  prisma: { notification },
}));

const { audienceWhere, notificationRepository } = await import(
  "../repositories/notification.repository"
);

const CASHIER_ID = "cashier-user-id";
const OWNER_ID = "owner-user-id";
const OWNERS_NOTIFICATION_ID = "owners-private-notification-id";

beforeEach(() => {
  vi.clearAllMocks();
  notification.updateMany.mockResolvedValue({ count: 0 });
  notification.findMany.mockResolvedValue([]);
  notification.findFirst.mockResolvedValue(null);
  notification.count.mockResolvedValue(0);
  notification.groupBy.mockResolvedValue([]);
});

/**
 * Recursively collects every object in a Prisma `where` tree, so a test can ask
 * "does this predicate appear ANYWHERE in the query" without depending on how
 * deeply the repository happens to nest its `AND`/`OR` at the time.
 */
function flattenWhere(node: unknown, out: unknown[] = []): unknown[] {
  if (node === null || typeof node !== "object") return out;
  out.push(node);
  for (const value of Object.values(node as Record<string, unknown>)) {
    if (Array.isArray(value)) value.forEach((v) => flattenWhere(v, out));
    else flattenWhere(value, out);
  }
  return out;
}

/**
 * Asserts the audience predicate is present in a query's `where`.
 *
 * It looks for the three-way OR (me / my role / broadcast) rather than a deep
 * equality against the whole `where`, so adding a filter alongside it does not
 * fail the test — only REMOVING the boundary does.
 */
function expectAudienceScoped(where: unknown, userId: string, role: string) {
  const nodes = flattenWhere(where);

  const hasAudienceOr = nodes.some((node) => {
    const or = (node as { OR?: unknown }).OR;
    if (!Array.isArray(or)) return false;

    const targetsUser = or.some(
      (c) => (c as { targetUserId?: unknown }).targetUserId === userId
    );
    const targetsRole = or.some(
      (c) => (c as { targetRole?: unknown }).targetRole === role
    );
    const targetsBroadcast = or.some((c) => {
      const clause = c as { targetUserId?: unknown; targetRole?: unknown };
      return clause.targetUserId === null && clause.targetRole === null;
    });

    return targetsUser && targetsRole && targetsBroadcast;
  });

  expect(
    hasAudienceOr,
    "query is NOT audience-scoped — this is the IDOR boundary"
  ).toBe(true);
}

// ===========================================================================
// The predicate itself
// ===========================================================================

describe("audienceWhere — the access boundary", () => {
  it("admits rows addressed to the user, their role, or everyone", () => {
    const where = audienceWhere(CASHIER_ID, "CASHIER");

    expect(where.OR).toEqual([
      { targetUserId: CASHIER_ID },
      { targetRole: "CASHIER" },
      { targetUserId: null, targetRole: null },
    ]);
  });

  it("scopes to the caller's OWN id — never a wildcard", () => {
    const where = audienceWhere(CASHIER_ID, "CASHIER");
    const clauses = where.OR as Array<Record<string, unknown>>;

    // A broadcast row is `targetUserId: null AND targetRole: null` together.
    // A bare `{ targetUserId: null }` would match every role-targeted row and
    // silently open the boundary.
    const bareNullUser = clauses.find(
      (c) => c["targetUserId"] === null && !("targetRole" in c)
    );
    expect(bareNullUser).toBeUndefined();
  });

  it("does not admit another user's personally-addressed rows", () => {
    const where = audienceWhere(CASHIER_ID, "CASHIER");
    const serialised = JSON.stringify(where);

    expect(serialised).not.toContain(OWNER_ID);
  });
});

// ===========================================================================
// THE ORIGINAL IDOR
// ===========================================================================

describe("markAsRead — the fixed IDOR", () => {
  it("uses the userId it was given (the original bug ignored it entirely)", async () => {
    await notificationRepository.markAsRead(
      OWNERS_NOTIFICATION_ID,
      CASHIER_ID,
      "CASHIER"
    );

    const args = notification.updateMany.mock.calls[0]?.[0];
    expectAudienceScoped(args.where, CASHIER_ID, "CASHIER");
  });

  it("constrains by id AND audience, never by id alone", async () => {
    await notificationRepository.markAsRead(
      OWNERS_NOTIFICATION_ID,
      CASHIER_ID,
      "CASHIER"
    );

    const args = notification.updateMany.mock.calls[0]?.[0];

    // The exact shape of the vulnerable query: `{ where: { id } }` with nothing
    // else. If this ever passes again, the IDOR is back.
    expect(args.where).not.toEqual({ id: OWNERS_NOTIFICATION_ID });

    const nodes = flattenWhere(args.where);
    expect(nodes.some((n) => (n as { id?: unknown }).id === OWNERS_NOTIFICATION_ID)).toBe(true);
  });

  it("uses updateMany, not update, so a foreign id matches 0 rows instead of throwing", async () => {
    await notificationRepository.markAsRead(
      OWNERS_NOTIFICATION_ID,
      CASHIER_ID,
      "CASHIER"
    );

    // `update` throws "record not found" on a non-matching row, which confirms
    // to a prober whether an id exists. `updateMany` reports 0 either way.
    expect(notification.update).not.toHaveBeenCalled();
    expect(notification.updateMany).toHaveBeenCalledTimes(1);
  });

  it("NARROWS, never widens, when role is omitted by a legacy 2-arg caller", async () => {
    await notificationRepository.markAsRead(OWNERS_NOTIFICATION_ID, CASHIER_ID);

    const args = notification.updateMany.mock.calls[0]?.[0];
    const serialised = JSON.stringify(args.where);

    // Without a role the row must be addressed to the user personally or be a
    // broadcast — strictly narrower than the audience predicate, and still
    // never unscoped.
    expect(serialised).toContain(CASHIER_ID);
    expect(args.where).not.toEqual({ id: OWNERS_NOTIFICATION_ID });
  });
});

// ===========================================================================
// EVERY OTHER QUERY AND MUTATION
// Item 4 of the closing scope: audience scoping is preserved on ALL of them.
// ===========================================================================

describe("every read is audience-scoped", () => {
  it("getUnreadForUser", async () => {
    await notificationRepository.getUnreadForUser(CASHIER_ID, "CASHIER");

    const args = notification.findMany.mock.calls[0]?.[0];
    expectAudienceScoped(args.where, CASHIER_ID, "CASHIER");
  });

  it("findPage — and the count uses the SAME predicate as the rows", async () => {
    await notificationRepository.findPage({
      userId: CASHIER_ID,
      role: "CASHIER",
      where: { isRead: false },
      orderBy: { createdAt: "desc" },
      skip: 0,
      take: 25,
    });

    const rowsArgs = notification.findMany.mock.calls[0]?.[0];
    const countArgs = notification.count.mock.calls[0]?.[0];

    expectAudienceScoped(rowsArgs.where, CASHIER_ID, "CASHIER");
    expectAudienceScoped(countArgs.where, CASHIER_ID, "CASHIER");

    // A count computed under a looser predicate would leak the EXISTENCE of
    // invisible rows through the pager's total even though no row is returned.
    expect(countArgs.where).toEqual(rowsArgs.where);
  });

  it("findPage applies the audience even when the caller passes an empty filter", async () => {
    await notificationRepository.findPage({
      userId: CASHIER_ID,
      role: "CASHIER",
      where: {},
      orderBy: { createdAt: "desc" },
      skip: 0,
      take: 25,
    });

    const rowsArgs = notification.findMany.mock.calls[0]?.[0];
    expectAudienceScoped(rowsArgs.where, CASHIER_ID, "CASHIER");
  });

  it("countsByType — the badge count cannot include invisible rows", async () => {
    await notificationRepository.countsByType({
      userId: CASHIER_ID,
      role: "CASHIER",
    });

    for (const call of notification.count.mock.calls) {
      expectAudienceScoped(call[0].where, CASHIER_ID, "CASHIER");
    }
    const groupArgs = notification.groupBy.mock.calls[0]?.[0];
    expectAudienceScoped(groupArgs.where, CASHIER_ID, "CASHIER");
  });

  it("findVisibleById — a foreign id resolves to nothing, not to the row", async () => {
    await notificationRepository.findVisibleById(
      OWNERS_NOTIFICATION_ID,
      CASHIER_ID,
      "CASHIER"
    );

    const args = notification.findFirst.mock.calls[0]?.[0];
    expectAudienceScoped(args.where, CASHIER_ID, "CASHIER");
    expect(args.where).not.toEqual({ id: OWNERS_NOTIFICATION_ID });
  });
});

describe("every mutation is audience-scoped", () => {
  it("markManyAsRead — a bulk payload of foreign ids updates nothing", async () => {
    await notificationRepository.markManyAsRead(
      [OWNERS_NOTIFICATION_ID, "another-foreign-id"],
      CASHIER_ID,
      "CASHIER"
    );

    const args = notification.updateMany.mock.calls[0]?.[0];
    expectAudienceScoped(args.where, CASHIER_ID, "CASHIER");

    // Bulk is the highest-leverage version of the original bug: one request
    // could have cleared an entire store's alerts.
    expect(notification.update).not.toHaveBeenCalled();
  });

  it("markAllAsRead — 'all' means all of MINE", async () => {
    await notificationRepository.markAllAsRead(CASHIER_ID, "CASHIER");

    const args = notification.updateMany.mock.calls[0]?.[0];
    const serialised = JSON.stringify(args.where);

    expect(serialised).toContain(CASHIER_ID);
    expect(serialised).not.toContain(OWNER_ID);
    // Must never degrade to an unfiltered "mark everything read".
    expect(args.where).not.toEqual({ isRead: false });
  });
});
