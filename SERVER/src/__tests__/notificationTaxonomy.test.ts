/**
 * Notification taxonomy — category and severity derivation.
 *
 * Category and severity are DERIVED from `Notification.type`; there are no such
 * columns. That makes this file the contract:
 *
 *   1. EVERY type the server actually dispatches must be mapped. An unmapped
 *      type silently becomes SYSTEM/INFO — it still appears, but it lands in
 *      the wrong bucket and cannot be filtered for. The first test enumerates
 *      the real dispatch sites so adding an alert without mapping it FAILS.
 *
 *   2. The SYSTEM bucket is the complement of everything mapped, so its filter
 *      is `notIn` rather than `in`. Getting that backwards makes System
 *      notifications either invisible or the only visible ones.
 */

import { describe, expect, it } from "vitest";

import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_SEVERITIES,
  allMappedTypes,
  categoryForType,
  metaForType,
  severityForType,
  severityRank,
  typeFilterForCategories,
  typesForCategory,
} from "../constants/notificationTaxonomy";

/**
 * Every `type:` string passed to `NotificationEngine.dispatch` anywhere in the
 * server, as of 2026-08-03.
 *
 * Sources: services/inventoryAlerts.service.ts, services/workforceAlerts.service.ts,
 * events/subscribers/notification.subscriber.ts, services/workforce.service.ts.
 *
 * ⚠ Adding an alert type? Add it here AND to NOTIFICATION_TYPE_META. This list
 * is the thing that makes forgetting the second step a test failure.
 */
const DISPATCHED_TYPES = [
  "LOW_STOCK",
  "OUT_OF_STOCK",
  "NEGATIVE_STOCK",
  "ADJUSTMENT_REQUESTED",
  "LARGE_ADJUSTMENT",
  "DAMAGED_INVENTORY",
  "CYCLE_COUNT_COMPLETED",
  "PURCHASE_RECEIVED",
  "ATTENDANCE_LATE",
  "ATTENDANCE_ABSENT",
  "EMPLOYEE_IDLE",
  "HIGH_REFUND_RATE",
  "LARGE_DISCOUNT",
  "FAILED_LOGIN_ATTEMPTS",
  "INVENTORY_EDITED",
  "TOP_PERFORMER",
  "LARGE_SALE",
  "PASSWORD_RESET",
] as const;

describe("taxonomy coverage", () => {
  it("maps every type the server actually dispatches", () => {
    const mapped = allMappedTypes();
    const missing = DISPATCHED_TYPES.filter((t) => !mapped.includes(t));

    expect(missing).toEqual([]);
  });

  it("does not map types nothing dispatches", () => {
    // Not fatal, but a mapped-but-dead type means a filter chip that can never
    // match anything — worth catching while the list is still small.
    const extra = allMappedTypes().filter(
      (t) => !(DISPATCHED_TYPES as readonly string[]).includes(t)
    );

    expect(extra).toEqual([]);
  });

  it("assigns every mapped type a valid category and severity", () => {
    for (const type of allMappedTypes()) {
      expect(NOTIFICATION_CATEGORIES).toContain(categoryForType(type));
      expect(NOTIFICATION_SEVERITIES).toContain(severityForType(type));
    }
  });
});

describe("derivation", () => {
  it("files stock-out as inventory/critical", () => {
    // The single most urgent inventory state — if this drifts to WARNING it
    // stops standing out from a routine low-stock nudge.
    expect(categoryForType("OUT_OF_STOCK")).toBe("INVENTORY");
    expect(severityForType("OUT_OF_STOCK")).toBe("CRITICAL");
  });

  it("files failed logins as security/critical", () => {
    expect(categoryForType("FAILED_LOGIN_ATTEMPTS")).toBe("SECURITY");
    expect(severityForType("FAILED_LOGIN_ATTEMPTS")).toBe("CRITICAL");
  });

  it("falls back to SYSTEM/INFO for an unknown type", () => {
    // A type nobody registered is still a real event; hiding it would be worse
    // than filing it under System.
    expect(categoryForType("SOME_FUTURE_ALERT")).toBe("SYSTEM");
    expect(severityForType("SOME_FUTURE_ALERT")).toBe("INFO");
  });

  it("prettifies an unmapped type rather than showing the raw constant", () => {
    expect(metaForType("SOME_FUTURE_ALERT").label).toBe("Some future alert");
  });

  it("uses the registered label for a mapped type", () => {
    expect(metaForType("LOW_STOCK").label).toBe("Low stock");
  });
});

