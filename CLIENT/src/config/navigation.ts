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
  Banknote,
  Scale,
  ArrowLeftRight,
  Receipt,
  CreditCard,
  Store,
  LineChart,
  Megaphone,
  Wrench as Utilities,
  UsersRound,
  DatabaseBackup,
  ScanBarcode,
  UserCog,
} from "lucide-react";

/**
 * Navigation Configuration
 * Single source of truth for all sidebar routes, icons, labels, and RBAC.
 *
 * Authorization model (2026-07): MANAGER is an OPERATIONAL role, OWNER is the
 * administrator. That rule is unchanged by this file's structure — every entry
 * still carries the same `allowedRoles` it had before, and the router enforces
 * the same guards independently. Nav hiding is never the security boundary.
 *
 * SHAPE (2026-08): the sidebar is a two-level tree — top-level GROUPS that
 * expand to reveal their items. Previously this was ten flat sections rendering
 * ~50 always-visible links, which is the clutter this structure removes: a
 * group shows one row until you open it.
 *
 * A group with exactly one destination and no children (Dashboard) renders as a
 * plain link, so we don't make people expand a section to reach a single page.
 *
 * Adding a page = adding one entry here. The sidebar filters by `allowedRoles`
 * and hides any group whose items are all filtered out.
 */

export interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  /** Roles that can see this item. Empty = all roles that can reach this shell. */
  allowedRoles?: Role[];
  badge?: string;
  /**
   * Marks a destination that exists in the router but has no implementation yet
   * (renders a PlaceholderPage). Used only to style the row as forthcoming — it
   * is NOT an access control and does not disable the link.
   */
  comingSoon?: boolean;
}

export interface NavGroup {
  /** Stable key for persisting this group's expanded/collapsed state. */
  id: string;
  label: string;
  icon: React.ElementType;
  /** Set when the group itself is a destination (a single-link group). */
  path?: string;
  /** Roles allowed to see the whole group, on top of per-item filtering. */
  allowedRoles?: Role[];
  items?: NavItem[];
}

/**
 * Legacy flat-section shape.
 *
 * Retained as a TYPE ONLY because the cashier portal's navigation config still
 * uses it. The manager/owner sidebar no longer consumes these.
 */
export interface NavSection {
  title: string;
  items: NavItem[];
}

const OWNER: Role[] = ["OWNER"];

/**
 * The manager/owner sidebar, in display order.
 *
 * Ordering rule: what you touch hourly is nearest the top (Operations),
 * what you touch monthly or once (Settings) is nearest the bottom.
 */
