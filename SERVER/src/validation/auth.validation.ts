// =============================================================================
// AUTH VALIDATION SCHEMAS
// All validation is done at the controller boundary using Zod.
// The parsed output types are re-exported so services receive strongly-typed
// inputs without re-parsing.
// =============================================================================

import { z } from "zod";

// =============================================================================
// REUSABLE FIELD SCHEMAS
// Defined once, referenced in multiple schemas to avoid drift between
// setup and login password rules.
// =============================================================================

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(100, "Password cannot exceed 100 characters")
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    "Password must contain at least one uppercase letter, one lowercase letter, and one number"
  );

const phoneSchema = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, "Phone must be a valid 10-digit Indian mobile number");

// =============================================================================
// SETUP SCHEMA
// One-time admin setup. Requires phone (mandatory for Indian garments POS)
// and email (optional for initial owner creation).
// =============================================================================

const setupSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(2, "First name must be at least 2 characters")
    .max(50, "First name cannot exceed 50 characters"),

  lastName: z
    .string()
    .trim()
    .min(1, "Last name must be at least 1 character")
    .max(50, "Last name cannot exceed 50 characters"),

  phone: phoneSchema,

  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Invalid email address")
    .optional(),

  password: passwordSchema,

  shopName: z
    .string()
    .trim()
    .min(2, "Shop name must be at least 2 characters")
    .max(100, "Shop name cannot exceed 100 characters"),
});

// =============================================================================
// LOGIN SCHEMA
// Supports both email and phone login.
// Exactly one of email or phone must be provided.
// =============================================================================

const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("Invalid email address")
      .optional(),

    phone: phoneSchema.optional(),

    password: z.string().min(1, "Password is required"),
  })
  .refine((data) => data.email !== undefined || data.phone !== undefined, {
    message: "Either email or phone is required to log in",
    path: ["email"],
  });

// =============================================================================
// CHANGE PASSWORD SCHEMA
// Requires current password for verification before allowing change.
// New password must differ from current password (enforced in service).
// =============================================================================

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),

    newPassword: passwordSchema,

    confirmPassword: z.string().min(1, "Confirm password is required"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

// =============================================================================
// EXPORTS
// =============================================================================

export const authValidation = {
  setup: setupSchema,
  login: loginSchema,
  changePassword: changePasswordSchema,
} as const;

export type SetupInput = z.infer<typeof setupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;