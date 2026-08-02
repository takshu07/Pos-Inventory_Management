/**
 * Users & Roles — the account-administration rule set.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 * --------------------------------
 * These predicates decide what the UI OFFERS. They are not the security
 * boundary. Every rule below is independently enforced by the server, and a
 * tampered client that calls the endpoint anyway gets a 403:
 *
 *   • employee.service `enforceHierarchy`  — an actor may only modify someone
 *     strictly below them, or themselves.
 *   • employee.service                     — an OWNER can never be deactivated.
 *   • workforce.service `changeRole`       — an OWNER's role can never change.
 *   • employee.validation                  — role is `MANAGER | CASHIER`; OWNER
 *     is not an assignable value at all.
 *   • Both route trees                     — every write is `requireRole("OWNER")`.
 *
 * The point of restating them here is that a disabled button with a reason is a
 * better experience than a button that always 403s, AND that the reasons live
 * in one file instead of being re-derived inside five components.
 *
 * ⚠ THREE RULES HERE ARE STRICTER THAN THE SERVER CURRENTLY REQUIRES, ON
 * PURPOSE. They are SECURITY RULES, not UI conveniences, and must not be
 * relaxed on the grounds that "the API allows it":
 *
 *   1. `denyRoleChange`    — nobody may change their OWN role.
 *   2. `denyStatusChange`  — nobody may deactivate their OWN account.
 *   3. `denyPasswordReset` — nobody may owner-reset their OWN password.
 *
 * The server's `enforceHierarchy` explicitly PERMITS self-modification
 * (`if (executor.id === targetId) return;`). For an owner the separate
 * owner-guards happen to catch (1) and (2) today — but that is a coincidence
 * of the current role set, not the rule being enforced. Add any non-owner
 * administrator role and the server stops covering these entirely.
 *
 * (3) has no server counterpart at all and is the most important of the three:
 * the owner-reset path deliberately requires no CURRENT password, so pointing
 * it at your own account converts any unattended unlocked session into a
 * permanent account takeover. Changing your own password belongs in My Profile,
 * which demands the current one.
 *
 * All three are pinned by features/users/__tests__/accountRules.test.ts.
 * See docs/USERS_AND_PROFILE.md §3 for the full matrix.
 *
 * Each guard returns a `Denial` (a reason string) or `null` for "allowed", so a
 * caller can render *why* an action is unavailable rather than silently hiding
 * it. Silent hiding is what makes an admin screen feel broken — the owner knows
 * the action exists and cannot tell why it vanished.
 */

import { hasAtLeastRole } from "@/features/auth";
import type { Role } from "@/types";
import type { AssignableRole, User } from "../types";

/** A human-readable reason an action is unavailable, or null when it is allowed. */
export type Denial = string | null;

/** The actor performing the administration, as this module needs to know them. */
export interface Actor {
  id: string;
  role: Role | null;
}

// =============================================================================
// MODULE ACCESS
// =============================================================================

/**
 * Who may open Users & Roles at all. OWNER only.
 *
 * Managers are operational under the 2026-07 RBAC model: they monitor staff
 * through Workforce (read-only) but do not administer accounts. `OwnerRoute`
 * enforces this at the route level; this predicate exists so nav and in-page
 * affordances read from the same rule.
 */
export function canAdministerUsers(role: Role | null): boolean {
  return hasAtLeastRole(role, "OWNER");
}

// =============================================================================
// PER-ACCOUNT GUARDS
// =============================================================================

/**
 * Whether `actor` may modify `target` at all.
 *
 * Mirrors `enforceHierarchy`: self is always permitted, otherwise the actor
 * must outrank the target strictly. The OWNER-vs-OWNER case is what this
 * catches — two owners cannot administer each other, because equal rank is not
 * "strictly above".
 */
export function denyModify(actor: Actor, target: User): Denial {
  if (!canAdministerUsers(actor.role)) {
    return "Only the owner can administer accounts.";
  }
  if (actor.id === target.id) return null; // Self-modification is allowed.
  if (target.role === "OWNER") {
    return "Owner accounts cannot be modified from this screen.";
  }
  return null;
}

