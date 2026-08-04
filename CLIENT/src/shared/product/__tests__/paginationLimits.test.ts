/**
 * Guard against over-cap `limit` params.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The server's shared `paginationSchema` caps `limit` at 100
 * (SERVER/src/validation/common.validation.ts). Asking for more does not
 * silently clamp — Zod REJECTS the whole request with a 400, so the feature
 * that made the call renders empty. That looks like "no data" rather than like
 * an error, which is why it shipped three separate times:
 *
 *   • /suppliers?limit=200      → supplier dropdown always empty
 *   • /owner/inventory/stock?limit=200 → cycle-count category picker always empty
 *   • /sales?limit=200          → dashboard "today" tile silently showed zeros
 *
 * This test greps the source for numeric `limit` literals above the cap so a
 * fourth instance fails here instead of in production. It is a lint rule
 * expressed as a test, deliberately blunt.
 *
 * ⚠ NOT every endpoint uses the shared schema — workforce defines its own with
 * `.max(200)`, so its roster calls are legal. Those files are allow-listed by
 * path below WITH the reason. Add to the allow-list only after confirming the
 * target endpoint's own validation schema actually permits the value.
 */

import { describe, expect, it } from "vitest";

/**
 * Source text is loaded through Vite's `?raw` glob rather than `node:fs`.
 *
 * The app tsconfig compiles `src` without Node types, so a filesystem read here
 * would mean widening the whole app's type configuration to accommodate one
 * test — see the same note in features/settings/__tests__/barcodeOwnership.test.ts.
 * `eager: true` resolves every match at import time, so the scan below is a
 * plain object walk.
 */
const SOURCES = import.meta.glob("../../../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The shared server-side ceiling. */
const SHARED_MAX_LIMIT = 100;

/**
 * Files permitted to exceed SHARED_MAX_LIMIT, each with the schema that allows
 * it. A path here is a claim that the endpoint's OWN validation permits more.
 */
const ALLOWED: { pattern: string; reason: string }[] = [
  {
    pattern: "features/workforce/",
    reason: "workforce.validation.ts defines its own pagination with .max(200)",
  },
];

/**
 * Matches `limit: 250`, `limit=250`, `limit: "250"`, and limit-carrying
 * constants like `MAX_PAGE_LIMIT = 250` / `PAGE_SIZE = 250`.
 *
 * The identifier match is case-insensitive and allows an underscored prefix or
 * suffix, because the value that reaches the query string is often a named
 * constant rather than an inline literal — the first draft of this guard missed
 * exactly that.
 */
const LIMIT_LITERAL = /\b[A-Za-z_]*(?:limit|page_?size)['"]?\s*[:=]\s*['"]?(\d+)/gi;

/**
 * Strips comments before scanning.
 *
 * Without this the guard flags the very comments that DOCUMENT the old bug
 * ("the previous version asked for limit=200"), which would force future
 * authors to delete the explanation to get a green suite — exactly backwards.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("pagination limits stay within the server cap", () => {
  it("no source file requests a limit above the shared cap", () => {
    const entries = Object.entries(SOURCES).filter(
      ([file]) => !file.includes("__tests__") && !/\.test\.tsx?$/.test(file)
    );
    expect(entries.length).toBeGreaterThan(0); // guard against a bad glob

    const violations: string[] = [];

    for (const [file, source] of entries) {
      const rel = file.replace(/^(\.\.\/)+/, "").replace(/\\/g, "/");
      if (ALLOWED.some((a) => rel.includes(a.pattern))) continue;

      for (const match of stripComments(source).matchAll(LIMIT_LITERAL)) {
        const value = Number(match[1]);
        if (value > SHARED_MAX_LIMIT) {
          violations.push(`${rel}: limit=${value}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps the allow-list honest about why each entry is exempt", () => {
    for (const entry of ALLOWED) {
      expect(entry.reason).toMatch(/max\(\d+\)/);
    }
  });
});
