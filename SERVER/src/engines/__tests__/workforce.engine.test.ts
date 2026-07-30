// =============================================================================
// WORKFORCE ENGINE — unit tests for the enterprise upgrade additions
//
// These four areas are tested because each one is a number a human will act on:
// a performance score decides who gets promoted, a target percentage decides
// who gets a conversation, a severity decides what a manager investigates, and
// break minutes come off someone's paid hours.
//
// The weighting asserted here (40/30/15/15) is the business owner's explicit
// choice. If these tests fail after a weighting change, that is the point —
// the change must be deliberate.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  activitySeverity,
  closeBreak,
  openBreakMinutes,
  parseOperatingSystem,
  performanceScore,
  prorateMonthlyTarget,
  targetAchievement,
  PERFORMANCE_WEIGHTS,
} from "../workforce.engine";

// =============================================================================
// PERFORMANCE SCORE
// =============================================================================

describe("performanceScore", () => {
  it("awards a perfect 100 when every term is maxed", () => {
    const result = performanceScore({
      revenue: 100_000,
      target: 100_000,
      attendancePercentage: 100,
      returnRate: 0,
      discountRate: 0,
    });

    expect(result.score).toBe(100);
    expect(result.breakdown).toEqual({
      revenue: 40,
      attendance: 30,
      returns: 15,
      discount: 15,
    });
  });

  it("uses the agreed 40/30/15/15 weighting", () => {
    expect(PERFORMANCE_WEIGHTS).toEqual({
      revenue: 40,
      attendance: 30,
      returns: 15,
      discount: 15,
    });
  });

  it("scores each term proportionally", () => {
    // Half of target, 80% attendance, 20% returns, 10% discount.
    const result = performanceScore({
      revenue: 50_000,
      target: 100_000,
      attendancePercentage: 80,
      returnRate: 0.2,
      discountRate: 0.1,
    });

    // 40×0.5=20 · 30×0.8=24 · 15×0.8=12 · 15×0.9=13.5  →  69.5
    expect(result.breakdown).toEqual({
      revenue: 20,
      attendance: 24,
      returns: 12,
      discount: 13.5,
    });
    expect(result.score).toBe(69.5);
  });

  it("caps revenue attainment so one term cannot dominate the rest", () => {
    // 300% of target must score the same revenue term as exactly 100%.
    const over = performanceScore({
      revenue: 300_000,
      target: 100_000,
      attendancePercentage: 0,
      returnRate: 1,
      discountRate: 1,
    });

    expect(over.breakdown?.revenue).toBe(40);
    expect(over.score).toBe(40);
  });

  it("returns null — never zero — when no target is configured", () => {
    // This is the important one: an unconfigured employee must not be ranked
    // below a genuinely poor performer.
    const result = performanceScore({
      revenue: 250_000,
      target: null,
      attendancePercentage: 100,
      returnRate: 0,
      discountRate: 0,
    });

    expect(result.score).toBeNull();
    expect(result.breakdown).toBeNull();
    expect(result.unavailableReason).toBe("NO_TARGET");
  });

  it("treats a zero or negative target as unset rather than dividing by it", () => {
    expect(performanceScore({
      revenue: 1000, target: 0, attendancePercentage: 100, returnRate: 0, discountRate: 0,
    }).score).toBeNull();

    expect(performanceScore({
      revenue: 1000, target: -5, attendancePercentage: 100, returnRate: 0, discountRate: 0,
    }).score).toBeNull();
  });

  it("clamps out-of-range rates instead of producing a negative score", () => {
    const result = performanceScore({
      revenue: 0,
      target: 100_000,
      attendancePercentage: 0,
      // Dirty data: rates above 1 would otherwise drive terms negative.
      returnRate: 5,
      discountRate: 5,
    });

    expect(result.score).toBe(0);
    expect(result.breakdown?.returns).toBe(0);
    expect(result.breakdown?.discount).toBe(0);
  });
});

// =============================================================================
// TARGET PRO-RATING
// =============================================================================

describe("prorateMonthlyTarget", () => {
  it("scales a monthly target down to a one-week window", () => {
    const from = new Date("2026-07-01T00:00:00.000Z");
    const to = new Date("2026-07-08T00:00:00.000Z");

    // 30,000/month ÷ 30 days × 7 days = 7,000
    expect(prorateMonthlyTarget(30_000, from, to)).toBe(7_000);
  });

  it("returns the full target for a 30-day window", () => {
    const from = new Date("2026-07-01T00:00:00.000Z");
    const to = new Date("2026-07-31T00:00:00.000Z");

    expect(prorateMonthlyTarget(30_000, from, to)).toBe(30_000);
  });

  it("never returns a zero-day window", () => {
    const same = new Date("2026-07-01T00:00:00.000Z");
    // A single-day window must pro-rate to one day, not to nothing.
    expect(prorateMonthlyTarget(30_000, same, same)).toBe(1_000);
  });

  it("propagates an unset target as null", () => {
    const from = new Date("2026-07-01T00:00:00.000Z");
    const to = new Date("2026-07-08T00:00:00.000Z");

    expect(prorateMonthlyTarget(null, from, to)).toBeNull();
    expect(prorateMonthlyTarget(0, from, to)).toBeNull();
  });
});

