/**
 * Regression tests for the Users & Roles display helpers.
 *
 * The theme running through these: A MISSING VALUE MUST NOT RENDER AS A ZERO OR
 * A FALSE FACT. A null salary is "Not recorded", not "₹0"; an account that has
 * never signed in says "Never", not today's date; an unparseable timestamp is an
 * em dash, not "Invalid Date". This is the same null-safety rule the Workforce
 * module applies to monthlyTarget and performanceScore, and it is exactly the
 * kind of thing a refactor silently breaks.
 */

import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatDateTime,
  formatGender,
  formatLastLogin,
  formatSalary,
  fullName,
  initials,
} from "../utils/format";

describe("fullName", () => {
  it("joins first and last", () => {
    expect(fullName({ firstName: "Rahul", lastName: "Sharma" })).toBe("Rahul Sharma");
  });

  it("does not leave a trailing space when the last name is empty", () => {
    expect(fullName({ firstName: "Rahul", lastName: "" })).toBe("Rahul");
  });
});

describe("initials", () => {
  it("takes the first letter of each name, uppercased", () => {
    expect(initials({ firstName: "rahul", lastName: "sharma" })).toBe("RS");
  });

  it("falls back to '?' rather than rendering an empty avatar", () => {
    expect(initials({ firstName: "", lastName: "" })).toBe("?");
  });
});

describe("formatDate", () => {
  it("formats a real date", () => {
    // Locale-formatted, so assert on the parts rather than an exact string.
    const formatted = formatDate("2026-08-02T10:00:00.000Z");
    expect(formatted).toContain("2026");
    expect(formatted).toContain("Aug");
  });

  it.each([null, undefined, "", "not-a-date"])(
    "renders an em dash for %s rather than 'Invalid Date'",
    (value) => {
      expect(formatDate(value as string | null)).toBe("—");
    }
  );
});

describe("formatDateTime", () => {
  it("includes the time of day", () => {
    const formatted = formatDateTime("2026-08-02T10:30:00.000Z");
    expect(formatted).toContain("2026");
    // A colon is the one stable marker of a rendered time across locales.
    expect(formatted).toContain(":");
  });

  it.each([null, undefined, "garbage"])("renders an em dash for %s", (value) => {
    expect(formatDateTime(value as string | null)).toBe("—");
  });
});

describe("formatLastLogin", () => {
  it("says 'Never' for an account that has never signed in", () => {
    // A first-class answer, not a fallback — it is what an access audit looks for.
    expect(formatLastLogin(null)).toBe("Never");
    expect(formatLastLogin(undefined)).toBe("Never");
    expect(formatLastLogin("")).toBe("Never");
  });

  it("says 'Today' for a sign-in earlier today", () => {
    expect(formatLastLogin(new Date().toISOString())).toBe("Today");
  });

  it("says 'Yesterday' for the previous calendar day", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(formatLastLogin(yesterday.toISOString())).toBe("Yesterday");
  });

  it("counts days for anything inside a month", () => {
    const twelveDaysAgo = new Date();
    twelveDaysAgo.setDate(twelveDaysAgo.getDate() - 12);
    expect(formatLastLogin(twelveDaysAgo.toISOString())).toBe("12 days ago");
  });

  it("falls back to an absolute date beyond 30 days", () => {
    const longAgo = new Date();
    longAgo.setDate(longAgo.getDate() - 200);
    const formatted = formatLastLogin(longAgo.toISOString());
    expect(formatted).not.toContain("days ago");
    expect(formatted).toContain(String(longAgo.getFullYear()));
  });

  it("treats an unparseable value as 'Never', not as a crash", () => {
    expect(formatLastLogin("nonsense")).toBe("Never");
  });
});

describe("formatSalary", () => {
  it("formats a number as rupees", () => {
    const formatted = formatSalary(45000);
    expect(formatted).toContain("45,000");
    expect(formatted).toContain("₹");
  });

  it("handles the Prisma Decimal string form", () => {
    // Decimals serialise as strings — "45000.00" must not render literally.
    const formatted = formatSalary("45000.00");
    expect(formatted).toContain("45,000");
    expect(formatted).not.toContain(".00");
  });

  it.each([null, undefined, "", "abc"])(
    "renders 'Not recorded' for %s — never ₹0",
    (value) => {
      // The distinction that matters: no salary on file is NOT a salary of zero.
      expect(formatSalary(value as string | null)).toBe("Not recorded");
    }
  );

  it("still renders an explicit zero as ₹0", () => {
    // A deliberately recorded zero is a fact, and must not be hidden.
    expect(formatSalary(0)).toContain("0");
    expect(formatSalary(0)).not.toBe("Not recorded");
  });
});

describe("formatGender", () => {
  it("sentence-cases the stored enum", () => {
    expect(formatGender("MALE")).toBe("Male");
    expect(formatGender("FEMALE")).toBe("Female");
    expect(formatGender("OTHER")).toBe("Other");
  });

  it("renders an em dash when absent", () => {
    expect(formatGender(null)).toBe("—");
    expect(formatGender("")).toBe("—");
  });
});