describe("severity ranking", () => {
  it("orders INFO < SUCCESS < WARNING < CRITICAL", () => {
    expect(severityRank("INFO")).toBeLessThan(severityRank("SUCCESS"));
    expect(severityRank("SUCCESS")).toBeLessThan(severityRank("WARNING"));
    expect(severityRank("WARNING")).toBeLessThan(severityRank("CRITICAL"));
  });

  /**
   * ⚠ THIS DIRECTION WAS A REAL BUG, caught by end-to-end verification.
   *
   * `NOTIFICATION_SEVERITIES` is ordered LEAST-severe-first, so `severityRank`
   * ascends with urgency and `rank(a) - rank(b)` sorts INFO first. "desc" —
   * most urgent first, and the only ordering anyone wants — therefore has to
   * NEGATE the comparator.
   *
   * The audit module looks identical but its `SEVERITY_LEVELS` is ordered
   * MOST-severe-first, so its multiplier is the opposite sign and correct.
   * Copying that code without checking the array order is exactly how this
   * shipped sorting critical alerts to the bottom of the page.
   */
  it("sorts most-urgent-first for 'desc' (the comparator direction)", () => {
    const rows = [
      { severity: "INFO" as const, createdAt: new Date("2026-08-03T10:00:00Z") },
      { severity: "CRITICAL" as const, createdAt: new Date("2026-08-03T09:00:00Z") },
      { severity: "WARNING" as const, createdAt: new Date("2026-08-03T08:00:00Z") },
    ];

    const direction = -1; // the "desc" multiplier used by the service
    const sorted = [...rows].sort((a, b) => {
      const delta = severityRank(a.severity) - severityRank(b.severity);
      if (delta !== 0) return delta * direction;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    expect(sorted.map((r) => r.severity)).toEqual([
      "CRITICAL",
      "WARNING",
      "INFO",
    ]);
  });

  it("sorts least-urgent-first for 'asc'", () => {
    const rows = [
      { severity: "CRITICAL" as const, createdAt: new Date("2026-08-03T09:00:00Z") },
      { severity: "INFO" as const, createdAt: new Date("2026-08-03T10:00:00Z") },
    ];

    const direction = 1; // the "asc" multiplier
    const sorted = [...rows].sort(
      (a, b) => (severityRank(a.severity) - severityRank(b.severity)) * direction
    );

    expect(sorted.map((r) => r.severity)).toEqual(["INFO", "CRITICAL"]);
  });
});

describe("category → type filter expansion", () => {
  it("returns null when nothing is selected", () => {
    // Empty selection means "everything", not "nothing" — returning a filter
    // here would make an unfiltered view show zero rows.
    expect(typeFilterForCategories([])).toBeNull();
  });

  it("expands a normal category to an IN list", () => {
    const filter = typeFilterForCategories(["INVENTORY"]);

    expect(filter).toHaveProperty("in");
    expect((filter as { in: string[] }).in).toContain("LOW_STOCK");
    expect((filter as { in: string[] }).in).not.toContain("LARGE_SALE");
  });

  it("expands SYSTEM to a NOT-IN over every mapped type", () => {
    // SYSTEM is the fallback bucket: it means "everything unmapped", which
    // cannot be written as an IN list.
    const filter = typeFilterForCategories(["SYSTEM"]);

    expect(filter).toHaveProperty("notIn");
    expect((filter as { notIn: string[] }).notIn).toEqual(allMappedTypes());
  });

  it("combines SYSTEM with a normal category as an OR", () => {
    // Neither an IN nor a NOT-IN alone can express "inventory types, or
    // anything unmapped".
    const filter = typeFilterForCategories(["INVENTORY", "SYSTEM"]);

    expect(filter).toHaveProperty("OR");
    expect((filter as { OR: unknown[] }).OR).toHaveLength(2);
  });

  it("puts each mapped type in exactly one category", () => {
    // Overlapping categories would double-count in the summary chips.
    const seen = new Map<string, string>();
    for (const category of NOTIFICATION_CATEGORIES) {
      for (const type of typesForCategory(category)) {
        expect(seen.has(type)).toBe(false);
        seen.set(type, category);
      }
    }
  });
});
