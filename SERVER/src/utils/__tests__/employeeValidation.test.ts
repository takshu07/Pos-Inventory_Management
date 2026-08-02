/**
 * Contract tests for the employee validation schemas.
 *
 * WHY THESE LIVE HERE: the client's Users & Roles feature MIRRORS these rules
 * (see CLIENT/src/features/users/validation) so a bad value is caught at the
 * keystroke rather than after a round trip. That mirror is only useful while it
 * is accurate. These tests pin the server side of the contract, so tightening a
 * rule here fails loudly and prompts the matching client change instead of
 * silently letting the client submit input the server now rejects.
 *
 * The rules pinned below are the ones the UI depends on structurally:
 *
 *   • role is MANAGER | CASHIER — OWNER is NOT assignable through any employee
 *     endpoint. The role dropdown and `AssignableRole` both rely on this.
 *   • the empty-string email is ACCEPTED, because that is how the service
 *     clears an address (`if (data.email === "") updateData.email = null`).
 *   • update accepts `isActive`, which is how deactivation is expressed —
 *     there is no delete endpoint and there must not be one.
 *   • update accepts NO password. Password changes go through
 *     /auth/change-password or the workforce reset endpoint, both of which
 *     revoke sessions.
 *
 * Pure schema parsing — no database, no network. Runs under `npm run test:unit`.
 */

import { describe, expect, it } from "vitest";

import { employeeValidation } from "../../validation/employee.validation";

const { create, update, listQuery } = employeeValidation;

/** A minimally valid create payload; individual tests override one field. */
function validCreate(overrides: Record<string, unknown> = {}) {
  return {
    firstName: "Rahul",
    lastName: "Sharma",
    phone: "9876543210",
    password: "Password1",
    role: "CASHIER",
    ...overrides,
  };
}

// =============================================================================
// ROLE — the privilege-escalation boundary
// =============================================================================

describe("employee role", () => {
  it.each(["MANAGER", "CASHIER"])("accepts %s on create", (role) => {
    expect(create.safeParse(validCreate({ role })).success).toBe(true);
  });

  it("REJECTS OWNER on create", () => {
    // The owner is established once by /auth/setup. If this ever starts
    // passing, an owner account becomes creatable through the ordinary employee
    // endpoint and the client's role dropdown is no longer a complete list.
    expect(create.safeParse(validCreate({ role: "OWNER" })).success).toBe(false);
  });

  it("REJECTS OWNER on update", () => {
    expect(update.safeParse({ role: "OWNER" }).success).toBe(false);
  });

  it("rejects an unknown role", () => {
    expect(create.safeParse(validCreate({ role: "SUPERVISOR" })).success).toBe(false);
  });

  it("requires a role on create", () => {
    const payload = validCreate();
    delete (payload as Record<string, unknown>)["role"];
    expect(create.safeParse(payload).success).toBe(false);
  });
});

// =============================================================================
// PHONE — /^[6-9]\d{9}$/
// =============================================================================

describe("phone", () => {
  it.each(["9876543210", "6000000000", "7123456789", "8999999999"])(
    "accepts %s",
    (phone) => {
      expect(create.safeParse(validCreate({ phone })).success).toBe(true);
    }
  );

  it.each(["5876543210", "1234567890", "987654321", "98765432101", "abcdefghij"])(
    "rejects %s",
    (phone) => {
      expect(create.safeParse(validCreate({ phone })).success).toBe(false);
    }
  );

  it("is required on create but optional on update", () => {
    const payload = validCreate();
    delete (payload as Record<string, unknown>)["phone"];
    expect(create.safeParse(payload).success).toBe(false);
    expect(update.safeParse({}).success).toBe(true);
  });
});

// =============================================================================
// PASSWORD — 8+, one lower, one upper, one digit. No special character.
// =============================================================================

