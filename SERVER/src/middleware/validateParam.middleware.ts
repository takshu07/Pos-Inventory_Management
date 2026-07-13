// =============================================================================
// VALIDATE PARAMS MIDDLEWARE
// Validates route parameters (e.g., :id) using Zod schemas.
//
// Why validate params?
// An invalid cuid passed to Prisma doesn't throw a ZodError — it throws
// a Prisma P2025 "record not found" or P2016 query interpretation error.
// Validating at the HTTP boundary gives a clean 400 before the DB is hit.
// =============================================================================

import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

import { AppError } from "../errors/AppError";
import { HTTP_STATUS } from "../constants/httpStatus";

/**
 * Cuid v2 pattern: starts with 'c', followed by 24 lowercase alphanumeric chars.
 * This matches what Prisma generates with @default(cuid()).
 */
const cuidSchema = z
  .string()
  .regex(/^c[a-z0-9]{24}$/, "Invalid ID format.");

/**
 * Middleware factory that validates a single named route parameter.
 *
 * Usage:
 *   router.get("/:id", validateParam("id"), controller.getById)
 */
export function validateParam(paramName: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const value = req.params[paramName];

    const result = cuidSchema.safeParse(value);

    if (!result.success) {
      return next(
        new AppError(
          HTTP_STATUS.BAD_REQUEST,
          `Invalid route parameter '${paramName}': ${result.error.issues[0]?.message ?? "Invalid format."}`
        )
      );
    }

    next();
  };
}
