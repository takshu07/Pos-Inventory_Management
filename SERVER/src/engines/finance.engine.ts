// =============================================================================
// FINANCE ENGINE  —  pure accounting arithmetic
//
// P&L, margins, cash flow and settlement state are computed here, with no
// database access. Everything in this file is a total function over its inputs,
// which is what makes the money maths testable without a Postgres connection.
//
// THE DEFINITIONS THIS MODULE COMMITS TO
// --------------------------------------
// Accounting terms are ambiguous in retail, so the ones this system uses are
// pinned down here rather than re-decided per query:
//
//   Gross Sales   Σ grandTotal of completed sales, AFTER discount and round-off.
//                 It is what the customer actually paid, because that is the
//                 only figure the payments table can be reconciled against.
//   Net Sales     Gross Sales − refunds. Exchanges are NOT netted out: an
//                 even-value exchange moves goods, not money, and subtracting it
//                 would understate revenue by the value of every size swap.
//   COGS          Σ (costAtSale × quantity) over sold items. Uses the cost
//                 SNAPSHOT taken at sale time, never the variant's current cost
//                 — a supplier price rise must not rewrite last month's margin.
//   Gross Profit  Net Sales − COGS.
//   Operating Exp Σ approved expenses in the period. PENDING expenses are
//                 excluded: money that may yet be rejected is not a cost.
//   Net Profit    Gross Profit − Operating Expenses.
//
// Salaries and supplier payments are deliberately NOT subtracted again in Net
// Profit. Salary is an Expense row (category SALARY) and supplier payments
// settle inventory already counted in COGS; counting them twice is the single
// most common way a retail P&L understates profit into fiction.
// =============================================================================

import { Prisma } from "../../generated/prisma";

export const ZERO = new Prisma.Decimal(0);

export function toDecimal(
  value: Prisma.Decimal | number | string | null | undefined
): Prisma.Decimal {
  if (value === null || value === undefined || value === "") return ZERO;
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

export function toNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return value instanceof Prisma.Decimal ? value.toNumber() : Number(value);
}

export function money(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Sums a list of decimal-ish values. */
export function sum(values: Array<Prisma.Decimal | number | null | undefined>): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((acc, v) => acc.plus(toDecimal(v)), ZERO);
}

// =============================================================================
// RATIOS
// =============================================================================

/**
 * `part / whole` as a percentage, to 2dp.
 *
 * Returns 0 rather than Infinity or NaN when the denominator is zero. A KPI
 * card that renders "Infinity%" is worse than useless — it looks like a bug in
 * the numbers rather than an absence of them, and a zero denominator here
 * always means "no activity in this period", which reads correctly as 0.
 */
export function percentage(
  part: Prisma.Decimal | number,
  whole: Prisma.Decimal | number
): number {
  const w = toDecimal(whole);
  if (w.isZero()) return 0;
  return Number(toDecimal(part).dividedBy(w).times(100).toDecimalPlaces(2));
}

/**
 * Period-over-period growth, as a percentage.
 *
 * The zero-baseline case is the interesting one. Growth from ₹0 is
 * mathematically undefined, and reporting it as a huge number ("+10000%") makes
 * a first sale look like a trend. This returns 100 when there is now revenue
 * where there was none, and 0 when both periods are empty — both of which a
 * reader interprets correctly without a footnote.
 */
export function growth(
  current: Prisma.Decimal | number,
  previous: Prisma.Decimal | number
): number {
  const prev = toDecimal(previous);
  const curr = toDecimal(current);

  if (prev.isZero()) return curr.isZero() ? 0 : 100;
  return Number(curr.minus(prev).dividedBy(prev.abs()).times(100).toDecimalPlaces(2));
}

/** "up" | "down" | "flat" — the trend indicator every KPI card renders. */
export function trend(value: number): "up" | "down" | "flat" {
  if (value > 0.005) return "up";
  if (value < -0.005) return "down";
  return "flat";
}

// =============================================================================
// PROFIT & LOSS
// =============================================================================

export interface ProfitLossInput {
  grossSales: Prisma.Decimal | number;
  refunds: Prisma.Decimal | number;
  discounts: Prisma.Decimal | number;
  tax: Prisma.Decimal | number;
  cogs: Prisma.Decimal | number;
  operatingExpenses: Prisma.Decimal | number;
}

