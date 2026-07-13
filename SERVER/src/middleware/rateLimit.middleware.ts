// =============================================================================
// RATE LIMITING MIDDLEWARE
//
// Why express-rate-limit?
// - Lightweight, no Redis required for a POS at this scale
// - Keyed by IP address; works correctly behind proxies when trust proxy is set
//
// Two limiters are defined:
// 1. globalLimiter  — applied to ALL routes; coarse-grained DDoS protection
// 2. authLimiter    — applied ONLY to /login; strict brute-force protection
//
// Note on account lockout:
// Account lockout (e.g., "lock after 5 failed attempts") is a UX and security
// balance. For a POS used by known staff on a local network, IP-based rate
// limiting on /login is the correct level. A full lockout mechanism would
// require writing to the DB on every failed attempt — significant overhead for
// a non-public application.
// =============================================================================

import rateLimit from "express-rate-limit";

/**
 * Global rate limiter. Applied to the entire API as a baseline.
 * 200 requests per minute per IP.
 */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200,
  standardHeaders: "draft-7", // Return `RateLimit-*` headers
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests from this IP. Please try again later.",
  },
  skipSuccessfulRequests: false,
});

/**
 * Strict rate limiter for the login endpoint.
 * 10 attempts per 15 minutes per IP.
 * This is the primary brute-force defense for the authentication endpoint.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    message:
      "Too many login attempts from this IP. Please wait 15 minutes before trying again.",
  },
  // Count failed requests only — each successful login does not burn a slot
  skipSuccessfulRequests: true,
});
