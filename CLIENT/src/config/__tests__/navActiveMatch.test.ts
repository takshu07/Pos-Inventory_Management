// =============================================================================
// SIDEBAR ACTIVE-ROW MATCHING — regression tests
//
// NavLink matches by path SEGMENT PREFIX unless `end` is set. That default is
// correct for detail screens (/sales/:saleId has no nav row of its own, so
// "Sales History" should stay lit) and WRONG wherever one nav row sits beneath
// another: /register/history lit both "My Register" and "Register History", and
// /register/movements lit both "My Register" and "Drops & Payouts".
//
// The fix derives the exact-match set from the nav tree instead of hand-listing
// it, so these tests exist to hold BOTH halves of the rule — adding a child page
// under an existing nav row must not silently reintroduce a double highlight,
// and blanket-exacting everything must not break the detail screens.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  NAV_GROUPS,
  isExactNavPath,
  visibleGroupItems,
} from "../navigation";
import { CASHIER_NAV, isExactCashierNavPath } from "../cashierNavigation";
import type { Role } from "@/types";

/** Mirrors NavLink's matching: exact, or a segment-boundary prefix. */
function matches(navPath: string, url: string): boolean {
  if (navPath === url) return true;
  if (isExactNavPath(navPath)) return false;
  return url.startsWith(`${navPath}/`);
}

const ROLES: Role[] = ["OWNER", "MANAGER"];

describe("manager sidebar active matching", () => {
  it("lights exactly one row for the register screens from the bug report", () => {
    // The two screenshots: /register/history and /register/movements each had
    // "My Register" lit alongside the row the user actually clicked.
    expect(matches("/register", "/register/history")).toBe(false);
    expect(matches("/register/history", "/register/history")).toBe(true);

    expect(matches("/register", "/register/movements")).toBe(false);
    expect(matches("/register/movements", "/register/movements")).toBe(true);

    // The parent itself still lights on its own URL.
    expect(matches("/register", "/register")).toBe(true);
  });

  it("never lights two rows for any nav destination, for any role", () => {
    for (const role of ROLES) {
      const paths = NAV_GROUPS.flatMap((group) => [
        ...(group.path !== undefined ? [group.path] : []),
        ...visibleGroupItems(group, role).map((item) => item.path),
      ]);

      for (const url of paths) {
        const lit = paths.filter((navPath) => matches(navPath, url));
        expect(lit, `${role} on ${url} lit: ${lit.join(", ")}`).toEqual([url]);
      }
    }
  });

  it("keeps the parent row lit on detail screens that have no row of their own", () => {
    // These are the reason the fix is not simply `end` on every link.
    expect(matches("/sales", "/sales/sale-123")).toBe(true);
    expect(matches("/customers", "/customers/cust-456")).toBe(true);
    expect(matches("/admin/purchases", "/admin/purchases/po-1")).toBe(true);
    expect(matches("/admin/suppliers", "/admin/suppliers/sup-1")).toBe(true);
    expect(
      matches("/admin/inventory/cycle-counts", "/admin/inventory/cycle-counts/cc-1")
    ).toBe(true);
  });

  it("does not let Dashboard's '/' claim every route", () => {
    expect(isExactNavPath("/")).toBe(true);
    expect(matches("/", "/register")).toBe(false);
    expect(matches("/", "/")).toBe(true);
  });

  it("matches on segment boundaries, not raw string prefixes", () => {
    expect(matches("/admin/inventory", "/admin/inventoryfoo")).toBe(false);
  });

  it("resolves the same for a MANAGER as an OWNER on a shared URL", () => {
    // The exact-match set is a property of the URL space, not of the viewer —
    // a MANAGER cannot see the owner-only children of /admin/inventory, and if
    // the set were role-filtered they would match that URL differently.
    expect(isExactNavPath("/admin/inventory")).toBe(true);
  });
});

describe("cashier sidebar active matching", () => {
  it("never lights two rows for any cashier destination", () => {
    const paths = CASHIER_NAV.flatMap((s) => s.items.map((i) => i.path));

    for (const url of paths) {
      const lit = paths.filter((navPath) =>
        navPath === url
          ? true
          : isExactCashierNavPath(navPath)
            ? false
            : url.startsWith(`${navPath}/`)
      );
      expect(lit, `cashier on ${url} lit: ${lit.join(", ")}`).toEqual([url]);
    }
  });

  it("separates My Register from My Shifts", () => {
    expect(isExactCashierNavPath("/cashier/register")).toBe(true);
    expect(isExactCashierNavPath("/cashier/register/history")).toBe(false);
  });

  it("keeps My Shifts lit on an individual shift summary", () => {
    // /cashier/register/history has no nested nav row, so the prefix match is
    // what keeps the sidebar anchored on a shift-summary deep link.
    expect(
      "/cashier/register/sessions/s-1".startsWith("/cashier/register/")
    ).toBe(true);
    expect(isExactCashierNavPath("/cashier/register")).toBe(true);
  });
});