export const NAV_GROUPS: NavGroup[] = [
  // ── Dashboard ─────────────────────────────────────────────────────────────
  // A destination, not a group. The dashboard surfaces the cross-module alerts
  // (low stock, payables, drawer state, attendance, revenue, profit) that this
  // navigation deliberately buries one level deeper.
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    path: "/",
  },

  // ── Operations ────────────────────────────────────────────────────────────
  // The shop floor. No allowedRoles anywhere: everything here is work a MANAGER
  // does, and the register is deliberately operational — anyone who rings up a
  // sale needs an open drawer, and the backend narrows per session, not route.
  {
    id: "operations",
    label: "Operations",
    icon: ShoppingCart,
    items: [
      { label: "POS Checkout",     path: "/pos",                icon: ShoppingCart },
      { label: "Sales History",    path: "/sales",              icon: History },
      { label: "Customers",        path: "/customers",          icon: Users },
      { label: "My Register",      path: "/register",           icon: Wallet },
      { label: "Register History", path: "/register/history",   icon: History },
      { label: "Drops & Payouts",  path: "/register/movements", icon: Banknote },
      // Read-only operational catalog — MANAGER only. Owners reach the
      // full-CRUD equivalents under Inventory, so each role keeps exactly one
      // entry point per concept rather than two that look alike.
      { label: "Product Catalog",  path: "/products",           icon: Package, allowedRoles: ["MANAGER"] },
      { label: "Categories",       path: "/categories",         icon: Tag,     allowedRoles: ["MANAGER"] },
    ],
  },

  // ── Inventory ─────────────────────────────────────────────────────────────
  // Catalog administration and stock control, merged into one group: they are
  // the same mental model ("what do we have"), and splitting them across
  // "Catalog Admin" and "Inventory" made people guess which held Brands.
  {
    id: "inventory",
    label: "Inventory",
    icon: Boxes,
    allowedRoles: OWNER,
    items: [
      { label: "Dashboard",          path: "/admin/inventory",              icon: LayoutDashboard, allowedRoles: OWNER },
      { label: "Product Management", path: "/admin/products",               icon: Boxes,           allowedRoles: OWNER },
      { label: "Categories",         path: "/admin/categories",             icon: Tag,             allowedRoles: OWNER },
      { label: "Brands",             path: "/admin/brands",                 icon: Award,           allowedRoles: OWNER },
      { label: "Stock",              path: "/admin/inventory/stock",        icon: PackageSearch,   allowedRoles: OWNER },
      { label: "Movements",          path: "/admin/inventory/movements",    icon: ScrollText,      allowedRoles: OWNER },
      { label: "Adjustments",        path: "/admin/inventory/adjustments",  icon: ClipboardList,   allowedRoles: OWNER },
      { label: "Cycle Counts",       path: "/admin/inventory/cycle-counts", icon: ClipboardCheck,  allowedRoles: OWNER },
    ],
  },

  // ── Procurement ───────────────────────────────────────────────────────────
  {
    id: "procurement",
    label: "Procurement",
    icon: Truck,
    allowedRoles: OWNER,
    items: [
      { label: "Suppliers", path: "/admin/suppliers", icon: Truck,         allowedRoles: OWNER },
      { label: "Purchases", path: "/admin/purchases", icon: ClipboardList, allowedRoles: OWNER },
    ],
  },

  // ── Employees ─────────────────────────────────────────────────────────────
  // "Managers" is no longer its own destination: it was the roster screen
  // pre-filtered to one role, so per the spec it becomes a role filter on
  // Employees (`?role=MANAGER`). The /admin/managers ROUTE still exists and
  // still works — only the duplicate nav entry is gone.
  //
  // The spec also lists "Overview" and "Employee Activity" separately, but both
  // resolve to /admin/employees (WorkforceActivityPage) — there is no distinct
  // overview screen. Two rows pointing at one page is exactly the clutter this
  // refactor removes, so it appears once under its accurate name.
  {
    id: "employees",
    label: "Employees",
    icon: UsersRound,
    items: [
      { label: "Employee Activity", path: "/admin/employees",     icon: Activity },
      { label: "Employees",         path: "/admin/staff",         icon: Users },
      { label: "Attendance",        path: "/admin/attendance",    icon: CalendarCheck },
      { label: "Performance",       path: "/admin/performance",   icon: TrendingUp },
      { label: "Login History",     path: "/admin/login-history", icon: KeyRound },
    ],
  },

  // ── Finance ───────────────────────────────────────────────────────────────
  {
    id: "finance",
    label: "Finance",
    icon: DollarSign,
    allowedRoles: OWNER,
    items: [
      { label: "Dashboard",     path: "/admin/finance",             icon: LayoutDashboard, allowedRoles: OWNER },
      { label: "Revenue",       path: "/admin/finance/revenue",     icon: TrendingUp,      allowedRoles: OWNER },
      { label: "Profit & Loss", path: "/admin/finance/profit-loss", icon: Scale,           allowedRoles: OWNER },
      { label: "Cash Flow",     path: "/admin/finance/cash-flow",   icon: ArrowLeftRight,  allowedRoles: OWNER },
      { label: "Expenses",      path: "/admin/finance/expenses",    icon: Receipt,         allowedRoles: OWNER },
      { label: "Payments",      path: "/admin/finance/payments",    icon: CreditCard,      allowedRoles: OWNER },
      { label: "Salaries",      path: "/admin/finance/salaries",    icon: Users,           allowedRoles: OWNER },
      // Supplier Payments is the payables ledger. It is NOT in the spec's
      // Finance list, but dropping the only link to a built, reachable screen
      // would remove functionality, which this refactor must not do.
      { label: "Supplier Payments", path: "/admin/finance/payables", icon: Truck,          allowedRoles: OWNER },
    ],
  },

  // ── Reports ───────────────────────────────────────────────────────────────
  // Twelve report routes collapse to five destinations. The other seven are now
  // TABS inside these pages (see features/reports/pages/TabbedReportPages) and
  // their original URLs redirect to the owning tab, so bookmarks still resolve.
  {
    id: "reports",
    label: "Reports",
    icon: BarChart3,
    allowedRoles: OWNER,
    items: [
      // The BI landing page: KPIs plus a one-click card to every report. Not in
      // the spec's list, but it is a real screen and dropping its only nav entry
      // would remove functionality.
      { label: "Overview",  path: "/admin/reports",           icon: BarChart3,     allowedRoles: OWNER },
      { label: "Sales",     path: "/admin/reports/sales",     icon: ShoppingCart,  allowedRoles: OWNER },
      { label: "Inventory", path: "/admin/reports/inventory", icon: PackageSearch, allowedRoles: OWNER },
      { label: "Customers", path: "/admin/reports/customers", icon: Users,         allowedRoles: OWNER },
      { label: "Employees", path: "/admin/reports/employees", icon: UserCog,       allowedRoles: OWNER },
      { label: "Finance",   path: "/admin/reports/finance",   icon: DollarSign,    allowedRoles: OWNER },
    ],
  },

  // ── Analytics ─────────────────────────────────────────────────────────────
  // The stock-intelligence surfaces. Grouped away from day-to-day Inventory
  // because these are questions you ask periodically, not screens you work in.
  {
    id: "analytics",
    label: "Analytics",
    icon: LineChart,
    allowedRoles: OWNER,
    items: [
      { label: "Low Stock",       path: "/admin/inventory/low-stock",    icon: AlertTriangle, allowedRoles: OWNER },
      { label: "Out of Stock",    path: "/admin/inventory/out-of-stock", icon: PackageX,      allowedRoles: OWNER },
      { label: "Reorder",         path: "/admin/inventory/reorder",      icon: ShoppingCart,  allowedRoles: OWNER },
      { label: "Stock Valuation", path: "/admin/inventory/valuation",    icon: DollarSign,    allowedRoles: OWNER },
      { label: "Dead Stock",      path: "/admin/inventory/dead-stock",   icon: Snowflake,     allowedRoles: OWNER },
      { label: "Fast Moving",     path: "/admin/inventory/fast-moving",  icon: Flame,         allowedRoles: OWNER },
      { label: "Slow Moving",     path: "/admin/inventory/slow-moving",  icon: TrendingDown,  allowedRoles: OWNER },
      { label: "Damaged Stock",   path: "/admin/inventory/damaged",      icon: Wrench,        allowedRoles: OWNER },
    ],
  },

  // ── Marketing ─────────────────────────────────────────────────────────────
  {
    id: "marketing",
    label: "Marketing",
    icon: Megaphone,
    allowedRoles: OWNER,
    items: [
      { label: "Discounts", path: "/admin/discounts", icon: BadgePercent, allowedRoles: OWNER },
    ],
  },

  // ── Utilities ─────────────────────────────────────────────────────────────
  // Label Printing here is the OPERATIONAL queue (no allowedRoles) — managers
  // print labels. Printer/template CONFIGURATION stays owner-only under
  // Settings, which is the pre-existing split, preserved.
  {
    id: "utilities",
    label: "Utilities",
    icon: Utilities,
    items: [
      { label: "Label Printing", path: "/labels",        icon: Printer },
      { label: "Notifications",  path: "/notifications", icon: Bell },
    ],
  },

  // ── Settings ──────────────────────────────────────────────────────────────
  // Users & Roles and Labels & Printers are built. The rest are PlaceholderPage
  // routes today. They are listed because the spec calls for them and every one
  // resolves to a real route rather than a dead link; `comingSoon` only styles
  // the row so nobody expects a working screen.
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    allowedRoles: OWNER,
    items: [
      // Built. Store identity, business rules, regional/system preferences,
      // security policy and integrations — the OWNER-only configuration surface.
      { label: "Store Settings",    path: "/admin/settings",          icon: Store,          allowedRoles: OWNER },
      // Built. Account administration: create accounts, assign roles,
      // activate/deactivate, reset passwords.
      { label: "Users & Roles",     path: "/admin/settings/users",    icon: UserCog,        allowedRoles: OWNER },
      // Built. Read-only trail of every recorded change, OWNER-only.
      { label: "Audit Logs",        path: "/admin/audit-logs",        icon: Shield,         allowedRoles: OWNER },
      { label: "Backup & Restore",  path: "/admin/settings/backup",   icon: DatabaseBackup, allowedRoles: OWNER, comingSoon: true },
      // Built. Document numbering (live on the sale path) and receipt content.
      { label: "Receipt & Invoice", path: "/admin/settings/receipt",  icon: Receipt,        allowedRoles: OWNER },
      { label: "Barcode Settings",  path: "/admin/settings/barcode",  icon: ScanBarcode,    allowedRoles: OWNER, comingSoon: true },
      // Printers and label templates. A built, owner-only screen that predates
      // the spec's Settings list; kept so its only nav entry isn't lost.
      { label: "Labels & Printers", path: "/admin/labels",            icon: Printer,        allowedRoles: OWNER },
    ],
  },

  // ── Account ───────────────────────────────────────────────────────────────
  {
    id: "account",
    label: "My Account",
    icon: User,
    path: "/profile",
  },
];

