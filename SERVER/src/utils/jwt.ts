// =============================================================================
// JWT UTILITIES
//
// Token Strategy: Single access token with embedded tokenVersion
// ---------------------------------------------------------------
// We embed `tokenVersion` (the employee's `refreshTokenVersion` from the DB)
// directly into the JWT payload. This enables server-side invalidation without
// a token store (e.g., Redis or a DB token table).
//
// How invalidation works:
//   1. Employee changes password → service increments `refreshTokenVersion`
//   2. Old tokens still verify cryptographically (correct secret, not expired)
//   3. But their embedded `tokenVersion` is now stale relative to the DB value
//   4. The `authenticate` middleware fetches the current version from DB and
//      rejects any token where payload.tokenVersion !== employee.refreshTokenVersion
//
// Trade-off:
//   - Pro: No token table, no Redis dependency, stateless verification
//   - Con: One DB lookup per authenticated request (acceptable at POS scale)
//   - Con: Tokens are not invalidated *immediately* — only when the DB check
//          runs. Since all routes are authenticated, this is immediate in practice.
//
// JWT_SECRET startup validation:
//   The validateEnvironment() call in server.ts ensures JWT_SECRET is set
//   before this module is even imported in a request context. The non-null
//   assertion is safe because the server refuses to start without it.
// =============================================================================

import jwt, { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";

import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import type { Role } from "../constants/roles";

const JWT_SECRET = process.env["JWT_SECRET"] as string;

/**
 * How long an access token remains valid.
 * Kept at 7 days for a single-store POS where session management UX matters.
 * For multi-tenant SaaS, prefer 15m access + 7d refresh tokens.
 */
const ACCESS_TOKEN_EXPIRES_IN = "7d" as const;

// =============================================================================
// PAYLOAD INTERFACE
// =============================================================================

export interface JwtPayload {
  /** Employee's primary key (cuid) */
  id: string;
  /** Employee's current role */
  role: Role;
  /**
   * Mirrors Employee.refreshTokenVersion at the time of token issuance.
   * If this diverges from the DB value, the token is considered revoked.
   */
  tokenVersion: number;
}

// =============================================================================
// TOKEN GENERATION
// =============================================================================

/**
 * Signs a new access token with the provided payload.
 * Must only be called after verifying the employee's credentials.
 */
export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  });
}

// =============================================================================
// TOKEN VERIFICATION
// =============================================================================

/**
 * Verifies the token's signature and expiry, then returns the decoded payload.
 * Throws AppError for all invalid token conditions so callers never need to
 * handle raw JWT errors.
 */
export function verifyToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Token has expired. Please log in again.");
    }

    if (error instanceof JsonWebTokenError) {
      throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Invalid token. Please log in again.");
    }

    // Re-throw unexpected errors (e.g., algorithm mismatch) as non-operational
    throw error;
  }
}