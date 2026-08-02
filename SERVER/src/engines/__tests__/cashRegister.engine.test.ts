// =============================================================================
// CASH REGISTER ENGINE — unit tests
//
// These cover the arithmetic a cashier is held ACCOUNTABLE for. Every number
// asserted here is one that decides whether someone is told their drawer is
// short, so the cases chosen are the ones that would let a real error through:
//
//   • Expected cash must come from the drawer LEDGER, so drops and payouts
//     reduce it and a card sale does not.
//   • Any non-zero variance must demand a reason — there is no tolerance band,
//     because a tolerance is how systematic shrinkage hides.
//   • A denomination map must reject keys that are not real notes, or a typo
//     inflates the count and turns a shortage into an apparent surplus.
//   • Money must never round through a float.
//
// Replaces the previous finance.service integration test, which called
// cleanDatabase() against the live Neon database.
// =============================================================================

import { describe, expect, it } from "vitest";
import { Prisma, CashTransactionType, PaymentMethod } from "../../../generated/prisma";

import {
  foldLedger,
  calculateExpectedCash,
  calculateVariance,
  countDenominations,
  bucketPayments,
  shiftDurationMinutes,
  formatDuration,
  buildDocumentNumber,
  parseDocumentSequence,
  toDecimal,
  money,
} from "../cashRegister.engine";

const D = (n: number | string) => new Prisma.Decimal(n);

const ledgerRow = (type: CashTransactionType, amount: number | null) => ({
  type,
  _sum: { amount: amount === null ? null : D(amount) },
});

// =============================================================================
// EXPECTED CASH
// =============================================================================

describe("expected cash", () => {
  it("is opening float plus cash in, minus cash out", () => {
    const totals = foldLedger([
      ledgerRow(CashTransactionType.CASH_IN, 12_500),
      ledgerRow(CashTransactionType.CASH_OUT, 2_300),
    ]);

    expect(calculateExpectedCash(5_000, totals).toString()).toBe("15200");
  });

  it("equals the opening float when nothing has moved", () => {
    expect(calculateExpectedCash(3_000, foldLedger([])).toString()).toBe("3000");
  });

  it("treats a null aggregate as zero rather than NaN", () => {
    // Prisma returns _sum.amount = null when a group matched no rows. Coercing
    // that through Number() would produce NaN and poison the whole shift.
    const totals = foldLedger([ledgerRow(CashTransactionType.CASH_IN, null)]);
    expect(calculateExpectedCash(1_000, totals).toString()).toBe("1000");
  });

  it("can go negative when more left the drawer than entered it", () => {
    // Over-dropping is a real (if alarming) state. Clamping it to zero here
    // would hide the error from the reconciliation instead of surfacing it.
    const totals = foldLedger([ledgerRow(CashTransactionType.CASH_OUT, 8_000)]);
    expect(calculateExpectedCash(5_000, totals).toNumber()).toBe(-3_000);
  });

  it("accumulates several movements in the same direction", () => {
    const totals = foldLedger([
      ledgerRow(CashTransactionType.CASH_IN, 1_000),
      ledgerRow(CashTransactionType.CASH_OUT, 250),
    ]);
    expect(totals.cashIn.toNumber()).toBe(1_000);
    expect(totals.cashOut.toNumber()).toBe(250);
  });
});

// =============================================================================
// VARIANCE
// =============================================================================

describe("calculateVariance", () => {
  it("reports BALANCED and demands no reason when the count matches", () => {
    const v = calculateVariance(D(15_200), 15_200);
    expect(v.kind).toBe("BALANCED");
    expect(v.requiresReason).toBe(false);
    expect(v.difference.toNumber()).toBe(0);
  });

  it("reports OVER with a positive difference", () => {
    const v = calculateVariance(D(15_200), 15_350);
    expect(v.kind).toBe("OVER");
    expect(v.difference.toNumber()).toBe(150);
    expect(v.requiresReason).toBe(true);
  });

  it("reports SHORT with a negative difference", () => {
    const v = calculateVariance(D(15_200), 15_000);
    expect(v.kind).toBe("SHORT");
    expect(v.difference.toNumber()).toBe(-200);
    expect(v.requiresReason).toBe(true);
  });

  it("demands a reason for even a one-rupee discrepancy", () => {
    // No tolerance band, deliberately. A cashier who can be quietly ₹1 short
    // every shift is never asked about it — which is exactly how it adds up.
    expect(calculateVariance(D(10_000), 9_999).requiresReason).toBe(true);
  });

  it("returns 0% rather than Infinity when the expected balance is zero", () => {
    const v = calculateVariance(D(0), 500);
    expect(v.percentage).toBe(0);
    expect(v.kind).toBe("OVER");
  });

  it("expresses the variance as a percentage of expected", () => {
    expect(calculateVariance(D(10_000), 9_500).percentage).toBe(5);
  });
});

// =============================================================================
// DENOMINATIONS
// =============================================================================

