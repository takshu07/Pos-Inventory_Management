/**
 * Regression tests for the Users & Roles form schemas.
 *
 * These mirror `SERVER/src/validation/employee.validation.ts`. The point of
 * testing them is not that zod works — it is that the MIRROR stays accurate.
 * If the server tightens a rule and this file is not updated, the client
 * happily submits input the server rejects, and the user sees a round-trip
 * error on a field that looked valid. Each expectation below names the server
 * rule it pins.
 */

import { describe, expect, it } from "vitest";

import {
  createUserSchema,
  editUserSchema,
  resetPasswordSchema,
} from "../validation";

/** A minimally valid create payload; individual tests override one field. */
function validCreate(overrides: Record<string, unknown> = {}) {
  return {
    firstName: "Rahul",
    lastName: "Sharma",
    email: "rahul@example.com",
    phone: "9876543210",
    password: "Password1",
    confirmPassword: "Password1",
    role: "CASHIER",
    gender: "",
    address: "",
    salary: "",
    joiningDate: "",
    dateOfBirth: "",
    ...overrides,
  };
}

// =============================================================================
// PHONE — server rule: /^[6-9]\d{9}$/
// =============================================================================

describe("phone validation", () => {
  it.each(["9876543210", "6000000000", "7123456789", "8999999999"])(
    "accepts a valid Indian mobile: %s",
    (phone) => {
      expect(createUserSchema.safeParse(validCreate({ phone })).success).toBe(true);
    }
  );

  it.each([
    ["5876543210", "starts below 6"],
    ["1234567890", "starts with 1"],
    ["987654321", "only 9 digits"],
    ["98765432101", "11 digits"],
    ["98765abcde", "contains letters"],
    ["", "empty"],
  ])("rejects %s (%s)", (phone) => {
    expect(createUserSchema.safeParse(validCreate({ phone })).success).toBe(false);
  });
});

// =============================================================================
// PASSWORD — server rule: 8+ chars, one lower, one upper, one digit.
// Deliberately NOT the same as auth's change-password rule, which additionally
// requires a special character. Each mirrors its own endpoint.
// =============================================================================

describe("password validation", () => {
  it("accepts 8+ chars with upper, lower and a digit", () => {
    expect(createUserSchema.safeParse(validCreate({
      password: "Password1",
      confirmPassword: "Password1",
    })).success).toBe(true);
  });

  it.each([
    ["Pass1", "too short"],
    ["password1", "no uppercase"],
    ["PASSWORD1", "no lowercase"],
    ["PasswordX", "no digit"],
  ])("rejects %s (%s)", (password) => {
    const result = createUserSchema.safeParse(
      validCreate({ password, confirmPassword: password })
    );
    expect(result.success).toBe(false);
  });

  it("does NOT require a special character", () => {
    // The employee endpoints accept this; only /auth/change-password is stricter.
    // Pinning it stops someone 'harmonising' the two schemas and silently making
    // account creation reject passwords the server would have taken.
    expect(createUserSchema.safeParse(validCreate({
      password: "Password1",
      confirmPassword: "Password1",
    })).success).toBe(true);
  });

  it("rejects mismatched confirmation", () => {
    const result = createUserSchema.safeParse(
      validCreate({ password: "Password1", confirmPassword: "Password2" })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("confirmPassword"))).toBe(true);
    }
  });
});

// =============================================================================
// ROLE — server rule: z.enum(["MANAGER", "CASHIER"]). OWNER is NOT assignable.
// =============================================================================

describe("role validation", () => {
  it.each(["MANAGER", "CASHIER"])("accepts %s", (role) => {
    expect(createUserSchema.safeParse(validCreate({ role })).success).toBe(true);
  });

  it("rejects OWNER — the owner is created once by /auth/setup", () => {
    expect(createUserSchema.safeParse(validCreate({ role: "OWNER" })).success).toBe(false);
  });

  it("rejects an unknown role", () => {
    expect(createUserSchema.safeParse(validCreate({ role: "ADMIN" })).success).toBe(false);
  });
});

// =============================================================================
// NAMES — server rule: first 2-50, last 1-50
// =============================================================================

