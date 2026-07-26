import type { Role } from "@/types";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  History,
  Wallet,
  Bell,
  User,
  Boxes,
  Tag,
  Award,
  Truck,
  ClipboardList,
  BarChart3,
  DollarSign,
  BadgePercent,
  Settings,
  Shield,
  Activity,
} from "lucide-react";

/**
 * Navigation Configuration
 * Single source of truth for all sidebar routes, icons, labels, and RBAC.
 *
 * Authorization model (2026-07): MANAGER is an OPERATIONAL role, OWNER is the
 * administrator.
 *   • MANAGER_NAV  → shop-floor operations, visible to MANAGER + OWNER. Product
 *     and Employee entries here are read-only monitoring surfaces.
 *   • OWNER_NAV    → business administration, OWNER only (allowedRoles:["OWNER"]).
 *
 * Both are rendered only inside the manager shell (MainLayout), which is already
 * gated to MANAGER+OWNER by ManagerRoute — cashiers have their own portal/nav.
 * Adding a page = adding one entry here; the sidebar filters by `allowedRoles`
 * and the router enforces the same rule with route guards (nav hiding alone is
 * never the security boundary).
 */

export interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  /** Roles that can see this item. Empty = all roles that can reach this shell. */
  allowedRoles?: Role[];
  badge?: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/**
 * Operational navigation — MANAGER + OWNER.
 * The Manager's complete surface: run the floor, oversee catalog and staff
 * read-only. No `allowedRoles` filter → visible to everyone in this shell.
 */
export const EMPLOYEE_NAV: NavSection[] = [
  {
    title: "Operations",
    items: [
      { label: "Dashboard",       path: "/",               icon: LayoutDashboard },
      { label: "POS Checkout",    path: "/pos",            icon: ShoppingCart },
      { label: "Sales History",   path: "/sales",          icon: History },
      { label: "Customers",       path: "/customers",      icon: Users },
    ],
  },
  {
    title: "Catalog",
    items: [
      // Read-only for managers; owners get full CRUD on the same screens.
      { label: "Products",       path: "/admin/products",  icon: Boxes },
      { label: "Product Lookup", path: "/products/lookup", icon: Package },
    ],
  },
  {
    title: "Team",
    items: [
      // Read-only monitoring — renamed from "Employees" since managers only
      // observe activity here; hiring/edits are owner-only under Business below.
      { label: "Employee Activity", path: "/admin/employees", icon: Activity },
    ],
  },
  {
    title: "Account",
    items: [
      { label: "My Profile",      path: "/profile",        icon: User },
      { label: "Notifications",   path: "/notifications",  icon: Bell },
    ],
  },
];

/**
 * Business administration navigation — OWNER only.
 * Every item is explicitly `allowedRoles:["OWNER"]` so a manager never sees it
 * and (paired with OwnerRoute) can never route to it.
 */
export const ADMIN_NAV: NavSection[] = [
  {
    title: "Catalog Admin",
    items: [
      { label: "Categories",     path: "/admin/categories", icon: Tag,     allowedRoles: ["OWNER"] },
      { label: "Brands",         path: "/admin/brands",     icon: Award,   allowedRoles: ["OWNER"] },
    ],
  },
  {
    title: "Procurement",
    items: [
      { label: "Suppliers",   path: "/admin/suppliers",   icon: Truck,         allowedRoles: ["OWNER"] },
      { label: "Purchases",   path: "/admin/purchases",   icon: ClipboardList, allowedRoles: ["OWNER"] },
      { label: "Inventory",   path: "/admin/inventory",   icon: Boxes,         allowedRoles: ["OWNER"] },
    ],
  },
  {
    title: "Business",
    items: [
      { label: "Reports",       path: "/admin/reports",    icon: BarChart3,    allowedRoles: ["OWNER"] },
      { label: "Finance",       path: "/admin/finance",    icon: DollarSign,   allowedRoles: ["OWNER"] },
      { label: "Discounts",     path: "/admin/discounts",  icon: BadgePercent, allowedRoles: ["OWNER"] },
      { label: "Cash Register", path: "/finance/register", icon: Wallet,       allowedRoles: ["OWNER"] },
    ],
  },
  {
    title: "System",
    items: [
      { label: "Settings",    path: "/admin/settings",    icon: Settings,      allowedRoles: ["OWNER"] },
      { label: "Audit Logs",  path: "/admin/audit-logs",  icon: Shield,        allowedRoles: ["OWNER"] },
    ],
  },
];