// =============================================================================
// HELPERS
// =============================================================================

export function canAccessNavItem(item: NavItem, role: Role): boolean {
  if (!item.allowedRoles || item.allowedRoles.length === 0) return true;
  return item.allowedRoles.includes(role);
}

/** A group is visible when its own roles allow it AND it has something to show. */
export function visibleGroupItems(group: NavGroup, role: Role): NavItem[] {
  if (group.allowedRoles?.length && !group.allowedRoles.includes(role)) return [];
  return (group.items ?? []).filter((item) => canAccessNavItem(item, role));
}

export function isGroupVisible(group: NavGroup, role: Role): boolean {
  if (group.allowedRoles?.length && !group.allowedRoles.includes(role)) return false;
  if (group.path && !group.items?.length) return true;
  return visibleGroupItems(group, role).length > 0;
}

/**
 * The group that should be open for a given URL, so navigating (or landing on a
 * deep link) reveals where you are instead of leaving every section shut.
 *
 * Longest-match wins: `/admin/inventory/low-stock` belongs to Analytics even
 * though Inventory's `/admin/inventory` is also a prefix of it.
 */
export function findGroupForPath(pathname: string, role: Role): string | null {
  let bestId: string | null = null;
  let bestLength = -1;

  for (const group of NAV_GROUPS) {
    for (const item of visibleGroupItems(group, role)) {
      const exact = item.path === pathname;
      const nested = pathname.startsWith(`${item.path}/`);
      if ((exact || nested) && item.path.length > bestLength) {
        bestId = group.id;
        bestLength = item.path.length;
      }
    }
  }

  return bestId;
}
