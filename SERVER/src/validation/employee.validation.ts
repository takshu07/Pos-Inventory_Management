// =============================================================================
// EMPLOYEE VALIDATION SCHEMAS
// Handles both request body validation (create/update) and query parameter
// validation (list/search).
// =============================================================================

import { z } from "zod";

// =============================================================================
// REUSABLE FIELD SCHEMAS
// =============================================================================

const phoneSchema = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, "Phone must be a valid 10-digit Indian mobile number");

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(100, "Password cannot exceed 100 characters")
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    "Password must contain at least one uppercase letter, one lowercase letter, and one number"
  );

// =============================================================================
// CREATE SCHEMA
// =============================================================================

const createEmployeeSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(2, "First name must be at least 2 characters")
    .max(50),
  lastName: z
    .string()
    .trim()
    .min(1, "Last name is required")
    .max(50),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Invalid email address")
    .optional()
    .or(z.literal("")), // Accept empty string as undefined/optional
  phone: phoneSchema,
  password: passwordSchema,
  // Using z.enum based on the Prisma schema enums. 
  // We exclude OWNER because only one owner is created during initial setup.
  role: z.enum(["MANAGER", "CASHIER"]),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  address: z.string().trim().max(255).optional(),
  salary: z.coerce.number().min(0, "Salary cannot be negative").optional(),
  joiningDate: z.coerce.date().optional(), // Coerce string to Date object
  dateOfBirth: z.coerce.date().optional(),
});

// =============================================================================
// UPDATE SCHEMA
// All fields are optional. Passwords cannot be updated here (separate endpoint).
// =============================================================================

const updateEmployeeSchema = z.object({
  firstName: z.string().trim().min(2).max(50).optional(),
  lastName: z.string().trim().min(1).max(50).optional(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Invalid email address")
    .optional()
    .or(z.literal("")),
  phone: phoneSchema.optional(),
  role: z.enum(["MANAGER", "CASHIER"]).optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  address: z.string().trim().max(255).optional(),
  salary: z.coerce.number().min(0).optional(),
  joiningDate: z.coerce.date().optional(),
  dateOfBirth: z.coerce.date().optional(),
  isActive: z.boolean().optional(),
});

// =============================================================================
// LIST QUERY SCHEMA
// Handles pagination, sorting, and filtering via query string.
// Note: Query strings are always strings, so we must coerce numbers/booleans.
// =============================================================================

const listEmployeesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().optional(),
  role: z.enum(["OWNER", "MANAGER", "CASHIER"]).optional(),
  isActive: z
    .union([z.literal("true"), z.literal("false")])
    .transform((val) => val === "true")
    .optional(),
  sortBy: z
    .enum(["createdAt", "firstName", "joiningDate", "salary"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// =============================================================================
// EXPORTS
// =============================================================================

export const employeeValidation = {
  create: createEmployeeSchema,
  update: updateEmployeeSchema,
  listQuery: listEmployeesQuerySchema,
} as const;

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type ListEmployeesQuery = z.infer<typeof listEmployeesQuerySchema>;
