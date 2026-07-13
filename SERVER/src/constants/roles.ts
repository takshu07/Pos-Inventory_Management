// =============================================================================
// EMPLOYEE ROLES
// Mirrors the EmployeeRole enum in schema.prisma exactly.
// Using a const object + derived union type gives us:
//   1. Runtime values for comparisons in middleware
//   2. Compile-time type safety without importing Prisma enums into every file
// =============================================================================

export const ROLES = {
  OWNER: "OWNER",
  MANAGER: "MANAGER",
  CASHIER: "CASHIER",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

// =============================================================================
// ROLE HIERARCHY
// Defines numeric privilege levels. Higher = more privileged.
// Used by role middleware to implement "at least X level" guards.
// =============================================================================

export const ROLE_HIERARCHY: Record<Role, number> = {
  OWNER: 100,
  MANAGER: 50,
  CASHIER: 10,
};

/**
 * Returns true if `userRole` has at least the same privilege level as
 * `requiredRole`. Use this for "minimum role" checks rather than exact matches.
 */
export function hasMinimumRole(userRole: Role, requiredRole: Role): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}
