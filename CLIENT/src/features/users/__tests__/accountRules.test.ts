/**
 * Regression tests for the account-administration rule set.
 *
 * WHY THIS FILE EXISTS: these guards decide whether the UI offers privilege
 * escalation. A regression here is silent — no crash, no type error, just a
 * button that appears where it should not — and the failure mode is somebody
 * demoting the only owner or resetting their way into an account. The server
 * enforces all of it independently, so a bug here is not exploitable on its
 * own, but it produces a UI that offers actions which then 403, which is how
 * people learn to ignore permission errors.
 *
 * Each block below pins one rule that mirrors a specific server guard; the
 * comment names the server counterpart so the two can be kept in step.
 */

import { describe, expect, it } from "vitest";

import {
  assignableRolesFor,
  canAdministerUsers,
  denyModify,
  denyPasswordReset,
  denyRoleAssignment,
  denyRoleChange,
  denyStatusChange,
  type Actor,
} from "../utils/accountRules";
import { ASSIGNABLE_ROLES, type User } from "../types";

// =============================================================================
// FIXTURES
// =============================================================================

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    employeeCode: "EMP-000002",
    firstName: "Rahul",
    lastName: "Sharma",
    email: "rahul@example.com",
    phone: "9876543210",
    role: "CASHIER",
    isActive: true,
    gender: null,
    address: null,
    salary: null,
    joiningDate: "2026-01-01T00:00:00.000Z",
    dateOfBirth: null,
    lastLogin: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const OWNER: Actor = { id: "owner-1", role: "OWNER" };
const MANAGER: Actor = { id: "manager-1", role: "MANAGER" };
const CASHIER: Actor = { id: "cashier-1", role: "CASHIER" };
const ANONYMOUS: Actor = { id: "", role: null };

// =============================================================================
// MODULE ACCESS — mirrors OwnerRoute + requireRole("OWNER") on both trees
// =============================================================================

describe("canAdministerUsers", () => {
  it("admits only the owner", () => {
    expect(canAdministerUsers("OWNER")).toBe(true);
    expect(canAdministerUsers("MANAGER")).toBe(false);
    expect(canAdministerUsers("CASHIER")).toBe(false);
    expect(canAdministerUsers(null)).toBe(false);
  });
});

// =============================================================================
// GENERAL MODIFY — mirrors employee.service `enforceHierarchy`
// =============================================================================

describe("denyModify", () => {
  it("lets an owner modify a manager or cashier", () => {
    expect(denyModify(OWNER, makeUser({ role: "CASHIER" }))).toBeNull();
    expect(denyModify(OWNER, makeUser({ role: "MANAGER" }))).toBeNull();
  });

  it("refuses every non-owner actor", () => {
    for (const actor of [MANAGER, CASHIER, ANONYMOUS]) {
      expect(denyModify(actor, makeUser())).toBeTruthy();
    }
  });

  it("refuses one owner administering another", () => {
    // Equal rank is NOT "strictly above" — the server's ROLE_HIERARCHY check is
    // `executorLevel <= targetLevel` → forbidden.
    const otherOwner = makeUser({ id: "owner-2", role: "OWNER" });
    expect(denyModify(OWNER, otherOwner)).toBeTruthy();
  });

  it("permits self-modification", () => {
    const self = makeUser({ id: OWNER.id, role: "OWNER" });
    expect(denyModify(OWNER, self)).toBeNull();
  });
});

// =============================================================================
// ROLE CHANGE — the core privilege-escalation surface.
// Mirrors workforce.service `changeRole` + employee.validation's role enum.
// =============================================================================

describe("denyRoleChange", () => {
  it("allows an owner to re-role a cashier or manager", () => {
    expect(denyRoleChange(OWNER, makeUser({ role: "CASHIER" }))).toBeNull();
    expect(denyRoleChange(OWNER, makeUser({ role: "MANAGER" }))).toBeNull();
  });

  it("refuses changing an owner's role", () => {
    // Server: "The owner's role cannot be changed. Transfer ownership instead."
    const otherOwner = makeUser({ id: "owner-2", role: "OWNER" });
    expect(denyRoleChange(OWNER, otherOwner)).toBeTruthy();
  });

  it("refuses changing YOUR OWN role", () => {
    // The lock-yourself-out guard. Without it a sole owner could demote
    // themselves and leave the business with no administrator at all.
    const self = makeUser({ id: OWNER.id, role: "OWNER" });
    expect(denyRoleChange(OWNER, self)).toBeTruthy();
  });

  it("refuses a manager trying to re-role anyone", () => {
    expect(denyRoleChange(MANAGER, makeUser({ role: "CASHIER" }))).toBeTruthy();
    expect(denyRoleChange(MANAGER, makeUser({ role: "MANAGER" }))).toBeTruthy();
  });
});

describe("denyRoleAssignment", () => {
  it("allows an owner to promote a cashier to manager", () => {
    expect(denyRoleAssignment(OWNER, makeUser({ role: "CASHIER" }), "MANAGER")).toBeNull();
  });

  it("allows an owner to demote a manager to cashier", () => {
    expect(denyRoleAssignment(OWNER, makeUser({ role: "MANAGER" }), "CASHIER")).toBeNull();
  });

  it("refuses assigning the role the target already holds", () => {
    expect(denyRoleAssignment(OWNER, makeUser({ role: "CASHIER" }), "CASHIER")).toBeTruthy();
    expect(denyRoleAssignment(OWNER, makeUser({ role: "MANAGER" }), "MANAGER")).toBeTruthy();
  });

  it("refuses a manager assigning any role — no lateral escalation", () => {
    // A manager promoting a cashier to MANAGER would be assigning a role equal
    // to their own. Refused twice over: by the owner-only gate, and by the
    // strict-outranks rule.
    expect(denyRoleAssignment(MANAGER, makeUser({ role: "CASHIER" }), "MANAGER")).toBeTruthy();
    expect(denyRoleAssignment(MANAGER, makeUser({ role: "CASHIER" }), "CASHIER")).toBeTruthy();
  });
});

