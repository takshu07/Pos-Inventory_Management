// =============================================================================
// AUDIT LOG VALIDATION — regression tests
//
// The query schema is a SECURITY control as much as a convenience: `sortBy` and
// `sortOrder` reach an ORDER BY and `module`/`action` reach a WHERE, so the
// enums are what stop a caller-supplied string from becoming part of a query.
//
// These lock down:
//   • that an unknown sort key or filter value is REJECTED, not passed through;
//   • that both comma-list and repeated-param array forms work, since a client
//     may plausibly send either and silently ignoring one produces a "the
//     filter doesn't work" bug;
//   • that a custom period cannot be requested without both ends, which would
//     otherwise silently degrade to an unbounded scan of the largest table;
//   • that `limit` is capped, since an uncapped page size on this table is a
//     denial-of-service surface.
// =============================================================================

import { describe, expect, it } from "vitest";

import { auditValidation } from "../validation/audit.validation";

const listQuery = auditValidation.listQuery;

// =============================================================================
// DEFAULTS
// =============================================================================

describe("list query defaults", () => {
  it("defaults to page 1, newest first, over the last month", () => {
    const parsed = listQuery.parse({});

    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(25);
    expect(parsed.sortBy).toBe("createdAt");
    expect(parsed.sortOrder).toBe("desc");
    // NOT "all": defaulting to the whole table would make the first request the
    // most expensive one the screen can issue.
    expect(parsed.period).toBe("month");
  });

  it("coerces numeric strings from the query string", () => {
    const parsed = listQuery.parse({ page: "3", limit: "50" });
    expect(parsed.page).toBe(3);
    expect(parsed.limit).toBe(50);
  });
});

// =============================================================================
// LIMITS
// =============================================================================

describe("pagination limits", () => {
  it("caps limit at 100", () => {
    // An uncapped page size on the largest table is a DoS surface.
    expect(() => listQuery.parse({ limit: "5000" })).toThrow();
  });

  it("rejects a page below 1", () => {
    expect(() => listQuery.parse({ page: "0" })).toThrow();
    expect(() => listQuery.parse({ page: "-2" })).toThrow();
  });
});

// =============================================================================
// ENUM GUARDS — the injection surface
// =============================================================================

describe("enum guards", () => {
  it("rejects a sort key outside the allowed set", () => {
    // This is what keeps `sortBy` out of the ORDER BY as free text.
    expect(() => listQuery.parse({ sortBy: "employeeId; DROP TABLE" })).toThrow();
    expect(() => listQuery.parse({ sortBy: "module" })).toThrow();
  });

  it("accepts only the two supported sort keys", () => {
    expect(listQuery.parse({ sortBy: "createdAt" }).sortBy).toBe("createdAt");
    expect(listQuery.parse({ sortBy: "severity" }).sortBy).toBe("severity");
  });

  it("rejects an unknown module, action or severity", () => {
    expect(() => listQuery.parse({ module: "NOT_A_MODULE" })).toThrow();
    expect(() => listQuery.parse({ action: "NOT_AN_ACTION" })).toThrow();
    expect(() => listQuery.parse({ severity: "SORT_OF_BAD" })).toThrow();
  });

  it("rejects a sort order that is not asc or desc", () => {
    expect(() => listQuery.parse({ sortOrder: "sideways" })).toThrow();
  });
});

// =============================================================================
// MULTI-VALUE FILTERS
// =============================================================================

describe("multi-value filters", () => {
  it("accepts a comma-separated list", () => {
    const parsed = listQuery.parse({ module: "SALE,INVENTORY" });
    expect(parsed.module).toEqual(["SALE", "INVENTORY"]);
  });

  it("accepts a repeated query param", () => {
    // Supporting one form and silently ignoring the other is how "the filter
    // doesn't work" bugs happen.
    const parsed = listQuery.parse({ module: ["SALE", "INVENTORY"] });
    expect(parsed.module).toEqual(["SALE", "INVENTORY"]);
  });

  it("tolerates whitespace and trailing separators", () => {
    const parsed = listQuery.parse({ severity: "CRITICAL, HIGH," });
    expect(parsed.severity).toEqual(["CRITICAL", "HIGH"]);
  });

  it("treats an empty value as no filter rather than an error", () => {
    expect(listQuery.parse({ module: "" }).module).toBeUndefined();
  });

  it("rejects a list containing one bad value", () => {
    // Partial acceptance would silently widen the result set.
    expect(() => listQuery.parse({ module: "SALE,NOPE" })).toThrow();
  });
});

// =============================================================================
// DATE RANGE
// =============================================================================

describe("date range", () => {
  it("requires both ends for a custom period", () => {
    // Without this the request degrades to an unbounded scan.
    expect(() => listQuery.parse({ period: "custom" })).toThrow();
    expect(() => listQuery.parse({ period: "custom", from: "2026-01-01" })).toThrow();
  });

  it("accepts a complete custom range", () => {
    const parsed = listQuery.parse({
      period: "custom",
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(parsed.from).toBeInstanceOf(Date);
    expect(parsed.to).toBeInstanceOf(Date);
  });

  it("rejects an inverted range", () => {
    expect(() =>
      listQuery.parse({ period: "custom", from: "2026-07-31", to: "2026-07-01" })
    ).toThrow();
  });

  it("accepts every named period", () => {
    for (const period of [
      "today", "yesterday", "week", "month", "quarter", "year", "all",
    ]) {
      expect(listQuery.parse({ period }).period).toBe(period);
    }
  });
});

// =============================================================================
// SEARCH
// =============================================================================

describe("search", () => {
  it("trims and accepts a normal term", () => {
    expect(listQuery.parse({ search: "  clx123  " }).search).toBe("clx123");
  });

  it("rejects an over-long term", () => {
    expect(() => listQuery.parse({ search: "x".repeat(200) })).toThrow();
  });
});
