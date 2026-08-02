// =============================================================================
// FINANCE ENGINE — unit tests
//
// These cover the definitions the whole Finance and Reports surface is built
// on. The cases are chosen where a plausible-looking implementation would be
// WRONG in a way nobody notices until the numbers are already on a screen:
//
//   • Net Sales nets refunds but NOT exchanges — an even swap moves goods,
//     not money.
//   • Growth from a zero baseline must not report +10000%.
//   • A percentage with a zero denominator must be 0, never Infinity/NaN.
//   • The comparison window must be the SAME LENGTH as the current one, or a
//     month-to-date always looks like a collapse against a full month.
//   • A gap in a time series must fill with zero, or a chart draws a straight
//     line across days the shop was shut.
// =============================================================================

import { describe, expect, it } from "vitest";
import { Prisma } from "../../../generated/prisma";

import {
  percentage,
  growth,
  trend,
  sum,
  calculateProfitLoss,
  buildCashFlow,
  deriveSettlementStatus,
  deriveSalaryStatus,
  calculateNetSalary,
  daysOverdue,
  ageingBucket,
  resolvePeriod,
  autoGranularity,
  fillSeries,
  truncUnit,
} from "../finance.engine";

const D = (n: number | string) => new Prisma.Decimal(n);

// =============================================================================
// RATIOS
// =============================================================================

describe("percentage", () => {
  it("computes a share to two decimal places", () => {
    expect(percentage(250, 1_000)).toBe(25);
    expect(percentage(1, 3)).toBe(33.33);
  });

  it("returns 0 rather than Infinity when the denominator is zero", () => {
    // A KPI card rendering "Infinity%" reads as a bug in the business, not as
    // an absence of activity. Zero denominators here always mean "no activity".
    expect(percentage(500, 0)).toBe(0);
    expect(percentage(0, 0)).toBe(0);
  });
});

describe("growth", () => {
  it("computes period-over-period change", () => {
    expect(growth(150, 100)).toBe(50);
    expect(growth(80, 100)).toBe(-20);
  });

  it("reports 100% — not a huge number — when the baseline was zero", () => {
    // Growth from ₹0 is undefined. Reporting +10000% would make a shop's first
    // sale look like a trend.
    expect(growth(5_000, 0)).toBe(100);
  });

  it("reports 0% when both periods are empty", () => {
    expect(growth(0, 0)).toBe(0);
  });

  it("uses the absolute previous value so a loss-to-profit swing is positive", () => {
    // Previous −1000 → current 500 is a 150% improvement. Dividing by the
    // signed baseline would report −150% for an unambiguously good outcome.
    expect(growth(500, -1_000)).toBe(150);
  });
});

describe("trend", () => {
  it("classifies direction with a dead zone around zero", () => {
    expect(trend(4.2)).toBe("up");
    expect(trend(-4.2)).toBe("down");
    expect(trend(0)).toBe("flat");
    expect(trend(0.001)).toBe("flat");
  });
});

describe("sum", () => {
  it("adds decimals, numbers and nulls without float drift", () => {
    expect(sum([D("0.1"), 0.2, null, undefined, "0.3"]).toNumber()).toBeCloseTo(0.6, 10);
  });
});

// =============================================================================
// PROFIT & LOSS
// =============================================================================