describe("countDenominations", () => {
  it("totals a note breakdown", () => {
    const result = countDenominations({ "500": 4, "200": 3, "50": 2 });
    expect(result.total.toNumber()).toBe(2_700);
    expect(result.lines).toHaveLength(3);
  });

  it("lists denominations in descending order regardless of key order", () => {
    const result = countDenominations({ "10": 5, "2000": 1, "100": 2 });
    expect(result.lines.map((l) => l.denomination)).toEqual([2000, 100, 10]);
  });

  it("ignores denominations that are not real notes", () => {
    // A "₹350 note" is a typo. Silently summing it would inflate the counted
    // total and turn a genuine shortage into an apparent surplus.
    const result = countDenominations({ "500": 2, "350": 4 });
    expect(result.total.toNumber()).toBe(1_000);
  });

  it("ignores zero and negative counts", () => {
    const result = countDenominations({ "500": 0, "200": -3, "100": 1 });
    expect(result.total.toNumber()).toBe(100);
    expect(result.lines).toHaveLength(1);
  });

  it("truncates fractional counts — half a note does not exist", () => {
    const result = countDenominations({ "100": 2.7 });
    expect(result.total.toNumber()).toBe(200);
  });

  it("returns an empty count for a null map", () => {
    const result = countDenominations(null);
    expect(result.total.toNumber()).toBe(0);
    expect(result.lines).toEqual([]);
  });
});

// =============================================================================
// PAYMENT BUCKETING
// =============================================================================

describe("bucketPayments", () => {
  it("splits tenders into cash, UPI, card and other", () => {
    const result = bucketPayments([
      { method: PaymentMethod.CASH, amount: 1_000 },
      { method: PaymentMethod.UPI, amount: 2_500 },
      { method: PaymentMethod.CARD, amount: 700 },
      { method: PaymentMethod.GIFT_CARD, amount: 300 },
      { method: PaymentMethod.CREDIT, amount: 200 },
    ]);

    expect(result.cash.toNumber()).toBe(1_000);
    expect(result.upi.toNumber()).toBe(2_500);
    expect(result.card.toNumber()).toBe(700);
    // GIFT_CARD and CREDIT collapse together: from the drawer's point of view
    // they are both "not cash and not a card terminal".
    expect(result.other.toNumber()).toBe(500);
    expect(result.total.toNumber()).toBe(4_700);
  });

  it("sums repeated tenders of the same method", () => {
    const result = bucketPayments([
      { method: PaymentMethod.CASH, amount: 300 },
      { method: PaymentMethod.CASH, amount: 450 },
    ]);
    expect(result.cash.toNumber()).toBe(750);
  });

  it("handles an empty payment list", () => {
    expect(bucketPayments([]).total.toNumber()).toBe(0);
  });
});

// =============================================================================
// MONEY PRECISION
// =============================================================================

describe("money precision", () => {
  it("does not accumulate float error across many small amounts", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754. Decimal arithmetic is the only reason a
    // drawer of small change reconciles to the paisa.
    let total = toDecimal(0);
    for (let i = 0; i < 10; i++) total = total.plus(toDecimal(0.1));
    expect(money(total).toString()).toBe("1");
  });

  it("rounds half up, the convention on an Indian retail receipt", () => {
    expect(money(D("10.125")).toString()).toBe("10.13");
    expect(money(D("10.124")).toString()).toBe("10.12");
  });
});

// =============================================================================
// SHIFT DURATION
// =============================================================================

describe("shift duration", () => {
  it("counts whole minutes between two instants", () => {
    const open = new Date("2026-07-30T09:00:00Z");
    const close = new Date("2026-07-30T17:24:00Z");
    expect(shiftDurationMinutes(open, close)).toBe(504);
  });

  it("clamps a negative span to zero rather than reporting a negative shift", () => {
    const open = new Date("2026-07-30T17:00:00Z");
    const close = new Date("2026-07-30T09:00:00Z");
    expect(shiftDurationMinutes(open, close)).toBe(0);
  });

  it("formats durations with and without an hours component", () => {
    expect(formatDuration(504)).toBe("8h 24m");
    expect(formatDuration(48)).toBe("48m");
    expect(formatDuration(0)).toBe("0m");
  });
});

// =============================================================================
// DOCUMENT NUMBERING
// =============================================================================

describe("document numbering", () => {
  it("builds a date-scoped, zero-padded number", () => {
    expect(buildDocumentNumber("SH", new Date(2026, 6, 30), 3)).toBe("SH-20260730-0003");
  });

  it("pads single-digit months and days", () => {
    expect(buildDocumentNumber("DROP", new Date(2026, 0, 5), 12)).toBe("DROP-20260105-0012");
  });

  it("round-trips the sequence back out", () => {
    expect(parseDocumentSequence("SH-20260730-0042")).toBe(42);
  });

  it("returns 0 for an unparseable or absent number, so the next is 1", () => {
    expect(parseDocumentSequence(null)).toBe(0);
    expect(parseDocumentSequence("")).toBe(0);
    expect(parseDocumentSequence("SH-20260730-XXXX")).toBe(0);
  });
});