describe("password", () => {
  it("accepts a compliant password", () => {
    expect(create.safeParse(validCreate({ password: "Password1" })).success).toBe(true);
  });

  it.each([
    ["Pass1", "too short"],
    ["password1", "no uppercase"],
    ["PASSWORD1", "no lowercase"],
    ["PasswordX", "no digit"],
  ])("rejects %s (%s)", (password) => {
    expect(create.safeParse(validCreate({ password })).success).toBe(false);
  });

  it("does NOT require a special character", () => {
    // /auth/change-password is stricter and does. The two are deliberately
    // different; the client mirrors each against its own endpoint.
    expect(create.safeParse(validCreate({ password: "Password1" })).success).toBe(true);
  });

  it("is NOT accepted by the update schema at all", () => {
    // Passwords are changed through /auth/change-password (needs the current
    // one) or the workforce reset endpoint (revokes sessions). Neither is this
    // schema, so a password here must be stripped rather than applied.
    const result = update.safeParse({ password: "Password1" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("password" in result.data).toBe(false);
    }
  });
});

// =============================================================================
// EMAIL — optional, and the EMPTY STRING IS MEANINGFUL
// =============================================================================

describe("email", () => {
  it("accepts a valid address and lowercases it", () => {
    const result = create.safeParse(validCreate({ email: "Rahul@Example.COM" }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("rahul@example.com");
  });

  it("accepts an empty string — the service reads it as 'clear the address'", () => {
    expect(update.safeParse({ email: "" }).success).toBe(true);
  });

  it("accepts omission entirely", () => {
    expect(create.safeParse(validCreate()).success).toBe(true);
  });

  it("rejects a malformed address", () => {
    expect(create.safeParse(validCreate({ email: "not-an-email" })).success).toBe(false);
  });
});

// =============================================================================
// ACTIVATION — deactivation is this system's "delete"
// =============================================================================

describe("isActive", () => {
  it("accepts false — deactivation is expressed through update", () => {
    const result = update.safeParse({ isActive: false });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isActive).toBe(false);
  });

  it("accepts true — reactivation uses the same field", () => {
    const result = update.safeParse({ isActive: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isActive).toBe(true);
  });

  it("rejects a non-boolean", () => {
    expect(update.safeParse({ isActive: "false" }).success).toBe(false);
  });

  it("is not settable at creation — new accounts are active by default", () => {
    const result = create.safeParse(validCreate({ isActive: false }));
    expect(result.success).toBe(true);
    if (result.success) expect("isActive" in result.data).toBe(false);
  });
});

// =============================================================================
// NAMES
// =============================================================================

describe("names", () => {
  it("requires 2+ characters for the first name", () => {
    expect(create.safeParse(validCreate({ firstName: "R" })).success).toBe(false);
    expect(create.safeParse(validCreate({ firstName: "Ra" })).success).toBe(true);
  });

  it("accepts a single-character last name", () => {
    expect(create.safeParse(validCreate({ lastName: "K" })).success).toBe(true);
  });

  it("rejects names beyond 50 characters", () => {
    expect(create.safeParse(validCreate({ firstName: "a".repeat(51) })).success).toBe(false);
    expect(create.safeParse(validCreate({ lastName: "a".repeat(51) })).success).toBe(false);
  });

  it("trims surrounding whitespace", () => {
    const result = create.safeParse(validCreate({ firstName: "  Rahul  " }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.firstName).toBe("Rahul");
  });
});

// =============================================================================
// SALARY
// =============================================================================

describe("salary", () => {
  it("rejects a negative value", () => {
    expect(create.safeParse(validCreate({ salary: -1 })).success).toBe(false);
  });

  it("coerces a numeric string", () => {
    const result = create.safeParse(validCreate({ salary: "25000" }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.salary).toBe(25000);
  });

  it("accepts omission — no salary on file is not a salary of zero", () => {
    const result = create.safeParse(validCreate());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.salary).toBeUndefined();
  });
});

// =============================================================================
// LIST QUERY — the filters, sorting and pagination the UI sends
// =============================================================================

describe("list query", () => {
  it("defaults page, limit, sortBy and sortOrder", () => {
    const result = listQuery.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(10);
      expect(result.data.sortBy).toBe("createdAt");
      expect(result.data.sortOrder).toBe("desc");
    }
  });

  it("accepts OWNER as a FILTER even though it is not assignable", () => {
    // Listing owners is legitimate; creating one through this API is not. The
    // two enums differ on purpose, and the Users screen relies on it to offer
    // "All roles / Owner / Manager / Cashier" in its filter.
    expect(listQuery.safeParse({ role: "OWNER" }).success).toBe(true);
  });

  it.each(["createdAt", "firstName", "joiningDate", "salary"])(
    "accepts %s as a sort key",
    (sortBy) => {
      expect(listQuery.safeParse({ sortBy }).success).toBe(true);
    }
  );

  it("rejects an unknown sort key", () => {
    // The client filters its sort keys to this exact set before sending.
    expect(listQuery.safeParse({ sortBy: "password" }).success).toBe(false);
  });

  it("transforms the isActive query string into a boolean", () => {
    const active = listQuery.safeParse({ isActive: "true" });
    expect(active.success).toBe(true);
    if (active.success) expect(active.data.isActive).toBe(true);

    const inactive = listQuery.safeParse({ isActive: "false" });
    expect(inactive.success).toBe(true);
    if (inactive.success) expect(inactive.data.isActive).toBe(false);
  });

  it("rejects an empty isActive rather than reading it as a filter", () => {
    // Which is why the client drops empty params instead of sending `?isActive=`.
    expect(listQuery.safeParse({ isActive: "" }).success).toBe(false);
  });

  it("caps limit at 100 so the UI cannot request an unbounded page", () => {
    expect(listQuery.safeParse({ limit: 100 }).success).toBe(true);
    expect(listQuery.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("rejects a page below 1", () => {
    expect(listQuery.safeParse({ page: 0 }).success).toBe(false);
  });
});
