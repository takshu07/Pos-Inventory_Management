// =============================================================================
// PAGINATION CLAMP — regression tests
//
// `limit` reaches the API from places the author does not control: a URL query
// param, a bookmark, a hand-edited address bar. The server REJECTS an over-cap
// limit (400) rather than clamping it, so an unclamped value renders an empty
// table with nothing on screen to explain why.
//
// See SERVER/src/validation/__tests__/paginationContract.test.ts for the
// assertion that these caps still match the server's zod schemas.
// =============================================================================

import { describe, expect, it } from "vitest";

import { clampLimit, DEFAULT_MAX_LIMIT, MAX_LIMIT } from "../pagination";

describe("clampLimit", () => {
  it("passes through a limit within the cap", () => {
    expect(clampLimit(25)).toBe(25);
    expect(clampLimit(DEFAULT_MAX_LIMIT)).toBe(DEFAULT_MAX_LIMIT);
  });

  it("clamps the value that was causing the 400", () => {
    // ?inv_limit=200 in a bookmarked URL — the exact reported failure.
    expect(clampLimit(200)).toBe(DEFAULT_MAX_LIMIT);
  });

  it("honours a higher per-endpoint cap where one exists", () => {
    // The roster genuinely allows 200; clamping it to 100 would silently
    // truncate the staff pickers that depend on the whole list.
    expect(clampLimit(200, MAX_LIMIT.roster)).toBe(200);
  });

  it("floors a fractional limit rather than sending a non-integer", () => {
    // The server validates `.int()`, so 25.7 would 400 just like 200 did.
    expect(clampLimit(25.7)).toBe(25);
  });

  it("returns a usable page size for junk input instead of NaN", () => {
    // `parseInt("abc")` is NaN; sending it produces a 400 rather than a page.
    expect(clampLimit(Number.NaN)).toBe(1);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
  });

  it("reads Infinity as 'as many as allowed', not as junk", () => {
    // Distinct from NaN on purpose: Infinity expresses intent to read
    // everything, so silently collapsing it to a single row would be a
    // surprising truncation rather than a safe default.
    expect(clampLimit(Number.POSITIVE_INFINITY)).toBe(DEFAULT_MAX_LIMIT);
  });
});
