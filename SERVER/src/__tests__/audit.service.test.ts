// =============================================================================
// AUDIT LOG SERVICE — regression tests
//
// These cover the query-building decisions that make the module correct AND
// fast, all of which fail silently if broken — a wrong `where` returns rows,
// just not the right ones, and nobody notices until the trail is needed.
//
//   • A severity filter must become an indexed `action IN (...)`. If it ever
//     reached SQL as a computed expression it would sequentially scan the
//     largest table in the system.
//   • Severity ∩ action must intersect, and an impossible combination must
//     return NOTHING rather than everything. Falling back to "no filter" on an
//     empty intersection is the classic bug, and it silently widens an audit
//     query — the worst direction to be wrong in.
//   • Date windows must be HALF-OPEN (`lt`, not `lte`), or every period leaks
//     the first row of the next one.
//   • Deep offset paging must be REFUSED, not served slowly.
//   • The list must never select the JSON snapshots.
//
// Prisma is mocked at the module boundary: these assert the QUERY, which is the
// thing under test, without needing a database (the integration suite cannot
// run here — see procurement.engine.test.ts for why).
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const findUnique = vi.fn();
const findFirst = vi.fn();
const groupBy = vi.fn();
const $transaction = vi.fn();

vi.mock("../config/prisma", () => ({
  prisma: {
    auditLog: {
      findMany: (...a: unknown[]) => findMany(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
      groupBy: (...a: unknown[]) => groupBy(...a),
    },
    loginHistory: { findFirst: (...a: unknown[]) => findFirst(...a) },
    employee: { findMany: (...a: unknown[]) => findMany(...a) },
    $transaction: (...a: unknown[]) => $transaction(...a),
  },
}));

vi.mock("../config/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const service = await import("../services/audit.service");
const { auditValidation } = await import("../validation/audit.validation");

/**
 * The args handed to the PAGE query.
 *
 * The service calls `prisma.auditLog.findMany(...)` twice inside
 * `$transaction([...])` — for the page and for the capped count. Those calls
 * are evaluated BEFORE `$transaction` receives anything, so the arguments are
 * captured from the `findMany` mock, not from `$transaction`. The page query is
 * the one carrying `orderBy`; the count query selects only `id`.
 */
function pageQueryArgs(): Record<string, any> {
  const call = findMany.mock.calls.find(
    (args) => (args[0] as { orderBy?: unknown })?.orderBy !== undefined
  );
  return (call?.[0] as Record<string, any>) ?? {};
}

/** Runs a list query and returns the `where` Prisma was handed. */
async function whereFor(raw: Record<string, unknown>) {
  const query = auditValidation.listQuery.parse(raw);
  await service.listAuditLogs(query, new Date(2026, 7, 3, 12, 0, 0));
  return pageQueryArgs().where ?? {};
}

beforeEach(() => {
  vi.clearAllMocks();
  // $transaction receives an array of already-issued promises and resolves
  // them, which is also what the real client does. Tests that need specific
  // rows override this with an explicit [rows, countRows] pair.
  $transaction.mockImplementation((queries: unknown) =>
    Promise.all(queries as Promise<unknown>[])
  );
  findMany.mockResolvedValue([]);
  findUnique.mockResolvedValue(null);
  findFirst.mockResolvedValue(null);
  groupBy.mockResolvedValue([]);
});

// =============================================================================
// SEVERITY → ACTION TRANSLATION
// =============================================================================

describe("severity filtering stays indexed", () => {
  it("translates a severity into an action IN (...) predicate", async () => {
    const where = await whereFor({ severity: "CRITICAL", period: "all" });

    // The key assertion: severity never reaches SQL as a derived expression.
    expect(where).not.toHaveProperty("severity");
    expect(where.action).toBeDefined();
    expect(Array.isArray(where.action.in)).toBe(true);
    expect(where.action.in).toContain("DELETE");
    expect(where.action.in).toContain("ROLE_CHANGED");
    // A LOW action must not appear in the CRITICAL set.
    expect(where.action.in).not.toContain("LOGIN");
  });

  it("covers multiple severities at once", async () => {
    const where = await whereFor({ severity: "CRITICAL,LOW", period: "all" });
    expect(where.action.in).toContain("DELETE"); // CRITICAL
    expect(where.action.in).toContain("LOGIN");  // LOW
    expect(where.action.in).not.toContain("CREATE"); // MEDIUM
  });

  it("applies NO action predicate when every severity is selected", async () => {
    // An `IN` listing all 41 actions is strictly worse than no predicate.
    const where = await whereFor({
      severity: "CRITICAL,HIGH,MEDIUM,LOW",
      period: "all",
    });
    expect(where.action).toBeUndefined();
  });

  it("intersects an explicit action filter with the severity filter", async () => {
    const where = await whereFor({
      severity: "CRITICAL",
      action: "DELETE,LOGIN",
      period: "all",
    });

    // DELETE is CRITICAL and survives; LOGIN is LOW and is filtered out.
    expect(where.action.in).toEqual(["DELETE"]);
  });

  it("returns an EMPTY set for an impossible combination, never an unfiltered one", async () => {
    // Asking for LOW severity AND the DELETE action describes no possible row.
    // Treating the empty intersection as "no filter" would silently widen an
    // audit query — the most dangerous direction to be wrong in.
    const where = await whereFor({
      severity: "LOW",
      action: "DELETE",
      period: "all",
    });

    expect(where.action).toBeDefined();
    expect(where.action.in).toEqual([]);
  });
});

// =============================================================================
// DATE WINDOWS
// =============================================================================

describe("date windows", () => {
  it("uses a half-open range so periods never overlap", async () => {
    const where = await whereFor({ period: "today" });

    expect(where.createdAt.gte).toBeInstanceOf(Date);
    // `lt`, never `lte` — otherwise every window leaks one row from the next.
    expect(where.createdAt).toHaveProperty("lt");
    expect(where.createdAt).not.toHaveProperty("lte");
  });

  it("applies no date predicate for period=all", async () => {
    const where = await whereFor({ period: "all" });
    expect(where.createdAt).toBeUndefined();
  });

  it("honours an explicit custom range", async () => {
    const where = await whereFor({
      period: "custom",
      from: "2026-07-01",
      to: "2026-07-31",
    });

    expect(where.createdAt.gte).toEqual(new Date("2026-07-01"));
    expect(where.createdAt.lt).toEqual(new Date("2026-07-31"));
  });
});

// =============================================================================
// OTHER FILTERS
// =============================================================================

describe("filters map to indexed columns", () => {
  it("filters by actor, module, entity and record", async () => {
    const where = await whereFor({
      employeeId: "emp_1",
      module: "SALE,INVENTORY",
      tableName: "sales",
      recordId: "rec_1",
      period: "all",
    });

    expect(where.employeeId).toBe("emp_1");
    expect(where.module.in).toEqual(["SALE", "INVENTORY"]);
    expect(where.tableName).toBe("sales");
    expect(where.recordId).toBe("rec_1");
  });

  it("searches the record id and the actor, not the JSON snapshots", async () => {
    // Searching inside oldData/newData would force a sequential scan with a
    // JSON cast on every row of the biggest table.
    const where = await whereFor({ search: "clx123", period: "all" });

    const searched = JSON.stringify(where.OR);
    expect(searched).toContain("recordId");
    expect(searched).toContain("employee");
    expect(searched).not.toContain("oldData");
    expect(searched).not.toContain("newData");
  });
});

// =============================================================================
// PAGINATION
// =============================================================================

describe("pagination", () => {
  it("refuses to page beyond the offset cap instead of serving a slow query", async () => {
    // OFFSET 250000 makes Postgres walk and discard a quarter of a million rows
    // for one page. The error tells the reader to narrow instead.
    const query = auditValidation.listQuery.parse({ page: "100000", limit: "100" });
    await expect(service.listAuditLogs(query)).rejects.toThrow(/narrow/i);
  });

  it("allows a reachable page", async () => {
    const query = auditValidation.listQuery.parse({ page: "2", limit: "25" });
    await expect(service.listAuditLogs(query)).resolves.toBeDefined();
  });

  it("reports a capped count as inexact and keeps hasNextPage true", async () => {
    // 26 rows for a 25-row page, and a count query that came back over the cap.
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: `log_${i}`,
      action: "CREATE",
      module: "SALE",
      tableName: "sales",
      recordId: "rec",
      createdAt: new Date(),
      employee: {
        id: "e1", firstName: "A", lastName: "B", role: "OWNER", email: null,
      },
    }));
    // Over the 10,000 cap.
    const countRows = Array.from({ length: 10_001 }, (_, i) => ({ id: `x${i}` }));
    // Bypasses the pass-through so the two batched queries resolve to distinct
    // results (the real client resolves them positionally, as here).
    $transaction.mockResolvedValue([rows, countRows]);

    const query = auditValidation.listQuery.parse({ page: "1", limit: "25" });
    const result = await service.listAuditLogs(query);

    expect(result.meta.totalIsExact).toBe(false);
    expect(result.meta.total).toBe(10_000);
    // A full page is itself the signal that more exist when the count is capped.
    expect(result.meta.hasNextPage).toBe(true);
  });

  it("reports an exact count when under the cap", async () => {
    $transaction.mockResolvedValue([[], [{ id: "a" }, { id: "b" }]]);
    const query = auditValidation.listQuery.parse({ page: "1", limit: "25" });
    const result = await service.listAuditLogs(query);

    expect(result.meta.totalIsExact).toBe(true);
    expect(result.meta.total).toBe(2);
  });
});

