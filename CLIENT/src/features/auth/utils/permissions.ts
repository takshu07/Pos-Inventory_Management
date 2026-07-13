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

/** Can access the admin section (Catalog, Procurement, Business, System). */
export function canAccessAdmin(role: Role | null): boolean {
  return hasAtLeastRole(role, "MANAGER");
}

/** Can access Owner-only features (Settings, Audit Logs, Employee role changes). */
export function canAccessOwnerOnly(role: Role | null): boolean {
  return hasAtLeastRole(role, "OWNER");
}

/** Can void a completed sale. */
export function canVoidSale(role: Role | null): boolean {
  return hasAtLeastRole(role, "MANAGER");
}

/** Can adjust inventory manually. */
export function canAdjustInventory(role: Role | null): boolean {
  return hasAtLeastRole(role, "MANAGER");
}

/** Can apply discounts during checkout (all roles can apply; limit is configured server-side). */
export function canApplyDiscount(role: Role | null): boolean {
  return role !== null;
}

/** Can view reports. */
export function canViewReports(role: Role | null): boolean {
  return hasAtLeastRole(role, "MANAGER");
}

/** Can manage employees (create, edit, deactivate). */
export function canManageEmployees(role: Role | null): boolean {
  return hasAtLeastRole(role, "MANAGER");
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
