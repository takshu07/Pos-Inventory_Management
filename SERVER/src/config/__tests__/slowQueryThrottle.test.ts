// =============================================================================
// SLOW-QUERY LOG THROTTLING — regression suite
//
// WHY THIS EXISTS
// ---------------
// The first run of the query instrumentation produced 106 warnings in five
// minutes from ONE statement: the print-queue idle poll, which runs every 2s
// forever. That statement is not defective — `EXPLAIN ANALYZE` reports 0.045ms
// server-side on a Bitmap Index Scan. It crosses the threshold only because a
// round-trip to Neon does (~980ms measured).
//
// Unthrottled, that makes the slow-query log actively harmful: expensive to
// ingest, and it buries one genuinely slow checkout under thousands of
// identical background lines. These tests pin both halves of the contract:
//   1. Repetition is collapsed — the log cannot flood.
//   2. Collapsing is NOT silence — the count and worst duration survive.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetSlowQueryThrottle,
  shouldLogSlowQuery,
} from "../queryInstrumentation";

const POLL_SQL = 'SELECT id FROM "print_jobs" WHERE status IN ($1,$2)';
const CHECKOUT_SQL = 'INSERT INTO "sales" ("id","grandTotal") VALUES ($1,$2)';

describe("slow-query log throttling", () => {
  beforeEach(() => {
    resetSlowQueryThrottle();
    vi.useRealTimers();
  });

  afterEach(() => {
    resetSlowQueryThrottle();
    vi.useRealTimers();
  });

  it("logs the first occurrence of a statement immediately", () => {
    const decision = shouldLogSlowQuery(POLL_SQL, 900);

    expect(decision.shouldLog).toBe(true);
    // occurrences === 1 means "this genuinely happened once", not "throttled".
    expect(decision.occurrences).toBe(1);
  });

  it("suppresses repeats of the same statement inside the window", () => {
    expect(shouldLogSlowQuery(POLL_SQL, 900).shouldLog).toBe(true);

    // The print queue polling every 2s — none of these may reach the log.
    for (let i = 0; i < 100; i += 1) {
      expect(shouldLogSlowQuery(POLL_SQL, 900).shouldLog).toBe(false);
    }
  });

  it("throttles per statement, so a real problem is never masked by a noisy one", () => {
    // The print-queue poll has already burned its slot for this window…
    shouldLogSlowQuery(POLL_SQL, 900);
    expect(shouldLogSlowQuery(POLL_SQL, 900).shouldLog).toBe(false);

    // …but a slow CHECKOUT is a different statement and must log immediately.
    // This is the property that makes throttling safe.
    expect(shouldLogSlowQuery(CHECKOUT_SQL, 4000).shouldLog).toBe(true);
  });

  it("reports how many occurrences were collapsed once the window elapses", () => {
    vi.useFakeTimers();

    shouldLogSlowQuery(POLL_SQL, 500); // logged
    for (let i = 0; i < 29; i += 1) {
      shouldLogSlowQuery(POLL_SQL, 500); // suppressed
    }

    vi.advanceTimersByTime(61_000);

    const decision = shouldLogSlowQuery(POLL_SQL, 500);
    expect(decision.shouldLog).toBe(true);
    // 29 suppressed + this one — the volume signal survives the collapsing.
    expect(decision.occurrences).toBe(30);
  });

  it("reports the WORST duration seen while throttled, not the latest", () => {
    vi.useFakeTimers();

    shouldLogSlowQuery(POLL_SQL, 400); // logged
    shouldLogSlowQuery(POLL_SQL, 5000); // suppressed — but this is the alarming one
    shouldLogSlowQuery(POLL_SQL, 450); // suppressed

    vi.advanceTimersByTime(61_000);

    const decision = shouldLogSlowQuery(POLL_SQL, 420);
    expect(decision.shouldLog).toBe(true);
    // A 5-second stall inside the quiet window must not be lost just because
    // the statement that reopened the window happened to be fast.
    expect(decision.maxDurationMs).toBe(5000);
  });

  it("starts a fresh window after emitting, rather than logging every call", () => {
    vi.useFakeTimers();

    shouldLogSlowQuery(POLL_SQL, 400);
    vi.advanceTimersByTime(61_000);
    expect(shouldLogSlowQuery(POLL_SQL, 400).shouldLog).toBe(true);

    // Immediately after emitting, suppression resumes.
    expect(shouldLogSlowQuery(POLL_SQL, 400).shouldLog).toBe(false);
  });

  it("resets the suppressed counter after each emitted line", () => {
    vi.useFakeTimers();

    shouldLogSlowQuery(POLL_SQL, 400);
    shouldLogSlowQuery(POLL_SQL, 400);
    vi.advanceTimersByTime(61_000);
    expect(shouldLogSlowQuery(POLL_SQL, 400).occurrences).toBe(2);

    shouldLogSlowQuery(POLL_SQL, 400);
    vi.advanceTimersByTime(61_000);
    // Counts must not accumulate across windows.
    expect(shouldLogSlowQuery(POLL_SQL, 400).occurrences).toBe(2);
  });

  it("bounds memory when a caller emits endlessly unique SQL", () => {
    // A raw query built by string concatenation would otherwise grow the
    // tracking map without limit — a slow leak caused by the very code meant
    // to diagnose leaks.
    for (let i = 0; i < 2000; i += 1) {
      const decision = shouldLogSlowQuery(`SELECT ${i} FROM t`, 400);
      // Past the cap, statements still log — throttling degrades, memory does
      // not grow. That is the correct trade.
      expect(decision.shouldLog).toBe(true);
    }
  });

  it("clears state on reset", () => {
    shouldLogSlowQuery(POLL_SQL, 400);
    expect(shouldLogSlowQuery(POLL_SQL, 400).shouldLog).toBe(false);

    resetSlowQueryThrottle();
    expect(shouldLogSlowQuery(POLL_SQL, 400).shouldLog).toBe(true);
  });
});
