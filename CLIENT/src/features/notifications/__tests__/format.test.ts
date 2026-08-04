/**
 * Notifications — presentation helpers.
 *
 * These exist to pin the null-safety rules. A notification list is exactly the
 * place a bad timestamp or an unexpected enum shows up, and the failure must be
 * an honest dash rather than "Invalid Date" or a crash that takes the page down.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  categoryLabel,
  formatNotificationTime,
  formatNotificationTimestamp,
  selectionLabel,
  severityLabel,
  severityVariant,
  unreadBadgeLabel,
} from "../utils/format";

describe("severity presentation", () => {
  it("keeps CRITICAL and WARNING visually distinct", () => {
    // These are the two that demand action. Collapsing them into one colour is
    // how an out-of-stock alert reads as routine.
    expect(severityVariant("CRITICAL")).not.toBe(severityVariant("WARNING"));
  });

  it("maps every severity to a distinct-enough variant", () => {
    expect(severityVariant("CRITICAL")).toBe("error");
    expect(severityVariant("WARNING")).toBe("warning");
    expect(severityVariant("SUCCESS")).toBe("success");
    expect(severityVariant("INFO")).toBe("info");
  });

  it("labels every severity in sentence case", () => {
    expect(severityLabel("CRITICAL")).toBe("Critical");
    expect(severityLabel("INFO")).toBe("Info");
  });
});

describe("category presentation", () => {
  it("labels every category in sentence case", () => {
    expect(categoryLabel("INVENTORY")).toBe("Inventory");
    expect(categoryLabel("SALES")).toBe("Sales");
    expect(categoryLabel("EMPLOYEES")).toBe("Employees");
    expect(categoryLabel("SECURITY")).toBe("Security");
    expect(categoryLabel("SYSTEM")).toBe("System");
  });
});

describe("timestamps", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a dash for a missing timestamp", () => {
    // "—" reads as "not recorded", which is true. "Invalid Date" reads as a bug
    // in the notification itself.
    expect(formatNotificationTime(null)).toBe("—");
    expect(formatNotificationTime(undefined)).toBe("—");
    expect(formatNotificationTime("")).toBe("—");
  });

  it("renders a dash for an unparseable timestamp", () => {
    expect(formatNotificationTime("not-a-date")).toBe("—");
  });

  it("says 'just now' for something that arrived seconds ago", () => {
    // Avoids a counter that visibly ticks on every render.
    expect(formatNotificationTime("2026-08-03T11:59:40Z")).toBe("just now");
  });

  it("counts minutes under an hour", () => {
    expect(formatNotificationTime("2026-08-03T11:30:00Z")).toBe("30m ago");
  });

  it("counts hours under a day", () => {
    expect(formatNotificationTime("2026-08-03T06:00:00Z")).toBe("6h ago");
  });

  it("counts days under a week", () => {
    expect(formatNotificationTime("2026-08-01T12:00:00Z")).toBe("2d ago");
  });

  it("switches to a date past a week", () => {
    // "31d ago" is harder to act on than a date.
    const result = formatNotificationTime("2026-06-15T12:00:00Z");

    expect(result).not.toMatch(/ago/);
    expect(result).toBeTruthy();
  });

  it("gives an honest tooltip for a missing timestamp", () => {
    expect(formatNotificationTimestamp(null)).toBe("Time not recorded");
    expect(formatNotificationTimestamp("bad")).toBe("Time not recorded");
  });
});

describe("selection and badge labels", () => {
  it("never renders '1 notifications'", () => {
    expect(selectionLabel(1)).toBe("1 selected");
  });

  it("reports an empty selection as None selected", () => {
    expect(selectionLabel(0)).toBe("None selected");
    expect(selectionLabel(-1)).toBe("None selected");
  });

  it("hides the badge at zero rather than showing a 0", () => {
    // A badge reading "0" is noise pretending to be information.
    expect(unreadBadgeLabel(0)).toBe("");
  });

  it("caps the badge at 99+", () => {
    expect(unreadBadgeLabel(99)).toBe("99");
    expect(unreadBadgeLabel(100)).toBe("99+");
    expect(unreadBadgeLabel(5000)).toBe("99+");
  });
});