describe("assignableRolesFor", () => {
  it("offers an owner the roles the target does not already hold", () => {
    expect(assignableRolesFor(OWNER, makeUser({ role: "CASHIER" }), ASSIGNABLE_ROLES)).toEqual([
      "MANAGER",
    ]);
    expect(assignableRolesFor(OWNER, makeUser({ role: "MANAGER" }), ASSIGNABLE_ROLES)).toEqual([
      "CASHIER",
    ]);
  });

  it("offers nothing for an owner target", () => {
    const otherOwner = makeUser({ id: "owner-2", role: "OWNER" });
    expect(assignableRolesFor(OWNER, otherOwner, ASSIGNABLE_ROLES)).toEqual([]);
  });

  it("offers nothing when the actor is looking at themselves", () => {
    const self = makeUser({ id: OWNER.id, role: "OWNER" });
    expect(assignableRolesFor(OWNER, self, ASSIGNABLE_ROLES)).toEqual([]);
  });

  it("offers nothing to a non-owner", () => {
    expect(assignableRolesFor(MANAGER, makeUser({ role: "CASHIER" }), ASSIGNABLE_ROLES)).toEqual(
      []
    );
  });

  it("never offers OWNER, because it is not an assignable role", () => {
    // The server's create/update schemas are z.enum(["MANAGER","CASHIER"]).
    // Sending OWNER is a 400, so the dropdown must never contain it.
    const offered = assignableRolesFor(OWNER, makeUser({ role: "CASHIER" }), ASSIGNABLE_ROLES);
    expect(offered).not.toContain("OWNER");
  });
});

// =============================================================================
// ACTIVATION — mirrors the OWNER-deactivation guard in employee.service
// =============================================================================

describe("denyStatusChange", () => {
  it("allows an owner to deactivate a cashier or manager", () => {
    expect(denyStatusChange(OWNER, makeUser({ role: "CASHIER" }))).toBeNull();
    expect(denyStatusChange(OWNER, makeUser({ role: "MANAGER" }))).toBeNull();
  });

  it("allows reactivating a deactivated account", () => {
    expect(denyStatusChange(OWNER, makeUser({ isActive: false }))).toBeNull();
  });

  it("refuses deactivating an owner — it would lock everyone out", () => {
    // Server: "The owner account cannot be deactivated. Transfer ownership first."
    const otherOwner = makeUser({ id: "owner-2", role: "OWNER" });
    expect(denyStatusChange(OWNER, otherOwner)).toBeTruthy();
  });

  it("refuses deactivating yourself", () => {
    const self = makeUser({ id: OWNER.id, role: "OWNER" });
    expect(denyStatusChange(OWNER, self)).toBeTruthy();
  });

  it("refuses a manager changing anyone's status", () => {
    expect(denyStatusChange(MANAGER, makeUser())).toBeTruthy();
  });
});

// =============================================================================
// PASSWORD RESET — the owner-initiated path that needs no current password
// =============================================================================

describe("denyPasswordReset", () => {
  it("allows an owner to reset an active cashier's password", () => {
    expect(denyPasswordReset(OWNER, makeUser({ role: "CASHIER" }))).toBeNull();
  });

  it("refuses resetting your OWN password here", () => {
    // Self-service belongs in My Profile, which requires the current password.
    // Allowing it here would turn any unlocked session into a takeover.
    const self = makeUser({ id: OWNER.id, role: "OWNER" });
    expect(denyPasswordReset(OWNER, self)).toBeTruthy();
  });

  it("refuses resetting a deactivated account's password", () => {
    // Pointless and misleading: they still cannot sign in afterwards.
    expect(denyPasswordReset(OWNER, makeUser({ isActive: false }))).toBeTruthy();
  });

  it("refuses resetting another owner's password", () => {
    const otherOwner = makeUser({ id: "owner-2", role: "OWNER" });
    expect(denyPasswordReset(OWNER, otherOwner)).toBeTruthy();
  });

  it("refuses a manager resetting anyone's password", () => {
    expect(denyPasswordReset(MANAGER, makeUser())).toBeTruthy();
  });
});

// =============================================================================
// CROSS-CUTTING: no guard may ever pass for an unauthenticated actor.
// =============================================================================

describe("unauthenticated actor", () => {
  it("is refused by every guard", () => {
    const target = makeUser();
    expect(denyModify(ANONYMOUS, target)).toBeTruthy();
    expect(denyRoleChange(ANONYMOUS, target)).toBeTruthy();
    expect(denyRoleAssignment(ANONYMOUS, target, "MANAGER")).toBeTruthy();
    expect(denyStatusChange(ANONYMOUS, target)).toBeTruthy();
    expect(denyPasswordReset(ANONYMOUS, target)).toBeTruthy();
    expect(assignableRolesFor(ANONYMOUS, target, ASSIGNABLE_ROLES)).toEqual([]);
  });
});
