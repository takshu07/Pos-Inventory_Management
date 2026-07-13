// =============================================================================
// ROLE-BASED ACCESS CONTROL MIDDLEWARE
//
// Strategy: Minimum-role guard using the numeric hierarchy from constants/roles.
// This allows "at least MANAGER" checks without listing every qualifying role.
//
// Usage in routes:
//   router.delete('/employees/:id', authenticate, requireRole('OWNER'), ...)
//
// requireRole always comes AFTER authenticate — it depends on req.user being
// populated. TypeScript enforces this ordering via the middleware signature.
// =============================================================================

import type { NextFunction, Request, Response } from "express";

import { HTTP_STATUS } from "../constants/httpStatus";
import { hasMinimumRole, type Role } from "../constants/roles";
import { AppError } from "../errors/AppError";

/**
 * Returns an Express middleware that enforces a minimum role requirement.
 * The authenticated employee's role must be >= the required role in the
 * role hierarchy to proceed. Otherwise, a 403 Forbidden is returned.
 *
 * @param minimumRole - The minimum role required to access the route.
 */
export function requireRole(minimumRole: Role) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // req.user is guaranteed to exist at this point because requireRole
    // must always be placed after authenticate in the middleware chain.
    if (!hasMinimumRole(req.user.role, minimumRole)) {
      return next(
        new AppError(
          HTTP_STATUS.FORBIDDEN,
          `Access denied. This action requires ${minimumRole} privileges or higher.`
        )
      );
    }

    next();
  };
}

/**
 * Returns an Express middleware that restricts access to a specific set of
 * roles. Use this when you need exact role matching rather than hierarchy.
 *
 * Example: Only CASHIER can access the quick-sale shortcut endpoint.
 *
 * @param allowedRoles - The exact roles permitted to access the route.
 */
export function requireExactRole(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new AppError(
          HTTP_STATUS.FORBIDDEN,
          `Access denied. This action is restricted to: ${allowedRoles.join(", ")}.`
        )
      );
    }

    next();
  };
}
