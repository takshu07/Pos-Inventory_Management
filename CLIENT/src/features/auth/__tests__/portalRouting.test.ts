/**
 * Portal routing — regression tests.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The app ships two authenticated shells, and a user belongs to exactly one:
 *
 *   • Manager Portal (`/`)        → MANAGER + OWNER
 *   • Cashier Portal (`/cashier`) → CASHIER only
 *
 * `ManagerRoute` bounces a CASHIER out of the entire `/` subtree. So any link
 * rendered in a SHARED component — the Navbar renders in both shells — must
 * resolve per-role, or it sends half its users to a guard that redirects them.
 *
 * That failure is silent in the worst way: the control looks right, the data
 * behind it is right, and clicking it dumps the user somewhere else with no
 * error. This is exactly what nearly shipped with the notification bell, which
 * showed a cashier an accurate unread count on a button that would have bounced
 * them to `/cashier/pos`.
 *
 * These helpers are the single source of truth for that decision — login
 * redirect, guest redirect and both route guards all read from here — so the
 * rules cannot drift apart. Pinning them is pinning that guarantee.
 */

import { describe, expect, it } from "vitest";

import {
  canAccessCashierPortal,
  canAccessManagerPortal,
  notificationsPathForRole,
  portalHomeForRole,
} from "../utils/permissions";

const ROLES = ["OWNER", "MANAGER", "CASHIER"] as const;

describe("portal membership is exclusive", () => {
  it.each(ROLES)("%s belongs to exactly one portal", (role) => {
    const inManager = canAccessManagerPortal(role);
    const inCashier = canAccessCashierPortal(role);

    // Not both, and not neither. A role in both portals makes "which shell am
    // I in" ambiguous; a role in neither has nowhere to land after login.
    expect(inManager !== inCashier).toBe(true);
  });

  it("a MANAGER is never treated as a cashier", () => {
    // canAccessCashierPortal is `role === "CASHIER"`, not a hierarchy check —
    // a manager outranks a cashier but does not belong in their shell.
    expect(canAccessCashierPortal("MANAGER")).toBe(false);
    expect(canAccessCashierPortal("OWNER")).toBe(false);
  });
});

describe("portalHomeForRole", () => {
  it("sends managers and owners to the management shell", () => {
    expect(portalHomeForRole("OWNER")).toBe("/");
    expect(portalHomeForRole("MANAGER")).toBe("/");
  });

  it("sends cashiers to POS, not to the manager root", () => {
    expect(portalHomeForRole("CASHIER")).toBe("/cashier/pos");
  });

  it("sends an absent role to login rather than into a shell", () => {
    expect(portalHomeForRole(null)).toBe("/login");
  });
});

describe("notificationsPathForRole", () => {
  it("resolves to each role's OWN portal", () => {
    expect(notificationsPathForRole("OWNER")).toBe("/notifications");
    expect(notificationsPathForRole("MANAGER")).toBe("/notifications");
    expect(notificationsPathForRole("CASHIER")).toBe("/cashier/notifications");
  });

  it("never sends a CASHIER to a route inside ManagerRoute", () => {
    // The exact bug this helper exists to prevent: the bare path is gated by
    // ManagerRoute, which redirects a cashier to /cashier/pos. The bell would
    // have shown them a correct unread count and then refused to open.
    const path = notificationsPathForRole("CASHIER");

    expect(path).not.toBe("/notifications");
    expect(path.startsWith("/cashier/")).toBe(true);
  });

  it("keeps every role inside the portal portalHomeForRole assigns them", () => {
    // The two helpers must agree. If one is updated and the other is not, a
    // shared component links a user out of their own shell.
    for (const role of ROLES) {
      const home = portalHomeForRole(role);
      const notifications = notificationsPathForRole(role);

      const inCashierShell = (p: string) => p.startsWith("/cashier");
      expect(inCashierShell(notifications)).toBe(inCashierShell(home));
    }
  });

  it("sends an absent role to login rather than a notifications screen", () => {
    expect(notificationsPathForRole(null)).toBe("/login");
  });

  it("returns an absolute in-app path for every role", () => {
    for (const role of [...ROLES, null]) {
      const path = notificationsPathForRole(role);

      expect(path.startsWith("/")).toBe(true);
      expect(path).not.toMatch(/^https?:/);
    }
  });
});
