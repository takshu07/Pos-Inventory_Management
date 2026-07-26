/**
 * @file features/auth/utils/permissions.ts
 *
 * Purpose: Centralized, composable permission-check utilities.
 *
 * Why it exists:
 *   Role checks scattered across components create maintenance nightmares.
 *   When a new role is added (e.g., SUPERVISOR), you'd need to grep the
 *   entire codebase. With centralized helpers, you change one file.
 *
 * Why it belongs in features/auth/:
 *   Permissions are an auth domain concern. They depend on Role (a global type)
 *   but the logic of WHAT each role can do is auth knowledge.
 *
 * Usage:
 *   import { canAccessAdmin } from "@/features/auth";
 *   if (canAccessAdmin(user.role)) { ... }
 *
 * Future extensibility:
 *   - Add feature-flag checks here (e.g., canUseBetaCheckout).
 *   - Add resource-level permissions (e.g., canEditEmployee(actor, target)).
 *   - Add permission arrays for UI rendering (e.g., getAllowedNavItems(role)).
 */

import type { Role } from "@/types";

// ─── Role Hierarchy ───────────────────────────────────────────────────────────
// Defined explicitly — never derive from array index (fragile).
// OWNER > MANAGER > CASHIER

const ROLE_LEVELS: Record<Role, number> = {
  OWNER: 3,
  MANAGER: 2,
  CASHIER: 1,
};

/**
 * Checks if `roleA` has at least the same level of privilege as `roleB`.
 * Used to prevent role escalation (e.g., Manager cannot promote to Owner).
 */
export function hasAtLeastRole(
  userRole: Role | null,
  requiredRole: Role
): boolean {
  if (!userRole) return false;
  return ROLE_LEVELS[userRole] >= ROLE_LEVELS[requiredRole];
}

// ─── Feature-Level Guards ─────────────────────────────────────────────────────
//
// Authorization model (2026-07): the MANAGER role is OPERATIONAL, not
// administrative. Managers run the shop floor — POS, Sales, Customers, and
// read-only visibility into Products and Employee Activity. All *business
// administration* (catalog CRUD, procurement, inventory, finance, reports,
// discounts, cash register, settings, audit logs) is reserved for OWNER.
//
// Every guard below is the single source of truth for one capability; the nav
// config, route guards, and in-view action buttons all read from here so the
// frontend never drifts from the backend rules it mirrors.

/**
 * Can access business ADMINISTRATION (Catalog CRUD, Procurement, Inventory,
 * Finance, Reports, Discounts, Cash Register, Settings, Audit Logs, and the
 * customer analytics dashboard). OWNER only — managers are operational.
 */
export function canAccessAdmin(role: Role | null): boolean {
  return hasAtLeastRole(role, "OWNER");
}

// ─── Portal Routing ─────────────────────────────────────────────────────────
// The app ships two distinct authenticated shells:
//   • Manager Portal (/)         → MANAGER + OWNER: full management surface.
//   • Cashier Portal (/cashier)  → CASHIER only: POS Checkout + My Profile.
// A user belongs to exactly one portal, decided purely by role. These helpers
// are the single source of truth for that decision — login redirect, guest
// redirect, and both route guards all read from here so the rules never drift.

/** True when the role owns the full Manager/Owner management shell. */
export function canAccessManagerPortal(role: Role | null): boolean {
  return hasAtLeastRole(role, "MANAGER");
}

/** True when the role owns the restricted Cashier shell (CASHIER only — never a manager). */
export function canAccessCashierPortal(role: Role | null): boolean {
  return role === "CASHIER";
}

/**
 * Resolves the home route a freshly authenticated user should land on, based
 * solely on their role. MANAGER/OWNER → manager shell; CASHIER → cashier shell.
 * Returns the login route for an unknown/absent role (defensive — should not
 * happen for an authenticated user).
 */
export function portalHomeForRole(role: Role | null): "/" | "/cashier/pos" | "/login" {
  if (canAccessManagerPortal(role)) return "/";
  if (canAccessCashierPortal(role)) return "/cashier/pos";
  return "/login";
}

/** Can access Owner-only features (Settings, Audit Logs, Employee role changes). */
export function canAccessOwnerOnly(role: Role | null): boolean {
  return hasAtLeastRole(role, "OWNER");
}

/** Can void a completed sale. Operational — managers run returns/voids. */
export function canVoidSale(role: Role | null): boolean {
  return hasAtLeastRole(role, "MANAGER");
}

/** Can adjust inventory manually. Administrative → OWNER only. */
export function canAdjustInventory(role: Role | null): boolean {
  return hasAtLeastRole(role, "OWNER");
}

/** Can apply discounts during checkout (all roles can apply; limit is configured server-side). */
export function canApplyDiscount(role: Role | null): boolean {
  return role !== null;
}

/** Can view business reports/analytics. Administrative → OWNER only. */
export function canViewReports(role: Role | null): boolean {
  return hasAtLeastRole(role, "OWNER");
}

// ─── Products (read vs. write) ────────────────────────────────────────────────
// Managers get read-only visibility into the catalog; only OWNER may mutate it.

/** Can view products / product lookup (read-only for managers, full for owner). */
export function canViewProducts(role: Role | null): boolean {
  return hasAtLeastRole(role, "MANAGER");
}

/** Can create/edit products, variants, categories, brands. OWNER only. */
export function canManageProducts(role: Role | null): boolean {
  return hasAtLeastRole(role, "OWNER");
}

// ─── Employees (monitor vs. manage) ───────────────────────────────────────────
// Managers get read-only "Employee Activity" monitoring; only OWNER may create,
// edit, deactivate, or change roles.

/** Can view the Employee Activity monitor (read-only list/detail). MANAGER + OWNER. */
export function canMonitorEmployees(role: Role | null): boolean {
  return hasAtLeastRole(role, "MANAGER");
}

/** Can create/edit/deactivate employees or change their roles. OWNER only. */
export function canManageEmployees(role: Role | null): boolean {
  return hasAtLeastRole(role, "OWNER");
}

/**
 * Can promote/demote an employee to a specific target role.
 * An employee cannot assign a role equal to or above their own.
 * This mirrors the backend RBAC rule.
 */
export function canAssignRole(
  actorRole: Role | null,
  targetRole: Role
): boolean {
  if (!actorRole) return false;
  return ROLE_LEVELS[actorRole] > ROLE_LEVELS[targetRole];
}

// ─── Display Helpers ──────────────────────────────────────────────────────────

/** Human-readable role labels for UI display. */
export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  CASHIER: "Cashier",
};

/** Badge color variant for each role. */
export const ROLE_BADGE_VARIANTS: Record<
  Role,
  "default" | "success" | "warning" | "destructive" | "secondary" | "outline"
> = {
  OWNER: "default",
  MANAGER: "success",
  CASHIER: "secondary",
};