// =============================================================================
// PAYLOAD DISCIPLINE
// =============================================================================

describe("the list never reads the JSON snapshots", () => {
  it("selects no oldData/newData in the page query", async () => {
    // These blobs are the heaviest thing in the row and useless in a table.
    await whereFor({ period: "all" });

    const select = pageQueryArgs().select ?? {};

    expect(select).not.toHaveProperty("oldData");
    expect(select).not.toHaveProperty("newData");
    expect(select).toHaveProperty("action");
  });

  it("orders by a stable tiebreaker so offset paging cannot skip rows", async () => {
    // Without `id`, rows sharing a timestamp can reorder between requests,
    // which makes offset pagination drop or duplicate entries.
    await whereFor({ period: "all" });

    expect(JSON.stringify(pageQueryArgs().orderBy ?? [])).toContain("id");
  });
});

// =============================================================================
// DETAIL
// =============================================================================

describe("detail", () => {
  it("404s for an unknown entry", async () => {
    findUnique.mockResolvedValue(null);
    await expect(service.getAuditLog("nope")).rejects.toThrow(/not found/i);
  });

  it("labels correlated network context as session-derived", async () => {
    findUnique.mockResolvedValue({
      id: "log_1",
      action: "UPDATE",
      module: "PRODUCT",
      tableName: "products",
      recordId: "prod_1",
      createdAt: new Date("2026-08-03T10:00:00Z"),
      oldData: { price: 100 },
      newData: { price: 150 },
      employee: {
        id: "e1", firstName: "A", lastName: "B", role: "OWNER",
        email: "a@b.c", phone: "123", employeeCode: "EMP1",
      },
    });
    findFirst.mockResolvedValue({
      ipAddress: "10.0.0.1",
      device: "Desktop",
      browser: "Chrome",
      operatingSystem: "Windows",
      loginAt: new Date("2026-08-03T09:00:00Z"),
    });

    const detail = await service.getAuditLog("log_1");

    // The audit row itself stores no IP. Tagging the source is what keeps the
    // UI from presenting an inference as a recorded fact.
    expect(detail.context?.source).toBe("SESSION");
    expect(detail.context?.ipAddress).toBe("10.0.0.1");
    // And the diff came through.
    expect(detail.changes).toHaveLength(1);
    expect(detail.changes[0]?.field).toBe("price");
  });

  it("returns null context when no covering session exists", async () => {
    findUnique.mockResolvedValue({
      id: "log_1",
      action: "LOGIN",
      module: "AUTH",
      tableName: "employees",
      recordId: "e1",
      createdAt: new Date(),
      oldData: null,
      newData: null,
      employee: {
        id: "e1", firstName: "A", lastName: "B", role: "OWNER",
        email: null, phone: "1", employeeCode: "E1",
      },
    });
    findFirst.mockResolvedValue(null);

    const detail = await service.getAuditLog("log_1");
    expect(detail.context).toBeNull();
  });
});
