/**
 * @file lib/api/pagination.ts
 *
 * The pagination contract, mirrored from the server.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * Every list endpoint validates `limit` with a zod schema that caps it. When a
 * caller asks for more than the cap the server does not clamp — it rejects the
 * whole request with `400 Validation failed`, so the page renders no data at
 * all. Four call sites had hard-coded `limit: 200` against endpoints capped at
 * 100 and were failing 100% of the time:
 *
 *   - CycleCountsPage      → /inventory/stock   (cap 100)
 *   - StockOverviewPage    → /inventory/stock   (cap 100, via a URL param)
 *   - dashboardApi         → /sales             (cap 100)
 *   - procurementApi       → /suppliers         (cap 100)
 *
 * The number 200 was not arbitrary — `/workforce/roster` really is capped at
 * 200, so the value was correct there and got copied to endpoints where it was
 * not. That is precisely the failure mode a named constant prevents: the cap
 * belongs to the ENDPOINT, not to the caller's intuition about "a big page".
 *
 * ── The other half of the bug: limits that come from the URL ────────────────
 * Ten URL-backed filter hooks read `limit` out of the query string with no
 * upper bound. A bookmarked, shared or hand-edited `?limit=200` reaches the API
 * unchecked and 400s exactly like a hard-coded one — but survives redeploys,
 * because it lives in the user's bookmarks rather than in the source. That is
 * the reported Stock page failure. Every such hook now clamps.
 *
 * ── Keeping it true ──────────────────────────────────────────────────────────
 * These values mirror SERVER/src/validation/*.validation.ts. They are asserted
 * against the server schemas by a test in SERVER/src/validation/__tests__/
 * paginationContract.test.ts, so raising a cap on one side and not the other
 * fails CI rather than turning into a runtime 400 on a page nobody opened yet.
 */

/**
 * The cap used by `paginationSchema` in common.validation.ts, which nearly
 * every list endpoint extends. Anything above this is a guaranteed 400.
 */
export const DEFAULT_MAX_LIMIT = 100;

/**
 * Endpoints whose cap differs from {@link DEFAULT_MAX_LIMIT}.
 * Keyed by the path suffix so it reads like the URL at the call site.
 */
export const MAX_LIMIT = {
  /** workforce.validation.ts — rosters are fetched whole to fill a picker. */
  roster: 200,
} as const;

/**
 * Clamps a page size to what the endpoint will actually accept.
 *
 * Used on any `limit` that is not a literal the author controls — a URL query
 * param, a saved view, a user-entered page size. A bookmarked `?inv_limit=200`
 * is otherwise indistinguishable from a broken page: the request 400s, the
 * table stays empty, and nothing on screen explains why.
 *
 * Clamping rather than rejecting is deliberate. The user asked for "as much as
 * possible"; giving them the maximum the API allows is what they meant, and it
 * degrades to a working page instead of an error state.
 */
export function clampLimit(limit: number, max: number = DEFAULT_MAX_LIMIT): number {
  // NaN is the `parseInt("abc")` case — no intent to read, so fall back to the
  // smallest valid page rather than guessing at a large one.
  if (Number.isNaN(limit)) return 1;
  // Infinity is the opposite: it expresses "as many as possible", so it maps to
  // the cap. Treating it as 1 would be a surprising silent truncation.
  if (limit === Number.POSITIVE_INFINITY) return max;
  if (limit < 1) return 1;
  return Math.min(Math.floor(limit), max);
}
