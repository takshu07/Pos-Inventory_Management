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