describe("targetAchievement", () => {
  it("reports achievement as a percentage of the pro-rated target", () => {
    expect(targetAchievement(7_000, 10_000)).toBe(70);
    expect(targetAchievement(12_500, 10_000)).toBe(125);
  });

  it("returns null for an unset target so the UI can render 'Not set'", () => {
    // Rendering 0% here would read as total failure rather than as missing config.
    expect(targetAchievement(50_000, null)).toBeNull();
    expect(targetAchievement(50_000, 0)).toBeNull();
  });
});

// =============================================================================
// ACTIVITY SEVERITY
// =============================================================================

describe("activitySeverity", () => {
  it("flags the owner-designated critical actions", () => {
    expect(activitySeverity("DELETE", "PRODUCT")).toBe("CRITICAL");
    expect(activitySeverity("ROLE_CHANGED", "EMPLOYEE")).toBe("CRITICAL");
    expect(activitySeverity("PERMISSION_CHANGED", "EMPLOYEE")).toBe("CRITICAL");
    expect(activitySeverity("INVENTORY_ADJUST", "INVENTORY")).toBe("CRITICAL");
  });

  it("flags failed logins and forced logouts as critical", () => {
    expect(activitySeverity("LOGIN", "AUTH", { isFailedLogin: true })).toBe("CRITICAL");
    expect(activitySeverity("LOGOUT", "AUTH", { isForcedLogout: true })).toBe("CRITICAL");
  });

  it("flags refunds as critical", () => {
    expect(activitySeverity("SALE_COMPLETE", "SALE", { isRefund: true })).toBe("CRITICAL");
  });

  it("escalates a discount only once it crosses the threshold", () => {
    expect(activitySeverity("SALE_COMPLETE", "SALE", { discountRate: 0.3 })).toBe("CRITICAL");
    expect(activitySeverity("SALE_COMPLETE", "SALE", { discountRate: 0.25 })).toBe("CRITICAL");
    // Below the threshold it is notable but not an emergency.
    expect(activitySeverity("SALE_COMPLETE", "SALE", { discountRate: 0.1 })).toBe("WARNING");
  });

  it("leaves ordinary activity as normal", () => {
    expect(activitySeverity("LOGIN", "AUTH")).toBe("NORMAL");
    expect(activitySeverity("SALE_COMPLETE", "SALE")).toBe("NORMAL");
    expect(activitySeverity("CREATE", "CUSTOMER")).toBe("NORMAL");
  });

  it("does not require context to classify an action-level critical", () => {
    // Callers without sale context must still get the right answer.
    expect(activitySeverity("DELETE", "SALE")).toBe("CRITICAL");
  });
});

// =============================================================================
// BREAK TRACKING
// =============================================================================

describe("break tracking", () => {
  const start = new Date("2026-07-29T10:00:00.000Z");

  it("reports zero when no break is open", () => {
    expect(openBreakMinutes(null)).toBe(0);
    expect(openBreakMinutes(undefined)).toBe(0);
  });

  it("measures an open break from its start", () => {
    const now = new Date("2026-07-29T10:12:00.000Z");
    expect(openBreakMinutes(start, now)).toBe(12);
  });

  it("never reports negative minutes for a clock skew", () => {
    const before = new Date("2026-07-29T09:50:00.000Z");
    expect(openBreakMinutes(start, before)).toBe(0);
  });

  it("accumulates across multiple breaks in a day", () => {
    const end = new Date("2026-07-29T10:15:00.000Z");
    // 20 minutes already taken earlier, plus 15 now.
    expect(closeBreak({ accumulatedMinutes: 20, breakStartedAt: start, at: end })).toBe(35);
  });
});

// =============================================================================
// OS PARSING
// =============================================================================

describe("parseOperatingSystem", () => {
  it("identifies the common desktop and mobile platforms", () => {
    expect(parseOperatingSystem("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows");
    expect(parseOperatingSystem("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("macOS");
    expect(parseOperatingSystem("Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)")).toBe("ChromeOS");
  });

  it("resolves the overlapping cases in the right order", () => {
    // Android UAs also contain "Linux" — Android must win.
    expect(parseOperatingSystem("Mozilla/5.0 (Linux; Android 13; Pixel 7)")).toBe("Android");
    // iPad UAs contain "Mac OS X" — iOS must win.
    expect(parseOperatingSystem("Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)")).toBe("iOS");
    // Plain Linux still resolves once the above are excluded.
    expect(parseOperatingSystem("Mozilla/5.0 (X11; Linux x86_64)")).toBe("Linux");
  });

  it("returns null for a missing UA rather than guessing", () => {
    expect(parseOperatingSystem(null)).toBeNull();
    expect(parseOperatingSystem("")).toBeNull();
  });
});
