import { History, ShoppingCart, User, Wallet } from "lucide-react";
import type { NavSection } from "./navigation";

/**
 * Cashier Portal Navigation
 * Single source of truth for the Cashier shell's sidebar.
 *
 * The Cashier portal is deliberately minimal: take payments (POS Checkout),
 * run their own drawer (Cash Register), and manage their own account. Nothing
 * else is reachable — no Dashboard, Customers, Reports, or any admin surface.
 * Because the entire /cashier subtree is already gated to the CASHIER role by
 * CashierRoute, these items carry no `allowedRoles` filter.
 *
 * THE REGISTER IS NOT OPTIONAL HERE. A cashier cannot record a sale without an
 * open drawer, so omitting it would leave them with a POS screen that refuses
 * every checkout and no way to find out why. Register History is theirs alone —
 * the backend scopes it to the signed-in cashier's own sessions.
 *
 * Paths live under /cashier/* so they never collide with the manager shell and
 * so a cashier's URLs are self-evidently scoped to their portal.
 */
export const CASHIER_NAV: NavSection[] = [
  {
    title: "Point of Sale",
    items: [
      { label: "POS Checkout", path: "/cashier/pos", icon: ShoppingCart },
    ],
  },
  {
    title: "Cash Register",
    items: [
      { label: "My Register", path: "/cashier/register", icon: Wallet },
      { label: "My Shifts", path: "/cashier/register/history", icon: History },
    ],
  },
  {
    title: "Account",
    items: [
      { label: "My Profile", path: "/cashier/profile", icon: User },
    ],
  },
];

/**
 * Whether a cashier nav row must match its URL exactly (NavLink's `end` prop).
 *
 * Same rule as the manager shell's `isExactNavPath`: NavLink's default segment
 * prefix match is right for detail screens (a shift summary under My Shifts has
 * no nav row of its own), but wrong where a second nav row sits underneath a
 * first. "/cashier/register" prefixes "/cashier/register/history", so without
 * this both rows light up on the shifts screen.
 */
const CASHIER_NAV_PATHS: string[] = CASHIER_NAV.flatMap((section) =>
  section.items.map((item) => item.path)
);

export function isExactCashierNavPath(path: string): boolean {
  return CASHIER_NAV_PATHS.some((other) => other.startsWith(`${path}/`));
}
