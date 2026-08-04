/**
 * Regression tests for the catalog LOOKUP transport (categories / brands /
 * suppliers) — the lists that fill every filter dropdown.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The filter dropdowns showed an incomplete option list. Three separate causes,
 * all invisible at the call site:
 *
 *   1. CATEGORIES + BRANDS hit the PAGINATED list endpoints (`/categories`,
 *      `/brands`) with `limit=100`. Those endpoints page, so option 101 onward
 *      simply did not exist as far as the UI was concerned — a silent truncation
 *      that looks identical to "the store has 100 categories".
 *
 *   2. The same call passed `isActive: "true"` to `/categories`. Category has no
 *      `isActive` query param — it uses a `status` enum — so Zod stripped the
 *      key and the filter did nothing, quietly including ARCHIVED categories.
 *
 *   3. SUPPLIERS asked the list endpoint for `limit=200`, which exceeds the
 *      shared pagination cap of 100 (`common.validation.ts`). The whole request
 *      failed Zod validation with a 400, so the supplier dropdown rendered with
 *      nothing but its "All suppliers" placeholder.
 *
 * The fix points all three at the purpose-built `/…/options` endpoints, which
 * are unpaginated and already exclude archived/inactive rows.
 *
 * These tests pin the transport decisions that no other test would catch:
 *   • WHICH endpoint each lookup targets (`/options`, not the paginated list).
 *   • That NO pagination or `isActive` params are sent — passing `limit` here is
 *     exactly the bug, so re-adding one must fail loudly.
 *   • That the response envelope is unwrapped at the right depth. `/options`
 *     returns `data: [...]` while the list endpoints return `data: {data: [...]}`,
 *     so a URL fix without a matching unwrap fix yields an empty dropdown.
 *
 * apiClient is mocked at the module boundary: this is a transport test.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();

vi.mock("@/lib/api/axios", () => ({
  apiClient: { get: (...args: unknown[]) => get(...args) },
}));

const procurementApi = await import("@/features/procurement/api/procurementApi");
const { CATALOG_LOOKUP_PREFETCHES } = await import("@/lib/useCatalogLookupPrefetch");

/**
 * The paths the server actually mounts. Written as literals rather than
 * imported from the source so that changing the source makes these tests FAIL
 * rather than silently follow it.
 */
const CATEGORY_OPTIONS = "/categories/options";
const BRAND_OPTIONS = "/brands/options";
const SUPPLIER_OPTIONS = "/suppliers/options";

/** Params that reintroduce the original truncation/400 bugs if ever sent. */
const FORBIDDEN_PARAMS = ["limit", "page", "isActive"];

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * The shell prefetches these three lookups so dropdowns paint full on first
 * render. Its entries deliberately mirror the feature hooks' key + URL, so
 * asserting them here pins BOTH: a prefetch aimed at the wrong URL fetches
 * nothing useful, and one aimed at the wrong key writes a cache entry no hook
 * ever reads — a silent regression that restores the "options load late" bug.
 */
describe("catalog lookup prefetch", () => {
  const byPath = (path: string) =>
    CATALOG_LOOKUP_PREFETCHES.find((entry) => entry.path === path);

  it("prefetches all three lookups from the unpaginated options endpoints", () => {
    const paths = CATALOG_LOOKUP_PREFETCHES.map((entry) => entry.path);
    expect(paths).toEqual([CATEGORY_OPTIONS, BRAND_OPTIONS, SUPPLIER_OPTIONS]);
  });

  it("uses the exact query keys the feature hooks read", () => {
    // Must match useCategoryOptions / useBrandOptions (owner products hooks)
    // and procurementKeys.supplierOptions() respectively.
    expect(byPath(CATEGORY_OPTIONS)?.key).toEqual(["catalog-options", "categories"]);
    expect(byPath(BRAND_OPTIONS)?.key).toEqual(["catalog-options", "brands"]);
    expect(byPath(SUPPLIER_OPTIONS)?.key).toEqual(["procurement", "suppliers", "options"]);
  });

  it("projects each row to the shape its consuming hook caches", () => {
    // The dropdowns destructure these fields; caching raw rows instead would
    // render a list of blank labels.
    expect(
      byPath(CATEGORY_OPTIONS)?.select([{ id: "c1", name: "tshirts", extra: 1 }])
    ).toEqual([{ id: "c1", name: "tshirts" }]);

    expect(
      byPath(SUPPLIER_OPTIONS)?.select([{ id: "s1", businessName: "Acme", extra: 1 }])
    ).toEqual([{ id: "s1", businessName: "Acme" }]);
  });
});

describe("supplier lookup transport", () => {
  it("targets /suppliers/options, not the paginated list", async () => {
    get.mockResolvedValue({ data: [{ id: "s1", businessName: "Acme" }] });

    await procurementApi.fetchSupplierOptions();

    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe(SUPPLIER_OPTIONS);
  });

  it("sends no pagination or isActive params", async () => {
    get.mockResolvedValue({ data: [] });

    await procurementApi.fetchSupplierOptions();

    // The old call was get("/suppliers", {params:{limit:200,page:1,isActive:"true"}}),
    // and limit=200 exceeded the cap of 100 -> 400 -> empty dropdown.
    const config = get.mock.calls[0][1] as { params?: Record<string, unknown> } | undefined;
    const params = config?.params ?? {};
    for (const key of FORBIDDEN_PARAMS) {
      expect(params).not.toHaveProperty(key);
    }
  });

  it("unwraps the options envelope one level, not two", async () => {
    // /options returns data: [...] directly. Reading res.data.data here (the
    // shape the PAGINATED endpoint returns) would yield undefined -> [].
    get.mockResolvedValue({ data: [{ id: "s1", businessName: "Acme" }] });

    const rows = await procurementApi.fetchSupplierOptions();

    expect(rows).toEqual([{ id: "s1", businessName: "Acme" }]);
  });

  it("returns an empty list rather than throwing when data is absent", async () => {
    get.mockResolvedValue({});

    await expect(procurementApi.fetchSupplierOptions()).resolves.toEqual([]);
  });
});
