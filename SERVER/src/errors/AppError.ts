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

  constructor(
    statusCode: HttpStatusCode,
    message: string,
    isOperational: boolean = true
  ) {
    super(message);

    this.statusCode = statusCode;
    this.isOperational = isOperational;

    // Maintains proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);

    // Captures the V8 stack trace, excluding the constructor frame
    Error.captureStackTrace(this, this.constructor);
  }
}