/**
 * Regression tests for the Audit Logs transport layer.
 *
 * These pin the decisions in auditApi.ts that are invisible at the call site
 * and would fail SILENTLY — this module's failure mode is an empty table, not
 * an exception, which is the worst possible failure for an audit screen:
 *
 *   1. THE ENVELOPE LEVEL. The axios interceptor already returns
 *      `response.data`, so rows are at `res.data` and pagination at `res.meta`.
 *      Reading the wrong level yields an empty list without throwing — and an
 *      empty audit trail reads as "nothing happened", not as "the UI is broken".
 *
 *   2. ARRAY FILTERS ARE COMMA-JOINED. The server accepts comma lists; sending
 *      an actual array makes axios emit `module[]=...`, which the enum rejects.
 *
 *   3. EMPTY VALUES ARE DROPPED. `?module=` fails the server's zod enum rather
 *      than reading as "no filter".
 *
 *   4. `totalIsExact` DEFAULTS TO TRUE. It is the flag that makes the UI render
 *      "10,000+"; defaulting it to false would mislabel every exact count.
 *
 *   5. THERE ARE NO WRITE FUNCTIONS. The trail must not be editable via the API.
 *
 * apiClient is mocked at the module boundary: transport test, not network test.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
  },
}));

const api = await import("../api/auditApi");

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: [], meta: { total: 0, page: 1, totalPages: 1 } });
});

/**
 * The params object axios was handed on the most recent call.
 *
 * Indexed rather than `.at(-1)`: the project targets ES2020, where `Array.at`
 * is not in the lib. Vitest transpiles the test regardless, so `.at` ran fine
 * and only `tsc` complained — which is exactly how it survived unnoticed.
 */
function lastParams(): Record<string, unknown> {
  const calls = get.mock.calls;
  const call = calls[calls.length - 1];
  return (call?.[1] as { params?: Record<string, unknown> })?.params ?? {};
}

// =============================================================================
// ENDPOINT ROUTING
// =============================================================================

describe("endpoint routing", () => {
  it("reads the list from the owner-only audit tree", async () => {
    await api.fetchAuditLogs({ page: 1, limit: 25 });
    expect(get).toHaveBeenCalledWith("/owner/audit-logs", expect.anything());
  });

  it("reads one entry by id", async () => {
    get.mockResolvedValue({ data: { id: "log_1" } });
    await api.fetchAuditLog("log_1");
    expect(get).toHaveBeenCalledWith("/owner/audit-logs/log_1");
  });

  it("reads related entries from the entry's own subpath", async () => {
    get.mockResolvedValue({ data: [] });
    await api.fetchRelatedAuditLogs("log_1", 5);
    expect(get).toHaveBeenCalledWith(
      "/owner/audit-logs/log_1/related",
      expect.objectContaining({ params: { limit: 5 } })
    );
  });

  it("reads filter options and summary from their static paths", async () => {
    get.mockResolvedValue({ data: {} });

    await api.fetchAuditFilterOptions();
    expect(get).toHaveBeenCalledWith("/owner/audit-logs/filters");

    await api.fetchAuditSummary({ period: "month" });
    expect(get).toHaveBeenCalledWith(
      "/owner/audit-logs/summary",
      expect.anything()
    );
  });

  it("exposes no write functions", () => {
    // The audit trail is append-only and is written by the acting module, never
    // through this API. A create/update/delete appearing here is a design break.
    const surface = Object.keys(api);
    for (const name of surface) {
      expect(name).not.toMatch(/^(create|update|delete|patch|post|remove)/i);
    }
  });
});

// =============================================================================
// ENVELOPE UNWRAPPING
// =============================================================================

describe("response envelope", () => {
  it("reads rows from res.data and pagination from res.meta", async () => {
    get.mockResolvedValue({
      data: [{ id: "log_1" }, { id: "log_2" }],
      meta: {
        total: 2,
        totalIsExact: true,
        page: 1,
        limit: 25,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });

    const result = await api.fetchAuditLogs({ page: 1, limit: 25 });

    expect(result.data).toHaveLength(2);
    expect(result.meta.total).toBe(2);
  });

  it("returns an empty list rather than throwing on a malformed response", async () => {
    get.mockResolvedValue({});
    const result = await api.fetchAuditLogs({ page: 1, limit: 25 });
    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
  });

  it("defaults totalIsExact to true when the server omits it", async () => {
    // Only a CAPPED count sets this false. Defaulting the other way would put
    // a "+" on every exact total in the UI.
    get.mockResolvedValue({ data: [], meta: { total: 7 } });
    const result = await api.fetchAuditLogs({ page: 1, limit: 25 });
    expect(result.meta.totalIsExact).toBe(true);
  });

  it("preserves totalIsExact:false so the UI can render 10,000+", async () => {
    get.mockResolvedValue({
      data: [],
      meta: { total: 10000, totalIsExact: false },
    });
    const result = await api.fetchAuditLogs({ page: 1, limit: 25 });
    expect(result.meta.totalIsExact).toBe(false);
  });

  it("derives totalPages when the server omits it", async () => {
    get.mockResolvedValue({ data: [], meta: { total: 55 } });
    const result = await api.fetchAuditLogs({ page: 1, limit: 25 });
    expect(result.meta.totalPages).toBe(3);
  });
});

// =============================================================================
// QUERY SERIALISATION
// =============================================================================

describe("query serialisation", () => {
  it("joins array filters into comma lists", async () => {
    // An actual array makes axios emit `module[]=SALE`, which the server's enum
    // rejects. The server accepts "SALE,INVENTORY".
    await api.fetchAuditLogs({
      page: 1,
      limit: 25,
      module: ["SALE", "INVENTORY"],
      severity: ["CRITICAL"],
    });

    expect(lastParams().module).toBe("SALE,INVENTORY");
    expect(lastParams().severity).toBe("CRITICAL");
  });

  it("drops empty strings, nulls and empty arrays", async () => {
    // `?module=` is a 400 from the server's enum, not "no filter".
    await api.fetchAuditLogs({
      page: 1,
      limit: 25,
      search: "",
      employeeId: "",
      module: [],
      severity: [],
    });

    const params = lastParams();
    expect(params).not.toHaveProperty("search");
    expect(params).not.toHaveProperty("employeeId");
    expect(params).not.toHaveProperty("module");
    expect(params).not.toHaveProperty("severity");
  });

  it("keeps real filter values", async () => {
    await api.fetchAuditLogs({
      page: 2,
      limit: 50,
      search: "clx123",
      employeeId: "emp_1",
      period: "week",
      sortBy: "severity",
      sortOrder: "desc",
    });

    expect(lastParams()).toMatchObject({
      page: 2,
      limit: 50,
      search: "clx123",
      employeeId: "emp_1",
      period: "week",
      sortBy: "severity",
      sortOrder: "desc",
    });
  });

  it("passes a custom date range through unchanged", async () => {
    await api.fetchAuditLogs({
      page: 1,
      limit: 25,
      period: "custom",
      from: "2026-07-01",
      to: "2026-07-31",
    });

    expect(lastParams()).toMatchObject({
      period: "custom",
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });
});