export interface ProfitLoss {
  grossSales: number;
  refunds: number;
  discounts: number;
  netSales: number;
  tax: number;
  cogs: number;
  grossProfit: number;
  grossMarginPercent: number;
  operatingExpenses: number;
  netProfit: number;
  netMarginPercent: number;
}

export function calculateProfitLoss(input: ProfitLossInput): ProfitLoss {
  const grossSales = toDecimal(input.grossSales);
  const refunds = toDecimal(input.refunds);
  const netSales = money(grossSales.minus(refunds));

  const cogs = toDecimal(input.cogs);
  const grossProfit = money(netSales.minus(cogs));

  const operatingExpenses = toDecimal(input.operatingExpenses);
  const netProfit = money(grossProfit.minus(operatingExpenses));

  return {
    grossSales: toNumber(money(grossSales)),
    refunds: toNumber(money(refunds)),
    discounts: toNumber(money(toDecimal(input.discounts))),
    netSales: toNumber(netSales),
    tax: toNumber(money(toDecimal(input.tax))),
    cogs: toNumber(money(cogs)),
    grossProfit: toNumber(grossProfit),
    grossMarginPercent: percentage(grossProfit, netSales),
    operatingExpenses: toNumber(money(operatingExpenses)),
    netProfit: toNumber(netProfit),
    netMarginPercent: percentage(netProfit, netSales),
  };
}

// =============================================================================
// CASH FLOW
// =============================================================================

export interface CashFlowLine {
  label: string;
  amount: number;
  direction: "IN" | "OUT";
}

export interface CashFlowStatement {
  openingBalance: number;
  moneyIn: number;
  moneyOut: number;
  netFlow: number;
  closingBalance: number;
  inflows: CashFlowLine[];
  outflows: CashFlowLine[];
}

/**
 * Builds a cash-flow statement from labelled inflow/outflow buckets.
 *
 * Zero-value lines are KEPT rather than filtered out. A statement that silently
 * omits "Supplier Payments" when none were made reads as an oversight; showing
 * it at ₹0 states positively that none were made.
 */
export function buildCashFlow(params: {
  openingBalance: Prisma.Decimal | number;
  inflows: Array<{ label: string; amount: Prisma.Decimal | number }>;
  outflows: Array<{ label: string; amount: Prisma.Decimal | number }>;
}): CashFlowStatement {
  const moneyIn = sum(params.inflows.map((i) => i.amount));
  const moneyOut = sum(params.outflows.map((o) => o.amount));
  const opening = toDecimal(params.openingBalance);
  const netFlow = money(moneyIn.minus(moneyOut));

  return {
    openingBalance: toNumber(money(opening)),
    moneyIn: toNumber(money(moneyIn)),
    moneyOut: toNumber(money(moneyOut)),
    netFlow: toNumber(netFlow),
    closingBalance: toNumber(money(opening.plus(netFlow))),
    inflows: params.inflows.map((i) => ({
      label: i.label,
      amount: toNumber(money(toDecimal(i.amount))),
      direction: "IN" as const,
    })),
    outflows: params.outflows.map((o) => ({
      label: o.label,
      amount: toNumber(money(toDecimal(o.amount))),
      direction: "OUT" as const,
    })),
  };
}

// =============================================================================
// SETTLEMENT STATE
// =============================================================================

export type SettlementStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "CANCELLED";

/**
 * Derives a supplier bill's settlement state.
 *
 * OVERDUE is checked BEFORE partial payment deliberately: a bill that is half
 * paid and three weeks past its due date is overdue, not "partially paid". The
 * status a payables screen sorts by must be the one that demands action.
 */
export function deriveSettlementStatus(params: {
  total: Prisma.Decimal | number;
  paid: Prisma.Decimal | number;
  dueDate?: Date | null;
  isCancelled?: boolean;
  asOf?: Date;
}): { status: SettlementStatus; dueAmount: Prisma.Decimal } {
  if (params.isCancelled) return { status: "CANCELLED", dueAmount: ZERO };

  const total = toDecimal(params.total);
  const paid = toDecimal(params.paid);
  const dueAmount = money(Prisma.Decimal.max(total.minus(paid), ZERO));

  if (dueAmount.isZero()) return { status: "PAID", dueAmount };

  const asOf = params.asOf ?? new Date();
  if (params.dueDate && params.dueDate < asOf) {
    return { status: "OVERDUE", dueAmount };
  }

  return { status: paid.isZero() ? "UNPAID" : "PARTIALLY_PAID", dueAmount };
}

