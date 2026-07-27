// =============================================================================
// APP ERROR
// Custom error class that distinguishes operational errors (expected, safe to
// expose to the client) from programmer errors (bugs, should be hidden).
//
// isOperational = true  → we created this error intentionally (404, 401, etc.)
//                          → error middleware sends the message to the client
// isOperational = false → unexpected runtime error
//                          → error middleware sends a generic 500 message
// =============================================================================

import type { HttpStatusCode } from "../constants/httpStatus";

export class AppError extends Error {
  public readonly statusCode: HttpStatusCode;
  public readonly isOperational: boolean;
  /**
   * Optional machine-readable payload sent alongside the message for errors the
   * client must *act* on rather than merely display.
   *
   * Example: deleting a category that still holds products returns 409 with
   * `{ reason: "CATEGORY_NOT_EMPTY", productCount }`, which lets the UI open the
   * "move products first" dialog without a second round-trip. Must never carry
   * anything the caller is not already authorised to see.
   */
  public readonly details?: Record<string, unknown>;

  constructor(
    statusCode: HttpStatusCode,
    message: string,
    details?: Record<string, unknown>,
    isOperational: boolean = true
  ) {
    super(message);

    this.statusCode = statusCode;
    this.isOperational = isOperational;
    if (details !== undefined) this.details = details;

    // Maintains proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);

    // Captures the V8 stack trace, excluding the constructor frame
    Error.captureStackTrace(this, this.constructor);
  }
}