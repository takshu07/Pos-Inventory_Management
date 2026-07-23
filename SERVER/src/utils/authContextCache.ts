// =============================================================================
// AUTH CONTEXT CACHE
//
// PROBLEM:
//   The authenticate middleware validates two things on EVERY protected request:
//     1. the employee still exists and isActive
//     2. the JWT's tokenVersion matches the employee's refreshTokenVersion
//   Both come from a single-row lookup (authRepository.findTokenVersion). That
//   is one database round-trip added to every single API call — on a remote
//   (Neon) database this is the dominant, unavoidable latency on the hot path
//   and it scales with request volume, not data size.
//
// SOLUTION:
//   Cache { refreshTokenVersion, isActive } per employeeId in-process with a
//   short TTL. Reads become O(1) memory lookups; the DB is only hit on a cache
//   miss (first request per employee per TTL window).
//
// CORRECTNESS:
//   Security-sensitive fields cannot go stale silently, so the cache is
//   *explicitly invalidated* the instant either field can change:
//     - password change / logout-all  -> refreshTokenVersion bumped
//     - account deactivation/reactivation -> isActive toggled
//   The TTL is only a safety net (bounds staleness if an invalidation path is
//   ever missed). A conservative default keeps the security window tiny.
//
// WHY NOT REDIS:
//   The stack is fixed (no Redis). A single POS server process serves one store;
//   an in-process map is correct and fastest here. If this ever scales to
//   multiple instances, swap this module's internals for Redis pub/sub
//   invalidation — the call sites do not change.
// =============================================================================

export interface AuthContext {
  refreshTokenVersion: number;
  isActive: boolean;
}

interface CacheEntry {
  value: AuthContext;
  expiresAt: number;
}

// Default 30s: short enough that a missed invalidation self-heals almost
// immediately, long enough to absorb the burst of requests a single cashier
// generates while operating the POS. Override via AUTH_CACHE_TTL_MS.
const TTL_MS = Number.parseInt(process.env["AUTH_CACHE_TTL_MS"] ?? "30000", 10);

const store = new Map<string, CacheEntry>();

/** Returns the cached context if present and unexpired, else null. */
export function getAuthContext(employeeId: string): AuthContext | null {
  const entry = store.get(employeeId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(employeeId);
    return null;
  }
  return entry.value;
}

/** Caches the context for an employee with the configured TTL. */
export function setAuthContext(employeeId: string, value: AuthContext): void {
  store.set(employeeId, { value, expiresAt: Date.now() + TTL_MS });
}

/**
 * Removes an employee's cached context. MUST be called whenever
 * refreshTokenVersion or isActive changes for that employee, so the next
 * request re-reads authoritative data from the database.
 */
export function invalidateAuthContext(employeeId: string): void {
  store.delete(employeeId);
}

/** Clears the entire cache. Used by tests. */
export function clearAuthContextCache(): void {
  store.clear();
}
