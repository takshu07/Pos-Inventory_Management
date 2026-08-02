/**
 * Users & Roles — domain types.
 *
 * These mirror the `/employees` endpoints exactly (employee.controller +
 * employee.validation on the server), which is a DIFFERENT surface from the
 * workforce tree: `/employees` owns identity and the role hierarchy, while
 * `/owner/workforce` owns shift/attendance/performance. Users & Roles is an
 * ACCOUNT administration screen, so it reads and writes identity — see
 * ../api/usersApi.ts for why the two are kept apart.
 *
 * Hand-written rather than generated for the same reason as the workforce
 * types: the client is a separate package, so a server contract change should
 * surface as a compile error in one file instead of as `any` scattered around.
 */

import type { Role } from "@/types";

// =============================================================================
// ENUMS (mirror the Prisma enums the employee endpoints accept)
// =============================================================================

export type Gender = "MALE" | "FEMALE" | "OTHER";

/**
 * The roles an account can be CREATED as or MOVED to.
 *
 * OWNER is deliberately absent. The server's create/update schemas are
 * `z.enum(["MANAGER", "CASHIER"])` — the owner account is established once by
 * `/auth/setup` and ownership transfer is a separate process that does not
 * exist yet. Typing this narrowly means an attempt to offer "Owner" in a role
 * dropdown fails to compile rather than failing at runtime with a 400.
 */
export type AssignableRole = Extract<Role, "MANAGER" | "CASHIER">;

/** Runtime companion to AssignableRole, for building dropdowns. */
export const ASSIGNABLE_ROLES: readonly AssignableRole[] = ["MANAGER", "CASHIER"] as const;

// =============================================================================
// USER (an employee account, as the account-administration screen sees it)
// =============================================================================

/**
 * A row in the Users & Roles table.
 *
 * `salary` is optional because the list endpoint's shape depends on the actor;
 * this screen is OWNER-only so it will be present, but the type does not
 * promise what the transport cannot guarantee.
 */
export interface User {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  role: Role;
  isActive: boolean;
  gender: Gender | null;
  address: string | null;
  salary?: string | number | null;
  joiningDate: string;
  dateOfBirth: string | null;
  lastLogin: string | null;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// PAYLOADS
// =============================================================================

/** Body for POST /employees. Mirrors createEmployeeSchema. */
export interface CreateUserPayload {
  firstName: string;
  lastName: string;
  /** Optional server-side; an empty string is accepted and stored as null. */
  email?: string;
  phone: string;
  password: string;
  role: AssignableRole;
  gender?: Gender;
  address?: string;
  salary?: number;
  joiningDate?: string;
  dateOfBirth?: string;
}

/**
 * Body for PATCH /employees/:id. Mirrors updateEmployeeSchema.
 *
 * Password is absent by design — it is not updatable here. An owner resetting
 * someone's password uses the dedicated workforce endpoint (which also revokes
 * sessions); a user changing their own uses /auth/change-password.
 */
export interface UpdateUserPayload {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  role?: AssignableRole;
  gender?: Gender;
  address?: string;
  salary?: number;
  joiningDate?: string;
  dateOfBirth?: string;
  isActive?: boolean;
}

// =============================================================================
// QUERY PARAMS
// =============================================================================

/** Sort keys the server accepts. Anything else is rejected by its zod enum. */
export type UserSortBy = "createdAt" | "firstName" | "joiningDate" | "salary";

export interface UserListParams {
  page?: number;
  limit?: number;
  search?: string;
  role?: Role | "";
  isActive?: boolean | "";
  sortBy?: UserSortBy;
  sortOrder?: "asc" | "desc";
}

// =============================================================================
// SHARED RESPONSE ENVELOPE
// =============================================================================

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}
