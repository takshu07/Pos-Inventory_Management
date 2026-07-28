// =============================================================================
// AUTHENTICATION MIDDLEWARE
// Verifies the JWT on every protected route.
//
// Validation sequence (fail-fast):
//   1. Authorization header present and well-formed (Bearer <token>)
//   2. Token cryptographically valid and not expired (handled by verifyToken)
//   3. Employee exists and is currently active (DB lookup)
//   4. Token version matches the employee's current refreshTokenVersion
//      (detects post-password-change stale tokens)
//
// The DB check on step 3-4 adds one round-trip per request. This is
// acceptable at POS scale. For higher throughput, cache the version in Redis
// with a short TTL (e.g., 30s) to reduce DB pressure.
// =============================================================================

import type { NextFunction, Request, Response } from "express";

import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import { authRepository } from "../repositories/auth.repository";
import { verifyToken } from "../utils/jwt";
import {
  getAuthContext,
  setAuthContext,
} from "../utils/authContextCache";

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return next(
      new AppError(HTTP_STATUS.UNAUTHORIZED, "Authorization header is missing.")
    );
  }

  const parts = authHeader.split(" ");

  if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
    return next(
      new AppError(
        HTTP_STATUS.UNAUTHORIZED,
        "Invalid authorization format. Expected: Bearer <token>"
      )
    );
  }

  const token = parts[1];

  // Step 2: Cryptographic verification (synchronous — no DB needed)
  let payload: ReturnType<typeof verifyToken>;

  try {
    payload = verifyToken(token);
  } catch (error) {
    return next(error);
  }

  // Step 3 & 4: Active status + token version.
  // Served from an in-process cache to avoid a DB round-trip on every request.
  // On a miss we read the authoritative row and populate the cache. The cache
  // is explicitly invalidated on password change / (de)activation, so a hit is
  // as safe as the DB read it replaces (bounded further by a short TTL).
  let employeeRecord = getAuthContext(payload.id);

  if (!employeeRecord) {
    const fresh = await authRepository.findTokenVersion(payload.id);

    if (!fresh) {
      return next(
        new AppError(
          HTTP_STATUS.UNAUTHORIZED,
          "Account no longer exists. Please contact your manager."
        )
      );
    }

    setAuthContext(payload.id, fresh);
    employeeRecord = fresh;
  }

  if (!employeeRecord.isActive) {
    return next(
      new AppError(
        HTTP_STATUS.FORBIDDEN,
        "Your account has been deactivated. Please contact your manager."
      )
    );
  }

  if (payload.tokenVersion !== employeeRecord.refreshTokenVersion) {
    return next(
      new AppError(
        HTTP_STATUS.UNAUTHORIZED,
        "Session is no longer valid. Please log in again."
      )
    );
  }

  // Attach the user context to the request for downstream handlers
  req.user = {
    id: payload.id,
    role: payload.role,
    tokenVersion: payload.tokenVersion,
  };

  next();
}

/**
 * optionalAuthenticate — populates `req.user` when a valid token is present,
 * but does NOT reject the request when one is absent.
 *
 * This exists for resources the browser fetches WITHOUT our API client: an
 * `<img src="/api/v1/assets/…">` is a plain GET issued by the browser, which
 * cannot attach an Authorization header (our JWT lives in memory, not a
 * cookie). Under `authenticate` every such request is a guaranteed 401.
 *
 * IMPORTANT: this middleware authenticates, it does not authorize. It is only
 * safe on a handler that performs its own per-resource access check — the asset
 * download path does exactly that, serving PUBLIC assets to anyone and still
 * requiring an identified requester for PRIVATE ones. A malformed or expired
 * token is treated as "no token" rather than an error, so a stale session
 * degrades to public access instead of a broken image.
 */
export async function optionalAuthenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.headers.authorization) return next();

  // Delegate to the real implementation so token verification, the active-user
  // check and the token-version check are never duplicated here. We swallow its
  // rejection and continue anonymously.
  await authenticate(req, res, (err?: unknown) => {
    if (err) delete (req as { user?: unknown }).user;
    next();
  });
}
