// =============================================================================
// NAVIGATION — active-group resolution
//
// `findGroupForPath` decides two visible things: which sidebar group is marked
// as holding the current route, and which group auto-expands on navigation. Get
// it wrong and the sidebar either highlights nothing or highlights the wrong
// section — the reported "active state is inconsistent, some pages lose their
// highlight after navigating".
//
// The cases below are the ones that actually broke, kept as tests because none
// of them are visible from reading the function: they all depend on how the
// paths in NAV_GROUPS relate to the routes in app/router.
// =============================================================================

import { describe, expect, it } from "vitest";

import { findGroupForPath } from "../navigation";

describe("findGroupForPath", () => {
  describe("leaf routes", () => {
    it("matches an exact item path", () => {
      expect(findGroupForPath("/admin/inventory/stock", "OWNER")).toBe("inventory");
    });

    it("prefers the LONGEST matching path, not the first", () => {
      // "/admin/inventory" and "/admin/inventory/stock" are both prefixes of
      // the latter. Matching the shorter one would highlight the Inventory
      // dashboard while the user is on Stock.
      expect(findGroupForPath("/admin/inventory/stock", "OWNER")).toBe("inventory");
      expect(findGroupForPath("/admin/inventory", "OWNER")).toBe("inventory");
    });

    it("does not treat a sibling with a shared prefix as nested", () => {
      // "/admin/inventory-foo" must NOT match "/admin/inventory": the boundary
      // is a "/" and nothing else. This is why the check is `startsWith(p + "/")`
      // rather than `startsWith(p)`.
      expect(findGroupForPath("/admin/inventoryfoo", "OWNER")).not.toBe("inventory");
    });
  });

  describe("detail routes keep their parent highlighted", () => {
    // A detail screen has no nav entry of its own, so it resolves through the
    // nested-path rule. Without it the sidebar goes blank the moment you open a
    // record — which is exactly "loses its active state after navigation".
    it("cycle count session → Inventory", () => {
      expect(findGroupForPath("/admin/inventory/cycle-counts/abc123", "OWNER")).toBe(
        "inventory"
      );
    });

    it("supplier profile → Procurement", () => {
      expect(findGroupForPath("/admin/suppliers/abc123", "OWNER")).toBe("procurement");
    });

    it("purchase detail → Procurement", () => {
      expect(findGroupForPath("/admin/purchases/abc123", "OWNER")).toBe("procurement");
    });

    it("customer profile → Operations", () => {
      expect(findGroupForPath("/customers/abc123", "OWNER")).toBe("operations");
    });

    it("sale detail → Operations", () => {
      expect(findGroupForPath("/sales/abc123", "OWNER")).toBe("operations");
    });
  });

  describe("groups that are themselves a destination", () => {
    // The Dashboard group has `path` and no `items`. It renders as a plain link
    // (NavGroupList's `group.path && items.length === 0` branch), so it must
    // still resolve as the active group — otherwise the one screen everybody
    // lands on first is the one screen with no sidebar highlight.
    it("resolves the dashboard group at /", () => {
      expect(findGroupForPath("/", "OWNER")).toBe("dashboard");
    });

    it("does not let the dashboard's '/' claim every other route", () => {
      // The hazard in the fix above: "/" is a prefix of every path in the app,
      // so admitting group paths under the NESTED rule would highlight
      // Dashboard everywhere. Group paths match exactly, and only exactly.
      expect(findGroupForPath("/admin/inventory/stock", "OWNER")).toBe("inventory");
      expect(findGroupForPath("/pos", "OWNER")).toBe("operations");
      expect(findGroupForPath("/admin/finance/revenue", "OWNER")).toBe("finance");
    });
  });

  describe("role scoping", () => {
    it("does not resolve an OWNER-only path for a CASHIER", () => {
      // The group must not light up for a route the role cannot reach; that
      // would advertise a screen that 403s on click.
      expect(findGroupForPath("/admin/inventory/stock", "CASHIER")).toBeNull();
    });
  });

  describe("unknown routes", () => {
    it("returns null rather than guessing", () => {
      // A 404 or a route with no nav entry leaves every group unhighlighted,
      // which is honest. Guessing the nearest group would mark a section the
      // user is not in.
      expect(findGroupForPath("/nowhere/at/all", "OWNER")).toBeNull();
    });
  });
});
