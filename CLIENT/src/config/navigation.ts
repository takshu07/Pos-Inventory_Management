import type { Role } from "@/types";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  ArrowLeftRight,
  History,
  Wallet,
  Bell,
  User,
  // Admin
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
  UserCog,
} from "lucide-react";

/**
 * Navigation Configuration
 * Single source of truth for all sidebar routes, icons, labels, and RBAC permissions.
 * Adding a new page = adding one entry here.
 */

export interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  /** Roles that can see this item. Empty = all authenticated users. */
  allowedRoles?: Role[];
  badge?: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/** Employee-level navigation (Cashier + Manager + Owner see these) */
export const EMPLOYEE_NAV: NavSection[] = [
  {
    title: "Operations",
    items: [
      { label: "Dashboard",       path: "/",               icon: LayoutDashboard },
      { label: "POS Checkout",    path: "/pos",            icon: ShoppingCart },
      { label: "Sales History",   path: "/sales",          icon: History },
      { label: "Customers",       path: "/customers",      icon: Users },
      { label: "Product Lookup",  path: "/products/lookup", icon: Package },
      { label: "Cash Register",   path: "/finance/register", icon: Wallet },
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

/** Admin-level navigation (Manager + Owner only) */
export const ADMIN_NAV: NavSection[] = [
  {
    title: "Catalog",
    items: [
      { label: "Products",    path: "/admin/products",    icon: Boxes,         allowedRoles: ["MANAGER", "OWNER"] },
      { label: "Categories",  path: "/admin/categories",  icon: Tag,           allowedRoles: ["MANAGER", "OWNER"] },
      { label: "Brands",      path: "/admin/brands",      icon: Award,         allowedRoles: ["MANAGER", "OWNER"] },
    ],
  },
  {
    title: "Procurement",
    items: [
      { label: "Suppliers",   path: "/admin/suppliers",   icon: Truck,         allowedRoles: ["MANAGER", "OWNER"] },
      { label: "Purchases",   path: "/admin/purchases",   icon: ClipboardList, allowedRoles: ["MANAGER", "OWNER"] },
      { label: "Inventory",   path: "/admin/inventory",   icon: Boxes,         allowedRoles: ["MANAGER", "OWNER"] },
    ],
  },
  {
    title: "Business",
    items: [
      { label: "Employees",   path: "/admin/employees",   icon: UserCog,       allowedRoles: ["MANAGER", "OWNER"] },
      { label: "Reports",     path: "/admin/reports",     icon: BarChart3,     allowedRoles: ["MANAGER", "OWNER"] },
      { label: "Finance",     path: "/admin/finance",     icon: DollarSign,    allowedRoles: ["MANAGER", "OWNER"] },
      { label: "Discounts",   path: "/admin/discounts",   icon: BadgePercent,  allowedRoles: ["MANAGER", "OWNER"] },
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
