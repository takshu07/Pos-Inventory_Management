// =============================================================================
// PRESENCE HEARTBEAT
//
// PROBLEM:
//   The Workforce module derives "online" from an open session whose
//   lastSeenAt is recent. Keeping that fresh means touching the row as the
//   employee works — but doing it on EVERY authenticated request would add a
//   database write to the hot path, on a network-latency-bound (Neon) database,
//   purely for a presence dot in a monitoring UI. That trade is unacceptable.
//
// SOLUTION:
//   Throttle per employee in-process. The first request in each interval
//   schedules one fire-and-forget UPDATE; every other request in that window is
//   a memory lookup and does nothing. A cashier generating 200 requests in five
//   minutes produces ONE heartbeat write, not 200.
//
// CORRECTNESS:
//   The interval is deliberately shorter than the presence threshold the engine
//   uses to judge "online". If it were longer, an actively working employee
//   would flicker offline between beats. Staleness is bounded by the interval,
//   and being at most one interval behind is exactly the precision a presence
//   indicator needs.
//
//   Nothing here can fail a request: the write is fire-and-forget and its
//   rejection is logged, never propagated. Presence is observability.
// =============================================================================

import { logger } from "../config/logger";
import { workforceRepository } from "../repositories/workforce.repository";
import { PRESENCE_THRESHOLD_MINUTES } from "../engines/workforce.engine";

/**
 * How often a single employee's session row may be touched. Must stay below
 * PRESENCE_THRESHOLD_MINUTES or active users would appear to go offline
 * between heartbeats.
 */
const HEARTBEAT_INTERVAL_MS = Math.max(
  30_000,
  Math.floor((PRESENCE_THRESHOLD_MINUTES * 60_000) / 2)
);

/** employeeId → timestamp of the last heartbeat we issued. */
const lastBeat = new Map<string, number>();

/**
 * Records that this employee is active, at most once per interval.
 * Safe to call on every authenticated request.
 */
export function heartbeat(employeeId: string): void {
  const now = Date.now();
  const previous = lastBeat.get(employeeId);

  if (previous !== undefined && now - previous < HEARTBEAT_INTERVAL_MS) return;

  // Reserve the slot BEFORE awaiting, so a burst of concurrent requests cannot
  // each observe the stale timestamp and all fire a write.
  lastBeat.set(employeeId, now);

  workforceRepository.touchSession(employeeId).catch((err: unknown) => {
    logger.error({ err, employeeId }, "[PresenceHeartbeat] Failed to touch session");
  });
}

/** Drops an employee's throttle slot. Called on logout so the next login beats immediately. */
export function resetHeartbeat(employeeId: string): void {
  lastBeat.delete(employeeId);
}

/** Clears all throttle state. Used by tests. */
export function clearHeartbeats(): void {
  lastBeat.clear();
}
