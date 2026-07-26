import { ShoppingCart, User } from "lucide-react";
import type { NavSection } from "./navigation";

/**
 * Cashier Portal Navigation
 * Single source of truth for the Cashier shell's sidebar.
 *
 * The Cashier portal is deliberately minimal: a cashier can only take payments
 * (POS Checkout) and manage their own account (My Profile). Nothing else is
 * reachable — no Dashboard, Sales History, Customers, Notifications, Reports,
 * or any admin surface. Because the entire /cashier subtree is already gated to
 * the CASHIER role by CashierRoute, these items carry no `allowedRoles` filter.
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
    title: "Account",
    items: [
      { label: "My Profile", path: "/cashier/profile", icon: User },
    ],
  },
];
