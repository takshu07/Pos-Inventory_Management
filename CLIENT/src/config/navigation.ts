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
  Printer,
  UserCog,
  CalendarCheck,
  TrendingUp,
  KeyRound,
  PackageSearch,
  ScrollText,
  ClipboardCheck,
  AlertTriangle,
  PackageX,
  Snowflake,
  Flame,
  TrendingDown,
  Wrench,
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
      // Read-only operational catalog — MANAGER only. Owners don't see these;
      // they use the full-CRUD "Product Management" / "Categories" screens
      // (Catalog Admin below) instead, so there is a single entry point per role.
      { label: "Product Catalog", path: "/products",   icon: Package, allowedRoles: ["MANAGER"] },
      { label: "Categories",      path: "/categories", icon: Tag,     allowedRoles: ["MANAGER"] },
    ],
  },
  {
    title: "Printing",
    items: [
      // Operational label printing: queue + history + batch print. No
      // allowedRoles → MANAGER and OWNER both see it. Printer/template
      // CONFIGURATION is a separate OWNER-only entry under System below.
      { label: "Label Printing", path: "/labels", icon: Printer },
    ],
  },
  {
    title: "Team",
    items: [
      // Read-only monitoring — managers observe here; hiring/edits and role
      // changes are owner-only writes on the owner workforce tree.
      // Activity is the module's landing screen (who is on, what they're doing),
      // so it stays first and keeps the /admin/employees path managers already know.
      { label: "Employee Activity", path: "/admin/employees",      icon: Activity },
      { label: "Managers",          path: "/admin/managers",       icon: UserCog },
      { label: "Employees",         path: "/admin/staff",          icon: Users },
      { label: "Attendance",        path: "/admin/attendance",     icon: CalendarCheck },
      { label: "Performance",       path: "/admin/performance",    icon: TrendingUp },
      { label: "Login History",     path: "/admin/login-history",  icon: KeyRound },
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
      // Full catalog CRUD (dashboard, pricing, inventory, bulk). OWNER only.
      { label: "Product Management", path: "/admin/products",   icon: Boxes, allowedRoles: ["OWNER"] },
      { label: "Categories",         path: "/admin/categories", icon: Tag,   allowedRoles: ["OWNER"] },
      { label: "Brands",             path: "/admin/brands",     icon: Award, allowedRoles: ["OWNER"] },
    ],
  },
  {
    title: "Procurement",
    items: [
      { label: "Suppliers",   path: "/admin/suppliers",   icon: Truck,         allowedRoles: ["OWNER"] },
      { label: "Purchases",   path: "/admin/purchases",   icon: ClipboardList, allowedRoles: ["OWNER"] },
    ],
  },
  {
    title: "Inventory",
    items: [
      // Ordered by how often each is opened: the dashboard answers "what needs
      // attention", then the daily surfaces, then the periodic analyses.
      { label: "Overview",     path: "/admin/inventory",             icon: Boxes,         allowedRoles: ["OWNER"] },
      { label: "Stock",        path: "/admin/inventory/stock",       icon: PackageSearch, allowedRoles: ["OWNER"] },
      { label: "Movements",    path: "/admin/inventory/movements",   icon: ScrollText,    allowedRoles: ["OWNER"] },
      { label: "Adjustments",  path: "/admin/inventory/adjustments", icon: ClipboardList, allowedRoles: ["OWNER"] },
      { label: "Cycle Counts", path: "/admin/inventory/cycle-counts",icon: ClipboardCheck,allowedRoles: ["OWNER"] },
    ],
  },
  {
    title: "Replenishment",
    items: [
      { label: "Low Stock",    path: "/admin/inventory/low-stock",    icon: AlertTriangle, allowedRoles: ["OWNER"] },
      { label: "Out of Stock", path: "/admin/inventory/out-of-stock", icon: PackageX,      allowedRoles: ["OWNER"] },
      { label: "Reorder",      path: "/admin/inventory/reorder",      icon: ShoppingCart,  allowedRoles: ["OWNER"] },
    ],
  },
  {
    title: "Stock Analysis",
    items: [
      { label: "Valuation",   path: "/admin/inventory/valuation",   icon: DollarSign, allowedRoles: ["OWNER"] },
      { label: "Dead Stock",  path: "/admin/inventory/dead-stock",  icon: Snowflake,  allowedRoles: ["OWNER"] },
      { label: "Fast Moving", path: "/admin/inventory/fast-moving", icon: Flame,      allowedRoles: ["OWNER"] },
      { label: "Slow Moving", path: "/admin/inventory/slow-moving", icon: TrendingDown, allowedRoles: ["OWNER"] },
      { label: "Damaged",     path: "/admin/inventory/damaged",     icon: Wrench,     allowedRoles: ["OWNER"] },
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
      { label: "Settings",       path: "/admin/settings",   icon: Settings, allowedRoles: ["OWNER"] },
      // Printers, label templates and print defaults. OWNER-only by design.
      { label: "Labels & Printers", path: "/admin/labels",  icon: Printer,  allowedRoles: ["OWNER"] },
      { label: "Audit Logs",     path: "/admin/audit-logs", icon: Shield,   allowedRoles: ["OWNER"] },
    ],
  },
];