describe("calculateProfitLoss", () => {
  const base = {
    grossSales: 100_000,
    refunds: 5_000,
    discounts: 8_000,
    tax: 4_500,
    cogs: 55_000,
    operatingExpenses: 20_000,
  };

  it("nets refunds out of gross sales", () => {
    expect(calculateProfitLoss(base).netSales).toBe(95_000);
  });

  it("derives gross profit as net sales minus COGS", () => {
    expect(calculateProfitLoss(base).grossProfit).toBe(40_000);
  });

  it("derives net profit as gross profit minus operating expenses", () => {
    expect(calculateProfitLoss(base).netProfit).toBe(20_000);
  });

  it("computes margins against NET sales, not gross", () => {
    const pl = calculateProfitLoss(base);
    expect(pl.grossMarginPercent).toBe(42.11); // 40000 / 95000
    expect(pl.netMarginPercent).toBe(21.05); // 20000 / 95000
  });

  it("does not subtract discounts again — they are already inside grandTotal", () => {
    // grandTotal is what the customer paid, AFTER discount. Subtracting the
    // discount a second time is the classic way a retail P&L invents a loss.
    const withoutDiscountInfo = calculateProfitLoss({ ...base, discounts: 0 });
    expect(withoutDiscountInfo.netProfit).toBe(calculateProfitLoss(base).netProfit);
  });

  it("reports a loss as a negative net profit rather than clamping to zero", () => {
    const pl = calculateProfitLoss({ ...base, operatingExpenses: 60_000 });
    expect(pl.netProfit).toBe(-20_000);
    expect(pl.netMarginPercent).toBeLessThan(0);
  });

  it("returns zeroes, not NaN, for a period with no activity", () => {
    const pl = calculateProfitLoss({
      grossSales: 0, refunds: 0, discounts: 0, tax: 0, cogs: 0, operatingExpenses: 0,
    });
    expect(pl.netSales).toBe(0);
    expect(pl.grossMarginPercent).toBe(0);
    expect(pl.netMarginPercent).toBe(0);
  });
});

// =============================================================================
// CASH FLOW
// =============================================================================

describe("buildCashFlow", () => {
  it("closes at opening plus net flow", () => {
    const statement = buildCashFlow({
      openingBalance: 10_000,
      inflows: [{ label: "Sales", amount: 25_000 }],
      outflows: [{ label: "Expenses", amount: 4_000 }, { label: "Drops", amount: 15_000 }],
    });

    expect(statement.moneyIn).toBe(25_000);
    expect(statement.moneyOut).toBe(19_000);
    expect(statement.netFlow).toBe(6_000);
    expect(statement.closingBalance).toBe(16_000);
  });

  it("keeps zero-valued lines so an absence is stated, not implied", () => {
    const statement = buildCashFlow({
      openingBalance: 0,
      inflows: [{ label: "Sales", amount: 100 }],
      outflows: [{ label: "Supplier Payments", amount: 0 }],
    });
    expect(statement.outflows).toHaveLength(1);
    expect(statement.outflows[0]).toMatchObject({ label: "Supplier Payments", amount: 0 });
  });
});

// =============================================================================
// SETTLEMENT
// =============================================================================

describe("deriveSettlementStatus", () => {
  const future = new Date(Date.now() + 7 * 86_400_000);
  const past = new Date(Date.now() - 7 * 86_400_000);

  it("is UNPAID when nothing has been paid", () => {
    const r = deriveSettlementStatus({ total: 10_000, paid: 0, dueDate: future });
    expect(r.status).toBe("UNPAID");
    expect(r.dueAmount.toNumber()).toBe(10_000);
  });

  it("is PARTIALLY_PAID when some has been paid and it is not yet due", () => {
    const r = deriveSettlementStatus({ total: 10_000, paid: 4_000, dueDate: future });
    expect(r.status).toBe("PARTIALLY_PAID");
    expect(r.dueAmount.toNumber()).toBe(6_000);
  });

  it("is PAID when fully settled, and PAID beats OVERDUE", () => {
    const r = deriveSettlementStatus({ total: 10_000, paid: 10_000, dueDate: past });
    expect(r.status).toBe("PAID");
    expect(r.dueAmount.toNumber()).toBe(0);
  });

  it("is OVERDUE — not PARTIALLY_PAID — when part-paid and past due", () => {
    // The status a payables screen sorts by must be the one that demands
    // action. "Partially paid" hides a bill three weeks late.
    const r = deriveSettlementStatus({ total: 10_000, paid: 5_000, dueDate: past });
    expect(r.status).toBe("OVERDUE");
  });

  it("treats a bill with no due date as not overdue", () => {
    const r = deriveSettlementStatus({ total: 10_000, paid: 0, dueDate: null });
    expect(r.status).toBe("UNPAID");
  });

  it("owes nothing on a cancelled bill", () => {
    const r = deriveSettlementStatus({ total: 10_000, paid: 0, isCancelled: true });
    expect(r.status).toBe("CANCELLED");
    expect(r.dueAmount.toNumber()).toBe(0);
  });

  it("never reports a negative due amount on an overpayment", () => {
    const r = deriveSettlementStatus({ total: 10_000, paid: 12_000 });
    expect(r.dueAmount.toNumber()).toBe(0);
  });
});

