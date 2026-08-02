// =============================================================================
// CASH REGISTER ENGINE  —  pure drawer arithmetic
//
// Every number a cashier is held accountable for is computed here, and NOTHING
// in this file touches the database. That separation is the point: drawer math
// is the part of the module that must be provably correct, and code that needs
// a live Postgres connection to exercise cannot be exhaustively tested.
//
// THE CENTRAL RULE
// ----------------
// Expected cash is derived from the DRAWER LEDGER (CashTransaction), never from
// the sales table. A cashier's till is affected by things that are not sales
// (safe drops, payouts, supplier payments handed over in notes) and unaffected
// by things that are (a card sale). Computing expected cash from sales would be
// wrong in both directions simultaneously — and it is the single most common
// way a POS reports a phantom shortage.
//
//   expectedCash = openingCash
//                + Σ(CASH_IN)      -- cash sales, cash exchange top-ups
//                − Σ(CASH_OUT)     -- refunds, drops, payouts, cash expenses
//
// Money is handled as Prisma.Decimal throughout. Currency in IEEE-754 doubles
// accumulates error that eventually shows up as a one-paisa drawer discrepancy
// nobody can explain, so floats never enter the arithmetic — only the boundary
// where a JSON number becomes a Decimal, and the boundary where a Decimal
// becomes a response.
// =============================================================================

import { Prisma, CashTransactionType, PaymentMethod } from "../../generated/prisma";

export const ZERO = new Prisma.Decimal(0);

/** Coerces any numeric-ish input to Decimal. `null`/`undefined` become 0. */
export function toDecimal(value: Prisma.Decimal | number | string | null | undefined): Prisma.Decimal {
  if (value === null || value === undefined || value === "") return ZERO;
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

/** Decimal → plain number for JSON responses. Applied only at the boundary. */
export function toNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return value instanceof Prisma.Decimal ? value.toNumber() : Number(value);
}

