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
 * Rate limiter for report/export endpoints.
 *
 * Why these need their own limit
 * ------------------------------
 * Every other endpoint is bounded work: a page of rows, one sale, one product.
 * An export is not — it scans a full date range, joins across sales, items and
 * payments, and renders a PDF or CSV in memory. A handful of concurrent exports
 * can saturate both the Neon connection pool and this process's heap, which
 * takes down CHECKOUT along with them. The global limit of 200/min is far too
 * loose to prevent that: 200 exports a minute would be an outage.
 *
 * The threshold is deliberately generous relative to human use. A manager
 * clicking through report downloads might issue a few per minute; 30 per 5
 * minutes across an entire store leaves ordinary work untouched while stopping
 * a runaway loop or a scripted scrape. It is a stability guard, not a quota.
 *
 * NOTE ON SHARED IPs: all terminals in a store typically egress from ONE public
 * address, so this budget is shared by the whole store, not per user. That is
 * accounted for in the number above.
 */
export const exportLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    message:
      "Too many export requests. Please wait a few minutes before exporting again.",
  },
  // Failed exports still consumed the work, so they count too.
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
