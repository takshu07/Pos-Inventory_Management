/**
 * Users & Roles — form validation.
 *
 * Every rule here MIRRORS `SERVER/src/validation/employee.validation.ts`. That
 * duplication is intentional and one-directional: the server is the authority
 * and rejects bad input independently, while these schemas exist so a typo is
 * caught at the keystroke instead of after a round trip. If the two ever
 * disagree, the server wins and this file is the one that is wrong.
 *
 * Kept deliberately in step with the server:
 *   • phone     — /^[6-9]\d{9}$/  (Indian mobile)
 *   • password  — 8+ chars, one upper, one lower, one digit
 *   • names     — first 2-50, last 1-50
 *   • role      — MANAGER | CASHIER only (OWNER is not assignable)
 *
 * NOTE the password rule differs from `features/auth`'s changePasswordSchema,
 * which additionally demands a special character. That is not an oversight:
 * auth's schema guards `/auth/change-password`, whose server-side rule is
 * stricter than the employee endpoints'. Each mirrors its own endpoint.
 */

import { z } from "zod";

import { ASSIGNABLE_ROLES } from "../types";

// ─── Reusable field schemas ──────────────────────────────────────────────────

const phoneSchema = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number starting 6-9.");

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(100, "Password cannot exceed 100 characters.")
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    "Include an uppercase letter, a lowercase letter and a number."
  );

/**
 * Email is optional throughout.
 *
 * The empty string is preserved rather than normalised away, because the server
 * treats `email: ""` as an instruction to CLEAR the address. Mapping it to
 * undefined here would make "remove this email" silently do nothing.
 */
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address.")
  .or(z.literal(""))
  .optional();

const firstNameSchema = z
  .string()
  .trim()
  .min(2, "First name must be at least 2 characters.")
  .max(50, "First name cannot exceed 50 characters.");

const lastNameSchema = z
  .string()
  .trim()
  .min(1, "Last name is required.")
  .max(50, "Last name cannot exceed 50 characters.");

const roleSchema = z.enum(ASSIGNABLE_ROLES as unknown as [string, ...string[]], {
  message: "Choose a role.",
});

const genderSchema = z.enum(["MALE", "FEMALE", "OTHER"]).or(z.literal("")).optional();

const addressSchema = z
  .string()
  .trim()
  .max(255, "Address cannot exceed 255 characters.")
  .or(z.literal(""))
  .optional();

/**
 * Salary arrives from a number input as a string.
 *
 * An empty box means "not recorded", not zero — those are different facts, the
 * same distinction the workforce module draws for monthlyTarget. So the empty
 * string maps to undefined (key omitted) rather than 0.
 */
const salarySchema = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || (!Number.isNaN(Number(v)) && Number(v) >= 0), {
    message: "Salary cannot be negative.",
  });

/** Dates come from <input type="date"> as "" or "YYYY-MM-DD". */
const dateSchema = z.string().trim().optional();

// ─── Create ──────────────────────────────────────────────────────────────────

export const createUserSchema = z
  .object({
    firstName: firstNameSchema,
    lastName: lastNameSchema,
    email: emailSchema,
    phone: phoneSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm the password."),
    role: roleSchema,
    gender: genderSchema,
    address: addressSchema,
    salary: salarySchema,
    joiningDate: dateSchema,
    dateOfBirth: dateSchema,
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type CreateUserFormValues = z.infer<typeof createUserSchema>;

// ─── Edit ────────────────────────────────────────────────────────────────────
//
// Password is absent by design: this form never changes one. An owner resets a
// password through the dedicated dialog (which also revokes sessions), and a
// user changes their own from My Profile.

export const editUserSchema = z.object({
  firstName: firstNameSchema,
  lastName: lastNameSchema,
  email: emailSchema,
  phone: phoneSchema,
  gender: genderSchema,
  address: addressSchema,
  salary: salarySchema,
  joiningDate: dateSchema,
  dateOfBirth: dateSchema,
});

export type EditUserFormValues = z.infer<typeof editUserSchema>;

// ─── Owner-initiated password reset ──────────────────────────────────────────

export const resetPasswordSchema = z
  .object({
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm the password."),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;