describe("name validation", () => {
  it("requires at least 2 characters for the first name", () => {
    expect(createUserSchema.safeParse(validCreate({ firstName: "R" })).success).toBe(false);
    expect(createUserSchema.safeParse(validCreate({ firstName: "Ra" })).success).toBe(true);
  });

  it("accepts a single-character last name", () => {
    // Deliberately laxer than firstName, matching the server exactly.
    expect(createUserSchema.safeParse(validCreate({ lastName: "K" })).success).toBe(true);
  });

  it("rejects an empty last name", () => {
    expect(createUserSchema.safeParse(validCreate({ lastName: "" })).success).toBe(false);
  });

  it("rejects names beyond 50 characters", () => {
    expect(createUserSchema.safeParse(validCreate({ firstName: "a".repeat(51) })).success)
      .toBe(false);
  });
});

// =============================================================================
// EMAIL — optional, and the EMPTY STRING IS MEANINGFUL (clears the address)
// =============================================================================

describe("email validation", () => {
  it("accepts a valid address", () => {
    expect(createUserSchema.safeParse(validCreate({ email: "a@b.com" })).success).toBe(true);
  });

  it("accepts an empty string and PRESERVES it", () => {
    // The server reads `email: ""` as "clear this address". Normalising it to
    // undefined here would make removing an email a silent no-op.
    const result = editUserSchema.safeParse({
      firstName: "Rahul",
      lastName: "Sharma",
      email: "",
      phone: "9876543210",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("");
  });

  it("rejects a malformed address", () => {
    expect(createUserSchema.safeParse(validCreate({ email: "not-an-email" })).success)
      .toBe(false);
  });

  it("lowercases the address", () => {
    const result = createUserSchema.safeParse(validCreate({ email: "Rahul@Example.COM" }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("rahul@example.com");
  });
});

// =============================================================================
// SALARY — empty means "not recorded", never zero
// =============================================================================

describe("salary validation", () => {
  it("accepts an empty value", () => {
    expect(createUserSchema.safeParse(validCreate({ salary: "" })).success).toBe(true);
  });

  it("accepts a positive number", () => {
    expect(createUserSchema.safeParse(validCreate({ salary: "25000" })).success).toBe(true);
  });

  it("rejects a negative salary", () => {
    expect(createUserSchema.safeParse(validCreate({ salary: "-1" })).success).toBe(false);
  });

  it("rejects a non-numeric salary", () => {
    expect(createUserSchema.safeParse(validCreate({ salary: "lots" })).success).toBe(false);
  });
});

// =============================================================================
// EDIT SCHEMA — must not accept a password or a role
// =============================================================================

describe("editUserSchema", () => {
  it("validates identity fields", () => {
    expect(
      editUserSchema.safeParse({
        firstName: "Rahul",
        lastName: "Sharma",
        phone: "9876543210",
      }).success
    ).toBe(true);
  });

  it("strips a password if one is somehow supplied", () => {
    // The /employees PATCH endpoint does not accept a password at all. Even if a
    // caller passes one, it must not reach the payload.
    const result = editUserSchema.safeParse({
      firstName: "Rahul",
      lastName: "Sharma",
      phone: "9876543210",
      password: "Password1",
    });
    expect(result.success).toBe(true);
    if (result.success) expect("password" in result.data).toBe(false);
  });

  it("strips a role if one is somehow supplied", () => {
    // Role changes go through the workforce endpoint (which revokes sessions),
    // never through this form.
    const result = editUserSchema.safeParse({
      firstName: "Rahul",
      lastName: "Sharma",
      phone: "9876543210",
      role: "MANAGER",
    });
    expect(result.success).toBe(true);
    if (result.success) expect("role" in result.data).toBe(false);
  });
});

// =============================================================================
// RESET PASSWORD
// =============================================================================

describe("resetPasswordSchema", () => {
  it("accepts a compliant matching pair", () => {
    expect(
      resetPasswordSchema.safeParse({
        newPassword: "Password1",
        confirmPassword: "Password1",
      }).success
    ).toBe(true);
  });

  it("rejects a mismatch", () => {
    expect(
      resetPasswordSchema.safeParse({
        newPassword: "Password1",
        confirmPassword: "Password2",
      }).success
    ).toBe(false);
  });

  it("rejects a weak password", () => {
    expect(
      resetPasswordSchema.safeParse({
        newPassword: "weak",
        confirmPassword: "weak",
      }).success
    ).toBe(false);
  });
});
