// =============================================================================
// AUDIT ENGINE — regression tests
//
// The Audit Logs module derives two things the database does not store —
// severity and the field-level diff — and both have failure modes that look
// fine in a screenshot and are wrong as evidence. These lock down the cases
// where a plausible implementation silently misleads the reader:
//
//   • Severity must cover EVERY action in the Prisma enum. An action nobody
//     classified must fall back to MEDIUM and stay VISIBLE, not vanish into a
//     level the default filter hides.
//   • The severity→actions inversion must round-trip exactly. It is what makes
//     a derived filter run as an indexed `action IN (...)`; if it drops an
//     action, the filter quietly returns fewer rows than the badge count claims.
//   • The validation enums must match the generated Prisma enums, or a filter
//     400s on a value the database legitimately contains.
//   • The diff must report only REAL changes, must not be fooled by key order,
//     and must never render a credential.
//   • Period ranges must be half-open, or every window leaks a row from the
//     next one.
//
// Pure functions only — no database.
// =============================================================================

import { describe, expect, it } from "vitest";

import { ActionModule, ActionType } from "../../../generated/prisma";
import {
  actionLabel,
  diffSnapshots,
  entityLabel,
  moduleLabel,
  resolvePeriod,
  severityForAction,
  severityRank,
  severityToActions,
  DEFAULT_SEVERITY,
  SEVERITY_LEVELS,
  type AuditSeverity,
} from "../audit.engine";
import { AUDIT_ACTIONS, AUDIT_MODULES } from "../../validation/audit.validation";

const ALL_ACTIONS = Object.values(ActionType) as ActionType[];
const ALL_MODULES = Object.values(ActionModule) as ActionModule[];

// =============================================================================
// SEVERITY POLICY
// =============================================================================

describe("severityForAction", () => {
  it("classifies every action in the Prisma enum", () => {
    for (const action of ALL_ACTIONS) {
      expect(SEVERITY_LEVELS).toContain(severityForAction(action));
    }
  });

  it("treats irreversible and privilege actions as CRITICAL", () => {
    // These are the ones an owner opens the screen to find.
    expect(severityForAction(ActionType.DELETE)).toBe("CRITICAL");
    expect(severityForAction(ActionType.ROLE_CHANGED)).toBe("CRITICAL");
    expect(severityForAction(ActionType.PASSWORD_RESET)).toBe("CRITICAL");
    expect(severityForAction(ActionType.PERMISSION_CHANGED)).toBe("CRITICAL");
    // Money leaving the business.
    expect(severityForAction(ActionType.CASH_PAYOUT_RECORDED)).toBe("CRITICAL");
    expect(severityForAction(ActionType.SALARY_PAID)).toBe("CRITICAL");
    // Data leaving the business.
    expect(severityForAction(ActionType.REPORT_EXPORTED)).toBe("CRITICAL");
  });

  it("keeps routine high-volume actions at LOW so they can be filtered out", () => {
    expect(severityForAction(ActionType.LOGIN)).toBe("LOW");
    expect(severityForAction(ActionType.LOGOUT)).toBe("LOW");
    expect(severityForAction(ActionType.CLOCK_IN)).toBe("LOW");
    expect(severityForAction(ActionType.LABEL_PREVIEW_GENERATED)).toBe("LOW");
  });

  it("does not rank an ordinary UPDATE above a DELETE", () => {
    // Guards against a future edit that flattens the policy into one level.
    expect(severityRank(severityForAction(ActionType.DELETE))).toBeLessThan(
      severityRank(severityForAction(ActionType.UPDATE))
    );
  });

  it("falls back to MEDIUM — visible, not hidden — for an unclassified action", () => {
    // An action added to the schema but not to the policy must still surface.
    // MEDIUM is deliberate: LOW would bury a brand-new, unreviewed event type.
    const unknown = "SOME_FUTURE_ACTION" as ActionType;
    expect(severityForAction(unknown)).toBe(DEFAULT_SEVERITY);
    expect(DEFAULT_SEVERITY).toBe("MEDIUM");
  });
});