describe("ageing", () => {
  it("counts days past the due date", () => {
    const asOf = new Date("2026-07-30T12:00:00Z");
    expect(daysOverdue(new Date("2026-07-15T12:00:00Z"), asOf)).toBe(15);
  });

  it("returns a negative count for a bill not yet due", () => {
    const asOf = new Date("2026-07-30T12:00:00Z");
    expect(daysOverdue(new Date("2026-08-10T12:00:00Z"), asOf)).toBe(-11);
  });

  it("returns null when there is no due date", () => {
    expect(daysOverdue(null)).toBeNull();
  });

  it("buckets into the standard 0/30/60/90 bands", () => {
    expect(ageingBucket(null)).toBe("CURRENT");
    expect(ageingBucket(-5)).toBe("CURRENT");
    expect(ageingBucket(1)).toBe("0_30");
    expect(ageingBucket(30)).toBe("0_30");
    expect(ageingBucket(31)).toBe("31_60");
    expect(ageingBucket(90)).toBe("61_90");
    expect(ageingBucket(91)).toBe("90_PLUS");
  });
});

// =============================================================================
// PAYROLL
// =============================================================================

describe("calculateNetSalary", () => {
  it("adds earnings and subtracts advances and deductions", () => {
    const net = calculateNetSalary({
      baseSalary: 30_000,
      bonus: 5_000,
      overtime: 2_000,
      incentive: 1_000,
      advance: 8_000,
      deduction: 1_500,
    });
    expect(net.toNumber()).toBe(28_500);
  });

  it("clamps at zero when advances exceed earnings", () => {
    // A negative payslip cannot be paid. Letting it go negative would make the
    // outstanding-salaries KPI subtract from itself.
    const net = calculateNetSalary({ baseSalary: 10_000, advance: 15_000 });
    expect(net.toNumber()).toBe(0);
  });

  it("treats absent components as zero", () => {
    expect(calculateNetSalary({ baseSalary: 20_000 }).toNumber()).toBe(20_000);
  });
});

describe("deriveSalaryStatus", () => {
  it("is PENDING before any payment", () => {
    const r = deriveSalaryStatus(30_000, 0);
    expect(r.status).toBe("PENDING");
    expect(r.dueAmount.toNumber()).toBe(30_000);
  });

  it("is PARTIALLY_PAID on a part payment", () => {
    expect(deriveSalaryStatus(30_000, 10_000).status).toBe("PARTIALLY_PAID");
  });

  it("is PAID when settled in full", () => {
    const r = deriveSalaryStatus(30_000, 30_000);
    expect(r.status).toBe("PAID");
    expect(r.dueAmount.toNumber()).toBe(0);
  });
});

// =============================================================================
// PERIOD RESOLUTION
// =============================================================================

