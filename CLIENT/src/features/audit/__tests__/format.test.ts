/**
 * Regression tests for the Audit Logs presentation helpers.
 *
 * The rules pinned here are correctness concerns, not cosmetics. An audit
 * trail's whole job is to be trustworthy, and each of these is a way a diff can
 * lie to the person reading it:
 *
 *   • `false`, `null`, `""` and "absent" must all render DIFFERENTLY. Collapsing
 *     any pair turns "cleared the field" and "set it to blank" — or
 *     "deactivated" and "no change" — into the same display.
 *   • Severity must map to visibly distinct variants, or the badge stops
 *     carrying information.
 *   • A capped total must render with a "+", or the UI states a precise figure
 *     the server explicitly refused to youch for.
 */

import { describe, expect, it } from "vitest";

import {
  formatFieldName,
  formatRelative,
  formatTimestamp,
  formatTotal,
  formatValue,
  isComplexValue,
  severityAccent,
  severityLabel,
  severityVariant,
  shortId,
  summariseChanges,
} from "../utils/format";
import { SEVERITIES } from "../types";
import type { AuditFieldChange } from "../types";

// =============================================================================
// SEVERITY
// =============================================================================

describe("severityVariant", () => {
  it("gives every severity a variant", () => {
    for (const severity of SEVERITIES) {
      expect(severityVariant(severity)).toBeTruthy();
    }
  });

  it("keeps the levels visually distinct", () => {
    // Two levels sharing a variant would make the badge decorative.
    const variants = SEVERITIES.map(severityVariant);
    expect(new Set(variants).size).toBe(SEVERITIES.length);
  });

  it("renders CRITICAL as destructive", () => {
    expect(severityVariant("CRITICAL")).toBe("destructive");
  });

  it("falls back safely for an unknown severity", () => {
    expect(severityVariant("WEIRD" as never)).toBe("secondary");
  });
});

describe("severityAccent", () => {
  it("accents only the levels worth spotting while scanning", () => {
    // Accenting everything accents nothing.
    expect(severityAccent("CRITICAL")).toContain("border-l-destructive");
    expect(severityAccent("MEDIUM")).toContain("transparent");
    expect(severityAccent("LOW")).toContain("transparent");
  });
});

describe("severityLabel", () => {
  it("title-cases the enum", () => {
    expect(severityLabel("CRITICAL")).toBe("Critical");
    expect(severityLabel("LOW")).toBe("Low");
  });
});

// =============================================================================
// VALUES — the ones that make a diff honest
// =============================================================================

describe("formatValue", () => {
  it("distinguishes null, undefined and empty string", () => {
    // "cleared the field", "no value at all" and "set to blank" are three
    // different events and must not render identically.
    const rendered = [formatValue(null), formatValue(undefined), formatValue("")];
    expect(new Set(rendered).size).toBe(3);
    expect(formatValue(null)).toBe("null");
    expect(formatValue(undefined)).toBe("—");
    expect(formatValue("")).toBe('""');
  });

  it("renders false rather than swallowing it", () => {
    // A falsy value is still a value — showing nothing would make deactivating
    // something look like a no-op.
    expect(formatValue(false)).toBe("false");
    expect(formatValue(0)).toBe("0");
  });

  it("renders booleans and numbers exactly", () => {
    expect(formatValue(true)).toBe("true");
    expect(formatValue(1500)).toBe("1500");
  });

  it("pretty-prints objects instead of [object Object]", () => {
    const out = formatValue({ a: 1 });
    expect(out).toContain('"a"');
    expect(out).not.toBe("[object Object]");
  });

  it("survives a circular structure", () => {
    const circular: Record<string, unknown> = { name: "x" };
    circular.self = circular;
    expect(() => formatValue(circular)).not.toThrow();
  });
});

describe("isComplexValue", () => {
  it("treats objects and arrays as complex, scalars as simple", () => {
    expect(isComplexValue({ a: 1 })).toBe(true);
    expect(isComplexValue([1, 2])).toBe(true);
    expect(isComplexValue("text")).toBe(false);
    expect(isComplexValue(null)).toBe(false);
  });
});

// =============================================================================
// NAMES AND SUMMARIES
// =============================================================================

describe("formatFieldName", () => {
  it("humanises camelCase and snake_case", () => {
    expect(formatFieldName("sellingPrice")).toBe("Selling Price");
    expect(formatFieldName("is_active")).toBe("Is Active");
    expect(formatFieldName("name")).toBe("Name");
  });
});

describe("summariseChanges", () => {
  const change = (field: string): AuditFieldChange => ({
    field,
    oldValue: 1,
    newValue: 2,
    changeType: "changed",
  });

  it("says so when nothing changed", () => {
    expect(summariseChanges([])).toBe("No field changes");
  });

  it("names the fields when there are few", () => {
    expect(summariseChanges([change("price"), change("sku")])).toBe("Price, Sku");
  });

  it("counts the rest rather than truncating into a misleading list", () => {
    const summary = summariseChanges(
      ["price", "sku", "name", "brand"].map(change)
    );
    expect(summary).toBe("Price, Sku +2 more");
  });
});

describe("shortId", () => {
  it("keeps the TAIL, which is what distinguishes cuids", () => {
    const id = "clx1234567890abcdefgh";
    expect(shortId(id)).toBe("…abcdefgh");
  });

  it("leaves a short id alone", () => {
    expect(shortId("abc")).toBe("abc");
  });
});

// =============================================================================
// TOTALS AND TIME
// =============================================================================

describe("formatTotal", () => {
  it("marks a capped total with a +", () => {
    // The server refused to vouch for a precise figure; the UI must not invent
    // one.
    expect(formatTotal(10000, false)).toBe("10,000+");
  });

  it("renders an exact total plainly", () => {
    expect(formatTotal(42, true)).toBe("42");
  });
});

describe("formatTimestamp", () => {
  it("returns a placeholder for an invalid date instead of 'Invalid Date'", () => {
    expect(formatTimestamp("not-a-date")).toBe("—");
  });

  it("renders a real timestamp", () => {
    expect(formatTimestamp("2026-08-03T10:30:00.000Z")).not.toBe("—");
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-08-03T12:00:00.000Z");

  it("describes recent, hourly, daily and older gaps", () => {
    expect(formatRelative("2026-08-03T11:59:30.000Z", now)).toBe("just now");
    expect(formatRelative("2026-08-03T11:30:00.000Z", now)).toBe("30m ago");
    expect(formatRelative("2026-08-03T09:00:00.000Z", now)).toBe("3h ago");
    expect(formatRelative("2026-08-01T12:00:00.000Z", now)).toBe("2d ago");
  });

  it("does not render a negative age for a clock-skewed future timestamp", () => {
    expect(formatRelative("2026-08-03T12:05:00.000Z", now)).toBe("just now");
  });

  it("returns an empty string for an invalid date", () => {
    expect(formatRelative("nonsense", now)).toBe("");
  });
});
