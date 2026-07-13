// =============================================================================
// EMPLOYEE TYPES
// Aligned precisely with the Prisma schema's EmployeeRole enum.
// We deliberately do NOT import Prisma-generated types directly into the
// application domain — this decouples the domain model from the ORM.
//
// If Prisma is ever replaced, only the repository layer changes.
// The service, controller, and type layers remain untouched.
// =============================================================================

import type { Role } from "../constants/roles";

/**
 * The authenticated user context attached to every incoming request by the
 * authentication middleware. This is NOT the full employee record — it
 * contains only what is needed for authorization decisions.
 */
export interface AuthenticatedUser {
  id: string;
  role: Role;
  tokenVersion: number;
}

/**
 * The public-facing employee profile returned by /auth/me and similar
 * endpoints. Never includes password or other sensitive fields.
 */
export interface EmployeeProfile {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  role: Role;
  gender: string | null;
  address: string | null;
  joiningDate: Date;
  isActive: boolean;
  lastLogin: Date | null;
}