/** How many days a bill is past due. Negative = days remaining. */
export function daysOverdue(dueDate: Date | null | undefined, asOf: Date = new Date()): number | null {
  if (!dueDate) return null;
  return Math.floor((asOf.getTime() - dueDate.getTime()) / 86_400_000);
}

/** Payables ageing bucket, the standard 0/30/60/90 breakdown. */
export function ageingBucket(days: number | null): "CURRENT" | "0_30" | "31_60" | "61_90" | "90_PLUS" {
  if (days === null || days <= 0) return "CURRENT";
  if (days <= 30) return "0_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "90_PLUS";
}

// =============================================================================
// PAYROLL
// =============================================================================

export interface SalaryComponents {
  baseSalary: Prisma.Decimal | number;
  bonus?: Prisma.Decimal | number;
  overtime?: Prisma.Decimal | number;
  incentive?: Prisma.Decimal | number;
  advance?: Prisma.Decimal | number;
  deduction?: Prisma.Decimal | number;
}

/**
 * net = base + bonus + overtime + incentive − advance − deduction.
 *
 * Clamped at zero. A negative payslip is not a thing that can be paid; when
 * advances exceed earnings the excess carries as a debt, which is a separate
 * record, not a negative net. Letting it go negative here would make the
 * outstanding-salaries KPI subtract from itself.
 */
export function calculateNetSalary(c: SalaryComponents): Prisma.Decimal {
  const additions = sum([c.baseSalary, c.bonus, c.overtime, c.incentive]);
  const subtractions = sum([c.advance, c.deduction]);
  return money(Prisma.Decimal.max(additions.minus(subtractions), ZERO));
}

export type SalaryStatus = "PENDING" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";

export function deriveSalaryStatus(
  netPayable: Prisma.Decimal | number,
  paidAmount: Prisma.Decimal | number
): { status: SalaryStatus; dueAmount: Prisma.Decimal } {
  const net = toDecimal(netPayable);
  const paid = toDecimal(paidAmount);
  const dueAmount = money(Prisma.Decimal.max(net.minus(paid), ZERO));

  if (dueAmount.isZero()) return { status: "PAID", dueAmount };
  return { status: paid.isZero() ? "PENDING" : "PARTIALLY_PAID", dueAmount };
}

// =============================================================================
// PERIOD RESOLUTION
//
// One place that turns a period keyword into a concrete window, so "this month"
// means the same thing on the dashboard, the P&L and the export. A second
// implementation would eventually disagree about whether "week" starts on
// Sunday or Monday, and the two screens would quietly show different numbers.
// =============================================================================

export type PeriodKeyword = "today" | "yesterday" | "week" | "month" | "quarter" | "year" | "custom";

export interface DateWindow {
  start: Date;
  end: Date;
  /** The window of equal length immediately before `start`, for growth maths. */
  previousStart: Date;
  previousEnd: Date;
  label: string;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function resolvePeriod(
  period: PeriodKeyword,
  custom?: { startDate?: Date; endDate?: Date },
  now: Date = new Date()
): DateWindow {
  let start: Date;
  let end: Date;
  let label: string;

  switch (period) {
    case "today":
      start = startOfDay(now);
      end = endOfDay(now);
      label = "Today";
      break;

    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      start = startOfDay(y);
      end = endOfDay(y);
      label = "Yesterday";
      break;
    }

    case "week": {
      // Week starts MONDAY. Indian retail reports on a Monday–Sunday week, and
      // getDay() returns 0 for Sunday, so the shift below maps Sunday to 6.
      const d = new Date(now);
      const offset = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - offset);
      start = startOfDay(d);
      end = endOfDay(now);
      label = "This Week";
      break;
    }

    case "quarter": {
      const q = Math.floor(now.getMonth() / 3);
      start = startOfDay(new Date(now.getFullYear(), q * 3, 1));
      end = endOfDay(now);
      label = `Q${q + 1} ${now.getFullYear()}`;
      break;
    }