describe("resolvePeriod", () => {
  // A Thursday, so the week boundary is unambiguous.
  const now = new Date(2026, 6, 30, 15, 0, 0);

  it("bounds 'today' to the calendar day", () => {
    const w = resolvePeriod("today", undefined, now);
    expect(w.start.getHours()).toBe(0);
    expect(w.end.getHours()).toBe(23);
    expect(w.start.getDate()).toBe(30);
  });

  it("starts the week on Monday", () => {
    // Indian retail reports Monday–Sunday. getDay() returns 0 for Sunday, so a
    // naive implementation would start the week a day late.
    const w = resolvePeriod("week", undefined, now);
    expect(w.start.getDay()).toBe(1);
    expect(w.start.getDate()).toBe(27);
  });

  it("starts 'month' on the first of the month", () => {
    const w = resolvePeriod("month", undefined, now);
    expect(w.start.getDate()).toBe(1);
    expect(w.start.getMonth()).toBe(6);
  });

  it("starts 'quarter' on the first day of the calendar quarter", () => {
    const w = resolvePeriod("quarter", undefined, now);
    expect(w.start.getMonth()).toBe(6); // Q3 begins in July
    expect(w.start.getDate()).toBe(1);
    expect(w.label).toBe("Q3 2026");
  });

  it("makes the comparison window the SAME LENGTH as the current one", () => {
    // Comparing a 30-day month-to-date against a full 31-day previous month
    // would report a collapse on the first of every month.
    const w = resolvePeriod("month", undefined, now);
    const currentSpan = w.end.getTime() - w.start.getTime();
    const previousSpan = w.previousEnd.getTime() - w.previousStart.getTime();
    expect(Math.abs(currentSpan - previousSpan)).toBeLessThan(1_000);
  });

  it("places the comparison window immediately before the current one", () => {
    const w = resolvePeriod("month", undefined, now);
    expect(w.previousEnd.getTime()).toBeLessThan(w.start.getTime());
    expect(w.start.getTime() - w.previousEnd.getTime()).toBeLessThanOrEqual(1_000);
  });

  it("honours an explicit custom range", () => {
    const w = resolvePeriod(
      "custom",
      { startDate: new Date(2026, 0, 1), endDate: new Date(2026, 2, 31) },
      now
    );
    expect(w.start.getMonth()).toBe(0);
    expect(w.end.getMonth()).toBe(2);
    expect(w.label).toBe("Custom Range");
  });
});

// =============================================================================
// TIME SERIES
// =============================================================================

describe("granularity", () => {
  it("picks a bucket size a chart can actually render", () => {
    const from = (days: number) =>
      autoGranularity(new Date(2026, 0, 1), new Date(2026, 0, 1 + days));

    expect(from(20)).toBe("day");
    expect(from(90)).toBe("week");
    expect(from(400)).toBe("month");
    expect(from(2_000)).toBe("year");
  });

  it("maps granularity to a whitelisted date_trunc unit", () => {
    // These strings are interpolated into SQL, so the closed set matters.
    expect(truncUnit("day")).toBe("day");
    expect(truncUnit("week")).toBe("week");
    expect(truncUnit("month")).toBe("month");
    expect(truncUnit("year")).toBe("year");
  });
});

describe("fillSeries", () => {
  it("inserts zero buckets for days with no activity", () => {
    // Without this a chart connects 1 March straight to 5 March, which reads as
    // steady trade across days the shop was shut.
    const filled = fillSeries(
      [
        { bucket: new Date(2026, 2, 1), revenue: 100 },
        { bucket: new Date(2026, 2, 5), revenue: 300 },
      ],
      new Date(2026, 2, 1),
      new Date(2026, 2, 5),
      "day",
      { revenue: 0 }
    );

    expect(filled).toHaveLength(5);
    expect(filled.map((r) => r.revenue)).toEqual([100, 0, 0, 0, 300]);
  });

  it("returns a bucket per day even when the input is empty", () => {
    const filled = fillSeries(
      [] as Array<{ bucket: Date; revenue: number }>,
      new Date(2026, 2, 1),
      new Date(2026, 2, 3),
      "day",
      { revenue: 0 }
    );
    expect(filled).toHaveLength(3);
    expect(filled.every((r) => r.revenue === 0)).toBe(true);
  });

  it("emits ISO date keys the client can sort lexicographically", () => {
    const filled = fillSeries(
      [{ bucket: new Date(2026, 2, 1), revenue: 10 }],
      new Date(2026, 2, 1),
      new Date(2026, 2, 1),
      "day",
      { revenue: 0 }
    );
    expect(filled[0]!.bucket).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