describe("severityRank", () => {
  it("orders CRITICAL first and LOW last", () => {
    expect(severityRank("CRITICAL")).toBe(0);
    expect(severityRank("LOW")).toBe(SEVERITY_LEVELS.length - 1);
  });
});

// =============================================================================
// THE INVERSION — what keeps a derived filter indexed
// =============================================================================

describe("severityToActions", () => {
  it("round-trips: every action maps back to exactly its own severity", () => {
    // If this fails, a severity filter returns a different set of rows than the
    // one the list itself labels with that severity.
    for (const level of SEVERITY_LEVELS) {
      for (const action of severityToActions(level, ALL_ACTIONS)) {
        expect(severityForAction(action)).toBe(level);
      }
    }
  });

  it("partitions the action enum with no gaps and no overlaps", () => {
    const seen = new Set<ActionType>();
    let total = 0;

    for (const level of SEVERITY_LEVELS) {
      const actions = severityToActions(level, ALL_ACTIONS);
      total += actions.length;
      for (const action of actions) seen.add(action);
    }

    // No action missing (a gap would make it unreachable by any severity
    // filter) and none counted twice (an overlap would duplicate rows).
    expect(seen.size).toBe(ALL_ACTIONS.length);
    expect(total).toBe(ALL_ACTIONS.length);
  });

  it("includes unclassified actions in the MEDIUM set", () => {
    // The fallback and the inversion must agree, or a MEDIUM filter would drop
    // rows the list displays as MEDIUM.
    const unknown = "SOME_FUTURE_ACTION" as ActionType;
    const medium = severityToActions("MEDIUM", [...ALL_ACTIONS, unknown]);
    expect(medium).toContain(unknown);
  });

  it("returns an empty set for a severity no action maps to", () => {
    const orphan = "NONEXISTENT" as AuditSeverity;
    expect(severityToActions(orphan, ALL_ACTIONS)).toEqual([]);
  });
});

// =============================================================================
// ENUM SYNC — the validation lists must match the schema
// =============================================================================

describe("validation enums stay in sync with Prisma", () => {
  it("AUDIT_ACTIONS matches the ActionType enum exactly", () => {
    // Drift here means the API rejects a filter value the database contains,
    // or advertises one it never will.
    expect([...AUDIT_ACTIONS].sort()).toEqual([...ALL_ACTIONS].sort());
  });

  it("AUDIT_MODULES matches the ActionModule enum exactly", () => {
    expect([...AUDIT_MODULES].sort()).toEqual([...ALL_MODULES].sort());
  });
});

// =============================================================================
// LABELS
// =============================================================================

describe("labels", () => {
  it("maps mapped table names to business language", () => {
    expect(entityLabel("product_variants")).toBe("Product Variant");
    expect(entityLabel("cash_transactions")).toBe("Cash Transaction");
  });

  it("humanises an unknown table instead of leaking the raw name", () => {
    expect(entityLabel("future_widget_things")).toBe("Future Widget Things");
  });

  it("title-cases actions and modules", () => {
    expect(actionLabel(ActionType.ROLE_CHANGED)).toBe("Role Changed");
    expect(actionLabel(ActionType.CREATE)).toBe("Create");
    expect(moduleLabel(ActionModule.CASH_REGISTER)).toBe("Cash Register");
  });
});

// =============================================================================
// DIFF
// =============================================================================