    case "year":
      start = startOfDay(new Date(now.getFullYear(), 0, 1));
      end = endOfDay(now);
      label = String(now.getFullYear());
      break;

    case "custom":
      start = startOfDay(custom?.startDate ?? new Date(now.getFullYear(), now.getMonth(), 1));
      end = endOfDay(custom?.endDate ?? now);
      label = "Custom Range";
      break;

    case "month":
    default:
      start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
      end = endOfDay(now);
      label = now.toLocaleString("en-IN", { month: "long", year: "numeric" });
      break;
  }

  // The comparison window is the SAME LENGTH immediately before `start`, not
  // "the previous calendar month". Comparing a 12-day month-to-date against a
  // full 31-day month would report a catastrophic decline every single time.
  const span = end.getTime() - start.getTime();
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - span);

  return { start, end, previousStart, previousEnd, label };
}

// =============================================================================
// TIME SERIES
// =============================================================================

export type Granularity = "day" | "week" | "month" | "year";

/** Postgres `date_trunc` unit for a granularity. Whitelisted, never interpolated. */
export function truncUnit(granularity: Granularity): string {
  switch (granularity) {
    case "week": return "week";
    case "month": return "month";
    case "year": return "year";
    case "day":
    default: return "day";
  }
}

/**
 * Picks a sensible granularity for a window length.
 * A day-granular chart over three years is 1,095 points nobody can read.
 */
export function autoGranularity(start: Date, end: Date): Granularity {
  const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
  if (days <= 31) return "day";
  if (days <= 120) return "week";
  if (days <= 1_095) return "month";
  return "year";
}

/**
 * Fills gaps in a sparse time series with zero-valued buckets.
 *
 * Without this a line chart connects 3 March straight to 17 March, which reads
 * as steady trade across a fortnight the shop was shut. Explicit zeroes are the
 * difference between "no data" and "no sales".
 */
export function fillSeries<T extends Record<string, unknown>>(
  rows: Array<{ bucket: Date | string } & T>,
  start: Date,
  end: Date,
  granularity: Granularity,
  emptyValue: T
): Array<{ bucket: string } & T> {
  const key = (d: Date) => d.toISOString().slice(0, 10);
  const present = new Map<string, T>();

  for (const row of rows) {
    const d = row.bucket instanceof Date ? row.bucket : new Date(row.bucket);
    const { bucket: _drop, ...rest } = row;
    present.set(key(truncate(d, granularity)), rest as unknown as T);
  }

  const out: Array<{ bucket: string } & T> = [];
  let cursor = truncate(start, granularity);
  const limit = truncate(end, granularity);
  let guard = 0;

  while (cursor <= limit && guard++ < 5_000) {
    const k = key(cursor);
    out.push({ bucket: k, ...(present.get(k) ?? emptyValue) });
    cursor = advance(cursor, granularity);
  }

  return out;
}

function truncate(d: Date, granularity: Granularity): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  switch (granularity) {
    case "week": {
      const offset = (x.getDay() + 6) % 7;
      x.setDate(x.getDate() - offset);
      return x;
    }
    case "month":
      x.setDate(1);
      return x;
    case "year":
      x.setMonth(0, 1);
      return x;
    default:
      return x;
  }
}

function advance(d: Date, granularity: Granularity): Date {
  const x = new Date(d);
  switch (granularity) {
    case "week":  x.setDate(x.getDate() + 7); return x;
    case "month": x.setMonth(x.getMonth() + 1); return x;
    case "year":  x.setFullYear(x.getFullYear() + 1); return x;
    default:      x.setDate(x.getDate() + 1); return x;
  }
}

// =============================================================================
// DOCUMENT NUMBERING
// =============================================================================

export function buildDocumentNumber(prefix: string, date: Date, sequence: number): string {
  const stamp =
    `${date.getFullYear()}` +
    `${String(date.getMonth() + 1).padStart(2, "0")}` +
    `${String(date.getDate()).padStart(2, "0")}`;
  return `${prefix}-${stamp}-${String(sequence).padStart(4, "0")}`;
}

export function parseDocumentSequence(documentNumber: string | null | undefined): number {
  if (!documentNumber) return 0;
  const tail = documentNumber.split("-").pop();
  const parsed = Number.parseInt(tail ?? "", 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}
