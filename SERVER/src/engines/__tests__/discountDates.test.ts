// =============================================================================
// DISCOUNT DATE BOUNDARIES — store-timezone conversion
//
// Lives under engines/__tests__ so it runs in the pure-unit config (no DB).
//
// Why this matters: the owner picking "ends 31 Dec" means 23:59:59 in STORE
// time. Storing that as UTC midnight would expire a sale-day discount at 05:30
// local — mid-afternoon, five and a half hours early. These tests pin the
// boundary arithmetic, including the millisecond edge case that a formatter-
// based offset calculation gets wrong.
// =============================================================================

import { beforeAll, describe, expect, it, vi } from "vitest";

// The validation module reads the store timezone through ConfigurationEngine,
// which touches settings/prisma at import time. Stub it to a fixed zone so the
// test is hermetic and does not need a database.
vi.mock("../../engines/configuration.engine", () => ({
  ConfigurationEngine: {
    getTimeZone: () => "Asia/Kolkata", // UTC+05:30, no DST
  },
}));

let discountRuleValidation: typeof import("../../validation/discountRule.validation")["discountRuleValidation"];

beforeAll(async () => {
  ({ discountRuleValidation } = await import("../../validation/discountRule.validation"));
});

const parseDates = (startDate?: string, endDate?: string) =>
  discountRuleValidation.createCategory.parse({
    name: "Seasonal",
    type: "PERCENTAGE",
    value: 10,
    categoryId: "clzzzzzzzzzzzzzzzzzzzzzza",
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  });

describe("store-timezone date boundaries (Asia/Kolkata, UTC+5:30)", () => {
  it("widens a bare start date to 00:00:00.000 store-local", () => {
    const { startDate } = parseDates("2026-07-01");
    // 2026-07-01 00:00:00.000 IST === 2026-06-30 18:30:00.000 UTC
    expect(startDate!.toISOString()).toBe("2026-06-30T18:30:00.000Z");
  });

  it("widens a bare end date to 23:59:59.999 store-local", () => {
    const { endDate } = parseDates(undefined, "2026-12-31");
    // 2026-12-31 23:59:59.999 IST === 2026-12-31 18:29:59.999 UTC
    //
    // Regression guard: an offset computed from Intl parts loses the instant's
    // milliseconds, which previously produced 18:30:00.997Z — 1.998s late, and
    // on the WRONG side of midnight local. A discount would have stayed live
    // into the next day.
    expect(endDate!.toISOString()).toBe("2026-12-31T18:29:59.999Z");
  });

  it("keeps the end date strictly inside the local day it names", () => {
    const { endDate } = parseDates(undefined, "2026-12-31");
    const localDay = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(endDate!);
    expect(localDay).toBe("2026-12-31");
  });

  it("a full day window spans exactly 24 hours minus 1ms", () => {
    const { startDate, endDate } = parseDates("2026-07-01", "2026-07-01");
    expect(endDate!.getTime() - startDate!.getTime()).toBe(24 * 60 * 60 * 1000 - 1);
  });

  it("passes through explicit datetimes untouched", () => {
    const { startDate } = parseDates("2026-07-01T09:15:00.000Z");
    expect(startDate!.toISOString()).toBe("2026-07-01T09:15:00.000Z");
  });

  it("rejects an end date before its start date", () => {
    expect(() => parseDates("2026-12-31", "2026-01-01")).toThrow();
  });

  it("accepts an end date equal to its start date", () => {
    expect(() => parseDates("2026-07-01", "2026-07-01")).not.toThrow();
  });
});