/** Rounds to 2dp using half-up, the convention Indian retail receipts use. */
export function money(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

// =============================================================================
// EXPECTED CASH
// =============================================================================

export interface LedgerTotals {
  cashIn: Prisma.Decimal;
  cashOut: Prisma.Decimal;
}

/**
 * Folds a grouped CashTransaction aggregate into directional totals.
 *
 * Accepts the shape Prisma's `groupBy({ by: ["type"], _sum: { amount } })`
 * returns, so the repository can hand its result straight over without an
 * intermediate mapping that could silently drop a row type.
 */
export function foldLedger(
  rows: Array<{ type: CashTransactionType; _sum: { amount: Prisma.Decimal | null } }>
): LedgerTotals {
  let cashIn = ZERO;
  let cashOut = ZERO;

  for (const row of rows) {
    const amount = toDecimal(row._sum.amount);
    if (row.type === CashTransactionType.CASH_IN) cashIn = cashIn.plus(amount);
    else cashOut = cashOut.plus(amount);
  }

  return { cashIn, cashOut };
}

/** expectedCash = opening + cashIn − cashOut. */
export function calculateExpectedCash(
  openingCash: Prisma.Decimal | number,
  totals: LedgerTotals
): Prisma.Decimal {
  return money(toDecimal(openingCash).plus(totals.cashIn).minus(totals.cashOut));
}

export type VarianceKind = "BALANCED" | "OVER" | "SHORT";

export interface Variance {
  /** counted − expected. Positive = over (excess), negative = short. */
  difference: Prisma.Decimal;
  kind: VarianceKind;
  /** |difference| as a percentage of expected. 0 when expected is 0. */
  percentage: number;
  /** True when the shift cannot be closed without a stated reason. */
  requiresReason: boolean;
}

/**
 * Compares the physical count against the expected balance.
 *
 * `requiresReason` is ANY non-zero difference rather than a tolerance band.
 * A tolerance would mean a cashier can be quietly short by a fixed amount every
 * single shift and never be asked about it — which is precisely how systematic
 * shrinkage hides.
 */
export function calculateVariance(
  expected: Prisma.Decimal,
  counted: Prisma.Decimal | number
): Variance {
  const difference = money(toDecimal(counted).minus(expected));
  const isZero = difference.isZero();

  const percentage = expected.isZero()
    ? 0
    : Number(difference.abs().dividedBy(expected).times(100).toDecimalPlaces(2));

  return {
    difference,
    kind: isZero ? "BALANCED" : difference.isPositive() ? "OVER" : "SHORT",
    percentage,
    requiresReason: !isZero,
  };
}

// =============================================================================
// DENOMINATION COUNTING
// =============================================================================

/** Indian note/coin set, descending. Used to validate and total a cash count. */
export const DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

export interface DenominationLine {
  denomination: number;
  count: number;
  value: Prisma.Decimal;
}

export interface DenominationCount {
  lines: DenominationLine[];
  total: Prisma.Decimal;
}

/**
 * Totals a `{ "500": 4, "100": 7 }` denomination map.
 *
 * Unknown denominations are IGNORED rather than summed. Silently accepting a
 * "₹350 note" would let a typo in the key inflate the counted total and turn a
 * genuine shortage into an apparent surplus.
 */
export function countDenominations(map: Record<string, number> | null | undefined): DenominationCount {
  const lines: DenominationLine[] = [];
  let total = ZERO;

  if (!map) return { lines, total };

  for (const denomination of DENOMINATIONS) {
    const count = Number(map[String(denomination)] ?? 0);
    if (!Number.isFinite(count) || count <= 0) continue;

    const value = new Prisma.Decimal(denomination).times(Math.trunc(count));
    lines.push({ denomination, count: Math.trunc(count), value });
    total = total.plus(value);
  }

  return { lines, total: money(total) };
}

// =============================================================================
// SHIFT SALES BREAKDOWN
// =============================================================================

export interface PaymentRow {
  method: PaymentMethod;
  amount: Prisma.Decimal | number | null;
}

export interface SalesBreakdown {
  cash: Prisma.Decimal;
  upi: Prisma.Decimal;
  card: Prisma.Decimal;
  other: Prisma.Decimal;
  total: Prisma.Decimal;
}

/**
 * Buckets payment rows by tender.
 *
 * CREDIT, GIFT_CARD and OTHER collapse into `other` deliberately: from the
 * drawer's point of view they are all "not cash and not a card terminal", and
 * splitting them here would produce columns the shift summary has no room for
 * and no cashier can reconcile.
 */
export function bucketPayments(rows: PaymentRow[]): SalesBreakdown {
  let cash = ZERO;
  let upi = ZERO;
  let card = ZERO;
  let other = ZERO;

  for (const row of rows) {
    const amount = toDecimal(row.amount);
    switch (row.method) {
      case PaymentMethod.CASH: cash = cash.plus(amount); break;
      case PaymentMethod.UPI:  upi = upi.plus(amount);   break;
      case PaymentMethod.CARD: card = card.plus(amount); break;
      default:                 other = other.plus(amount);
    }
  }

  return {
    cash: money(cash),
    upi: money(upi),
    card: money(card),
    other: money(other),
    total: money(cash.plus(upi).plus(card).plus(other)),
  };
}

/** Whether a tender lands in the physical drawer. */
export function affectsDrawer(method: PaymentMethod): boolean {
  return method === PaymentMethod.CASH;
}

// =============================================================================
// SHIFT DURATION
// =============================================================================

/** Whole minutes between two instants. Negative spans clamp to 0. */
export function shiftDurationMinutes(openedAt: Date, closedAt: Date = new Date()): number {
  return Math.max(0, Math.floor((closedAt.getTime() - openedAt.getTime()) / 60_000));
}

/** "7h 24m" / "48m" — the shift-duration label used on screen and on exports. */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

// =============================================================================
// SESSION & DOCUMENT NUMBERING
// =============================================================================

/**
 * Builds a date-scoped document number, e.g. `SH-20260730-0003`.
 *
 * Date-scoped rather than globally sequential so the counter query only ever
 * scans one day's rows, and so a human reading a drop number can tell when it
 * happened without opening the record.
 */
export function buildDocumentNumber(prefix: string, date: Date, sequence: number): string {
  const stamp =
    `${date.getFullYear()}` +
    `${String(date.getMonth() + 1).padStart(2, "0")}` +
    `${String(date.getDate()).padStart(2, "0")}`;
  return `${prefix}-${stamp}-${String(sequence).padStart(4, "0")}`;
}

/** Extracts the trailing sequence from a document number; 0 when unparseable. */
export function parseDocumentSequence(documentNumber: string | null | undefined): number {
  if (!documentNumber) return 0;
  const tail = documentNumber.split("-").pop();
  const parsed = Number.parseInt(tail ?? "", 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}
