// =============================================================================
// GLOBAL ERROR HANDLER
//
// Express's 4-argument error handler. It must be registered LAST in app.ts,
// after all routes and other middleware.
//
// Error classification:
//   ZodError        → 400 with structured field-level errors (validation)
//   AppError        → statusCode from the error (operational error)
//   Prisma P2002    → 409 Conflict (unique constraint violation)
//   Prisma P2025    → 404 Not Found (record not found for update/delete)
//   Prisma P2003    → 409 Conflict (foreign key constraint violation)
//   Prisma P2014    → 409 Conflict (relation violation)
//   Everything else → 500 Internal Server Error (programmer error)
//
// Stack traces:
//   Only logged in development. Never sent to the client.
//   In production, only the message is returned for operational errors.
//   Programmer errors always return "Internal Server Error" regardless.
// =============================================================================

import type { NextFunction, Request, Response } from "express";

import { ZodError } from "zod";

import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import { logger } from "../config/logger";

// Prisma error codes we want to handle gracefully.
// We use a discriminated union check rather than importing PrismaClientKnownRequestError
// to avoid coupling the error layer to the Prisma version.
interface PrismaErrorLike {
  code: string;
  meta?: { target?: string[] };
}

function isPrismaKnownError(error: unknown): error is PrismaErrorLike {
  if (typeof error !== "object" || error === null) return false;
  const errorRecord = error as Record<string, unknown>;
  return (
    "code" in errorRecord &&
    typeof errorRecord["code"] === "string" &&
    errorRecord["code"].startsWith("P")
  );
}

const PRISMA_CONFLICT_CODES = new Set(["P2002", "P2003", "P2014"]);
const PRISMA_NOT_FOUND_CODE = "P2025";

// =============================================================================
// HANDLER
// =============================================================================

export function errorHandler(
  error: Error,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  const isDevelopment = process.env["NODE_ENV"] === "development";

  // --- Zod Validation Error ---
  if (error instanceof ZodError) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      message: "Validation failed.",
      errors: error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  // --- Operational AppError ---
  if (error instanceof AppError && error.isOperational) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
    });
    return;
  }

  // --- Prisma Known Request Errors ---
  if (isPrismaKnownError(error)) {
    if (PRISMA_CONFLICT_CODES.has(error.code)) {
      const target = error.meta?.target?.join(", ") ?? "field";
      res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        message: `A record with the same ${target} already exists.`,
      });
      return;
    }

    if (error.code === PRISMA_NOT_FOUND_CODE) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: "The requested record was not found.",
      });
      return;
    }
  }

  // --- Programmer / Unknown Error ---
  // Log the full error in development; in production, log to your observability
  // platform (e.g., Sentry, Datadog) instead of stdout.
  if (isDevelopment) {
    logger.error({ err: error }, "[ErrorHandler] Unhandled error");
  } else {
    logger.error({ message: error?.message }, "[ErrorHandler] Unhandled error");
  }

  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    message: "An unexpected error occurred. Please try again later.",
    ...(isDevelopment && { stack: error?.stack }),
  });
}