/**
 * Whether `actor` may change `target`'s role.
 *
 * Three separate refusals, because they have three different remedies:
 *   1. Owners cannot be re-roled at all — ownership transfer is a distinct
 *      process that does not exist yet.
 *   2. Nobody may change their OWN role. This is the core privilege-escalation
 *      guard: without it the sole owner could demote themselves and lock the
 *      business out of its own administration with no recovery path.
 *   3. Anything the general modify rule already refuses.
 */
export function denyRoleChange(actor: Actor, target: User): Denial {
  const denial = denyModify(actor, target);
  if (denial) return denial;

  if (target.role === "OWNER") {
    return "The owner's role cannot be changed. Transfer ownership instead.";
  }
  if (actor.id === target.id) {
    return "You cannot change your own role.";
  }
  return null;
}

/**
 * Whether `actor` may assign the specific role `next` to `target`.
 *
 * Beyond the general role-change rules, this refuses assigning a role at or
 * above the actor's own — `canAssignRole` in features/auth is the shared
 * hierarchy check, so this screen and every other role-aware surface agree.
 * In practice an OWNER outranks both assignable roles, so this only bites if
 * the assignable set ever widens; encoding it now means it bites correctly.
 */
export function denyRoleAssignment(
  actor: Actor,
  target: User,
  next: AssignableRole
): Denial {
  const denial = denyRoleChange(actor, target);
  if (denial) return denial;

  if (next === target.role) {
    return `They are already a ${next === "MANAGER" ? "manager" : "cashier"}.`;
  }
  if (!actor.role || !outranks(actor.role, next)) {
    return "You cannot assign a role at or above your own.";
  }
  return null;
}

/**
 * Whether `actor` may deactivate or reactivate `target`.
 *
 * Two refusals the server also enforces:
 *   1. An OWNER cannot be deactivated — it is the root of access, and
 *      deactivating it locks everyone out with no recovery path.
 *   2. Nobody may deactivate themselves. The server's `enforceHierarchy`
 *      permits self-modification, and for an OWNER the owner-guard catches it
 *      anyway — but stating it here keeps the UI honest for any future
 *      non-owner administrator, and "log yourself out permanently" is never an
 *      intended click.
 */
export function denyStatusChange(actor: Actor, target: User): Denial {
  const denial = denyModify(actor, target);
  if (denial) return denial;

  if (target.role === "OWNER") {
    return "The owner account cannot be deactivated. Transfer ownership first.";
  }
  if (actor.id === target.id) {
    return "You cannot deactivate your own account.";
  }
  return null;
}

/**
 * Whether `actor` may reset `target`'s password.
 *
 * Self is excluded deliberately: an owner changing their own password belongs
 * in My Profile, which requires the CURRENT password. Allowing a no-current-
 * password path to your own account here would turn any unlocked session into
 * a permanent account takeover.
 */
export function denyPasswordReset(actor: Actor, target: User): Denial {
  const denial = denyModify(actor, target);
  if (denial) return denial;

  if (actor.id === target.id) {
    return "Change your own password from My Profile.";
  }
  if (!target.isActive) {
    return "Reactivate this account before resetting its password.";
  }
  return null;
}

// =============================================================================
// HELPERS
// =============================================================================

/** Strict "outranks" — equal rank is not above. Mirrors ROLE_HIERARCHY server-side. */
function outranks(actor: Role, target: Role): boolean {
  const LEVELS: Record<Role, number> = { OWNER: 3, MANAGER: 2, CASHIER: 1 };
  return LEVELS[actor] > LEVELS[target];
}

/**
 * The roles `actor` may assign, given the target.
 *
 * Returns the assignable roles the actor outranks, minus the target's current
 * one. Used to build the role dropdown, so an option that would be refused is
 * never rendered in the first place.
 */
export function assignableRolesFor(
  actor: Actor,
  target: User,
  candidates: readonly AssignableRole[]
): AssignableRole[] {
  if (denyRoleChange(actor, target)) return [];
  return candidates.filter(
    (role) => role !== target.role && actor.role && outranks(actor.role, role)
  );
}