describe("diffSnapshots", () => {
  it("reports only fields that actually changed", () => {
    // An UPDATE snapshots the whole record on both sides. Showing every field
    // would bury the one the reader opened the entry to see.
    const changes = diffSnapshots(
      { name: "Widget", price: 100, sku: "W-1" },
      { name: "Widget", price: 150, sku: "W-1" }
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      field: "price",
      oldValue: 100,
      newValue: 150,
      changeType: "changed",
    });
  });

  it("is not fooled by key order", () => {
    // Postgres json round-trips do not preserve key order; a JSON.stringify
    // comparison would report a change here that never happened.
    expect(diffSnapshots({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual([]);
  });

  it("compares nested structures deeply", () => {
    expect(
      diffSnapshots({ meta: { tags: ["x", "y"] } }, { meta: { tags: ["x", "y"] } })
    ).toEqual([]);

    const changed = diffSnapshots(
      { meta: { tags: ["x"] } },
      { meta: { tags: ["x", "y"] } }
    );
    expect(changed).toHaveLength(1);
    expect(changed[0]?.field).toBe("meta");
  });

  it("treats a CREATE as all-added and a DELETE as all-removed", () => {
    const created = diffSnapshots(null, { name: "New", price: 10 });
    expect(created).toHaveLength(2);
    expect(created.every((c) => c.changeType === "added")).toBe(true);

    const deleted = diffSnapshots({ name: "Gone", price: 10 }, null);
    expect(deleted).toHaveLength(2);
    expect(deleted.every((c) => c.changeType === "removed")).toBe(true);
  });

  it("never renders a credential, even from a legacy row", () => {
    // Writes strip these now, but rows written before that must not surface a
    // secret when someone opens them today.
    const changes = diffSnapshots(
      { password: "old-hash", refreshTokenVersion: 1, email: "a@b.c" },
      { password: "new-hash", refreshTokenVersion: 2, email: "x@y.z" }
    );

    expect(changes.map((c) => c.field)).toEqual(["email"]);
  });

  it("ignores updatedAt, which changes on every update and says nothing", () => {
    expect(
      diffSnapshots(
        { name: "A", updatedAt: "2026-01-01T00:00:00Z" },
        { name: "A", updatedAt: "2026-08-03T00:00:00Z" }
      )
    ).toEqual([]);
  });

  it("distinguishes null from absent, and false from missing", () => {
    // `{ discount: 0 }` → `{ discount: null }` is a real change and must show.
    const nulled = diffSnapshots({ discount: 0 }, { discount: null });
    expect(nulled).toHaveLength(1);

    // A falsy new value must not be mistaken for "no value".
    const disabled = diffSnapshots({ isActive: true }, { isActive: false });
    expect(disabled).toHaveLength(1);
    expect(disabled[0]?.newValue).toBe(false);
  });

  it("returns nothing when both snapshots are absent", () => {
    expect(diffSnapshots(null, null)).toEqual([]);
    expect(diffSnapshots(undefined, undefined)).toEqual([]);
  });

  it("ignores non-object snapshots rather than throwing", () => {
    // oldData/newData are Json? — a scalar or array is legal at the type level.
    expect(() => diffSnapshots("a string", 42)).not.toThrow();
    expect(diffSnapshots("a string", 42)).toEqual([]);
  });
});

// =============================================================================
// PERIODS
// =============================================================================

describe("resolvePeriod", () => {
  // A mid-afternoon instant, so "today" cannot accidentally pass by starting at
  // midnight.
  const now = new Date(2026, 7, 3, 14, 30, 0); // 2026-08-03T14:30 local

  it("starts 'today' at midnight and ends at the next midnight", () => {
    const range = resolvePeriod("today", now);
    expect(range.from).toEqual(new Date(2026, 7, 3));
    expect(range.to).toEqual(new Date(2026, 7, 4));
  });

  it("is half-open, so windows never overlap", () => {
    // `to` is the first instant AFTER the window. If the service used `lte`,
    // yesterday's range would include the first row of today.
    const yesterday = resolvePeriod("yesterday", now);
    const today = resolvePeriod("today", now);
    expect(yesterday.to).toEqual(today.from);
  });

  it("uses rolling windows, not calendar ones", () => {
    // "Last 7 days" on a Monday morning must not collapse to a few hours.
    const week = resolvePeriod("week", now);
    expect(week.from).toEqual(new Date(2026, 6, 28)); // 6 days back
    expect(week.to).toEqual(new Date(2026, 7, 4));
  });

  it("returns an unbounded range for 'all' and 'custom'", () => {
    // "custom" defers to caller-supplied dates; "all" applies no predicate.
    expect(resolvePeriod("all", now)).toEqual({ from: null, to: null });
    expect(resolvePeriod("custom", now)).toEqual({ from: null, to: null });
  });

  it("covers a month and a year without inverting the range", () => {
    for (const period of ["month", "quarter", "year"] as const) {
      const range = resolvePeriod(period, now);
      expect(range.from!.getTime()).toBeLessThan(range.to!.getTime());
    }
  });
});
