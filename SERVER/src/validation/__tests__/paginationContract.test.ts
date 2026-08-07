// =============================================================================
// PAGINATION CONTRACT — regression tests
//
// These exist because of a live bug class: four client call sites hard-coded
// `limit: 200` against endpoints capped at 100. The server does not clamp an
// over-cap `limit` — zod REJECTS the request — so each of those pages issued a
// request that failed 100% of the time with `400 Validation failed` and
// rendered no data:
//
//   CycleCountsPage    → /inventory/stock   (category picker silently empty)
//   StockOverviewPage  → /inventory/stock   (via a bookmarkable ?inv_limit URL)
//   dashboardApi       → /sales             (today's revenue tile read 0)
//   procurementApi     → /suppliers         (create-purchase picker empty)
//
// The value 200 was not invented: /workforce/roster genuinely allows 200, and
// the number was copied to endpoints that do not. So the useful thing to pin is
// not "200 is wrong" but the actual cap of each endpoint, and the fact that
// exceeding it THROWS rather than clamps.
//
// CLIENT/src/lib/api/pagination.ts mirrors these numbers. If a cap is changed
// on either side without the other, this file fails — which is the point. A
// silent divergence here does not surface as a test failure or a type error; it
// surfaces as a blank page in production.
// =============================================================================

import { describe, expect, it } from "vitest";

import { paginationSchema } from "../common.validation";
import { inventoryValidation } from "../inventory.validation";
import { saleValidation } from "../sale.validation";
import { supplierValidation } from "../catalog.validation";
import { workforceValidation } from "../workforce.validation";

/**
 * Mirrors CLIENT/src/lib/api/pagination.ts. Kept as a literal rather than an
 * import because the two projects do not share a module graph — this file IS
 * the assertion that the copied constant is still true.
 */
const CLIENT_DEFAULT_MAX_LIMIT = 100;
const CLIENT_ROSTER_MAX_LIMIT = 200;

describe("the shared pagination cap", () => {
  it("is the value the client mirrors", () => {
    const ok = paginationSchema.safeParse({ limit: CLIENT_DEFAULT_MAX_LIMIT });
    expect(ok.success).toBe(true);
  });

  it("REJECTS an over-cap limit rather than clamping it", () => {
    // This is the whole reason the bug was invisible in code review: a schema
    // that clamped would have quietly returned 100 rows and nobody would have
    // noticed. Rejecting means the page gets nothing at all.
    const result = paginationSchema.safeParse({ limit: CLIENT_DEFAULT_MAX_LIMIT + 1 });
    expect(result.success).toBe(false);
  });

  it("rejects the specific value that was hard-coded on the client", () => {
    expect(paginationSchema.safeParse({ limit: 200 }).success).toBe(false);
  });
});

describe("endpoint caps the client hard-codes against", () => {
  it("/inventory/stock accepts the client's max and refuses more", () => {
    const schema = inventoryValidation.stockQuery;
    expect(schema.safeParse({ limit: CLIENT_DEFAULT_MAX_LIMIT }).success).toBe(true);
    expect(schema.safeParse({ limit: CLIENT_DEFAULT_MAX_LIMIT + 1 }).success).toBe(false);
  });

  it("/sales accepts the client's max and refuses more", () => {
    const schema = saleValidation.listQuery;
    expect(schema.safeParse({ limit: CLIENT_DEFAULT_MAX_LIMIT }).success).toBe(true);
    expect(schema.safeParse({ limit: CLIENT_DEFAULT_MAX_LIMIT + 1 }).success).toBe(false);
  });

  it("/suppliers accepts the client's max and refuses more", () => {
    const schema = supplierValidation.listQuery;
    expect(schema.safeParse({ limit: CLIENT_DEFAULT_MAX_LIMIT }).success).toBe(true);
    expect(schema.safeParse({ limit: CLIENT_DEFAULT_MAX_LIMIT + 1 }).success).toBe(false);
  });

  it("/workforce/roster really does allow 200 — the copied value's origin", () => {
    // Pinned so nobody 'consistently' lowers this to 100 and breaks the two
    // roster pickers that legitimately rely on it.
    const schema = workforceValidation.rosterQuery;
    expect(schema.safeParse({ limit: CLIENT_ROSTER_MAX_LIMIT }).success).toBe(true);
    expect(schema.safeParse({ limit: CLIENT_ROSTER_MAX_LIMIT + 1 }).success).toBe(false);
  });
});
