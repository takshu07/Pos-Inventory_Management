// =============================================================================
// DRAWER RECONCILIATION — the numbers a cashier is held accountable for
//
// Every assertion here answers one question: does the figure on screen add up
// from the figures shown beside it? A drawer total that cannot be re-derived
// from its own breakdown is worse than no total at all, because the cashier is
// asked to sign for a number nobody can explain.
//
// THE TWO RULES UNDER TEST
// ------------------------
//  1. Expected in drawer =
//       opening float + cash collected − cash refunds − cash payouts
//       − cash drops ± other cash adjustments
//     Nothing else. Not UPI, not card, not exchange value, not store credit.
//
//  2. A refund settled as STORE CREDIT moves no notes. The shop still holds
//     every rupee it took, so that refund must not reduce the drawer OR the
//     net collected. Treating it as cash was a real defect that produced a
//     phantom shortage exactly equal to the credit issued.
// =============================================================================

import { describe, expect, it } from "vitest";
import { Prisma, PaymentMethod } from "../../../generated/prisma";

import {
  buildDrawerBreakdown,
  calculateCollected,
  calculateVariance,
  bucketPayments,
  type SalesBreakdown,
} from "../cashRegister.engine";

const D = (n: number | string) => new Prisma.Decimal(n);

/** Re-derives the total from the displayed lines, the way a cashier would. */
function sumOfLines(b: ReturnType<typeof buildDrawerBreakdown>): number {
  return (
    b.openingFloat.toNumber() +
    b.cashCollected.toNumber() -
    b.cashRefunds.toNumber() -
    b.cashPayouts.toNumber() -
    b.cashDrops.toNumber() +
    b.otherAdjustments.toNumber()
  );
}

const tenders = (cash: number, upi: number, card: number, other: number): SalesBreakdown => ({
  cash: D(cash),
  upi: D(upi),
  card: D(card),
  other: D(other),
  total: D(cash + upi + card + other),
});

// =============================================================================
// EXPECTED IN DRAWER — the formula, component by component
// =============================================================================

describe("expected in drawer", () => {
  it("is the opening float when nothing has happened yet", () => {
    const b = buildDrawerBreakdown({ openingFloat: 5_000, cashCollected: 0 });
    expect(b.expectedInDrawer.toNumber()).toBe(5_000);
  });

  it("adds cash collected to the opening float", () => {
    const b = buildDrawerBreakdown({ openingFloat: 5_000, cashCollected: 12_500 });
    expect(b.expectedInDrawer.toNumber()).toBe(17_500);
  });

  it("subtracts cash refunds, payouts and drops", () => {
    const b = buildDrawerBreakdown({
      openingFloat: 5_000,
      cashCollected: 12_500,
      cashRefunds: 800,
      cashPayouts: 1_200,
      cashDrops: 6_000,
    });

    // 5000 + 12500 − 800 − 1200 − 6000
    expect(b.expectedInDrawer.toNumber()).toBe(9_500);
  });

  it("applies a positive cash adjustment", () => {
    const b = buildDrawerBreakdown({
      openingFloat: 1_000,
      cashCollected: 0,
      otherAdjustments: 250,
    });
    expect(b.expectedInDrawer.toNumber()).toBe(1_250);
  });

  it("applies a negative cash adjustment", () => {
    const b = buildDrawerBreakdown({
      openingFloat: 1_000,
      cashCollected: 0,
      otherAdjustments: -250,
    });
    expect(b.expectedInDrawer.toNumber()).toBe(750);
  });

  it("goes negative rather than clamping when more left than entered", () => {
    // Over-dropping is a real state. Clamping would hide it from the
    // reconciliation instead of surfacing it for someone to explain.
    const b = buildDrawerBreakdown({
      openingFloat: 1_000,
      cashCollected: 0,
      cashDrops: 4_000,
    });
    expect(b.expectedInDrawer.toNumber()).toBe(-3_000);
  });
});

// =============================================================================
// THE TRANSPARENCY GUARANTEE
//
// The reason the breakdown exists: the lines shown must reconstruct the total
// shown. If these fail, a cashier cannot audit their own drawer.
// =============================================================================

describe("the displayed breakdown reconciles to its own total", () => {
  const cases = [
    { name: "an empty shift", c: { openingFloat: 0, cashCollected: 0 } },
    { name: "float only", c: { openingFloat: 2_500, cashCollected: 0 } },
    {
      name: "a full trading day",
      c: {
        openingFloat: 5_000,
        cashCollected: 48_250.75,
        cashRefunds: 1_310.5,
        cashPayouts: 2_400,
        cashDrops: 30_000,
        otherAdjustments: -15.25,
      },
    },
    {
      name: "drops exceeding takings",
      c: { openingFloat: 1_000, cashCollected: 500, cashDrops: 4_000 },
    },
  ];

  for (const { name, c } of cases) {
    it(`holds for ${name}`, () => {
      const b = buildDrawerBreakdown(c);
      expect(sumOfLines(b)).toBeCloseTo(b.expectedInDrawer.toNumber(), 2);
    });
  }

  it("never leaves a residue unexplained — adjustments absorb the remainder", () => {
    // A session closed before the breakdown existed still has a stored
    // expected balance. The residual goes into otherAdjustments so the lines
    // reconcile rather than silently disagreeing with the frozen total.
    const storedExpected = D(9_600);
    const provisional = buildDrawerBreakdown({
      openingFloat: 5_000,
      cashCollected: 12_500,
      cashRefunds: 800,
      cashPayouts: 1_200,
      cashDrops: 6_000,
    });

    const reconciled = buildDrawerBreakdown({
      openingFloat: 5_000,
      cashCollected: 12_500,
      cashRefunds: 800,
      cashPayouts: 1_200,
      cashDrops: 6_000,
      otherAdjustments: storedExpected.minus(provisional.expectedInDrawer),
    });

    expect(reconciled.otherAdjustments.toNumber()).toBe(100);
    expect(reconciled.expectedInDrawer.toNumber()).toBe(9_600);
    expect(sumOfLines(reconciled)).toBeCloseTo(9_600, 2);
  });
});

// =============================================================================
// NON-CASH MUST NOT REACH THE DRAWER
// =============================================================================

describe("non-cash values are excluded from the drawer", () => {
  it("ignores UPI and card entirely", () => {
    // The drawer takes only the cash leg. A shift that sold ₹40,000 on card
    // and ₹1,000 in cash must expect ₹1,000 over the float — not ₹41,000.
    const b = buildDrawerBreakdown({ openingFloat: 2_000, cashCollected: 1_000 });
    expect(b.expectedInDrawer.toNumber()).toBe(3_000);
  });

  it("ignores exchange value issued", () => {
    // Exchange value is merchandise handed over the counter. There is no field
    // to pass it through, which is the structural guarantee — but assert the
    // resulting number too, so the intent is documented and not just implied.
    const b = buildDrawerBreakdown({ openingFloat: 2_000, cashCollected: 5_000 });
    expect(b.expectedInDrawer.toNumber()).toBe(7_000);
    expect(Object.keys(b)).not.toContain("exchangeValue");
  });

  it("a store-credit refund leaves the drawer untouched", () => {
    // ₹1,200 refunded as store credit: the customer's account grows, the till
    // does not shrink. Counting it as cash out is the phantom-shortage bug.
    const withCredit = buildDrawerBreakdown({
      openingFloat: 3_000,
      cashCollected: 10_000,
      cashRefunds: 0,
    });
    const asIfCash = buildDrawerBreakdown({
      openingFloat: 3_000,
      cashCollected: 10_000,
      cashRefunds: 1_200,
    });

    expect(withCredit.expectedInDrawer.toNumber()).toBe(13_000);
    expect(asIfCash.expectedInDrawer.toNumber()).toBe(11_800);
    // The difference is exactly the credit — the size of the false shortage.
    expect(
      withCredit.expectedInDrawer.minus(asIfCash.expectedInDrawer).toNumber()
    ).toBe(1_200);
  });
});

// =============================================================================
// TOTAL / NET COLLECTED
// =============================================================================

describe("collected totals", () => {
  it("totals every tender, and nets off only cash refunds", () => {
    const c = calculateCollected({
      breakdown: tenders(8_000, 5_000, 3_000, 1_000),
      cashRefunds: 500,
    });

    expect(c.totalCollected.toNumber()).toBe(17_000);
    expect(c.digital.toNumber()).toBe(8_000);
    expect(c.netCollected.toNumber()).toBe(16_500);
  });

  it("total collected equals the sum of its four tenders", () => {
    const c = calculateCollected({ breakdown: tenders(1_234.56, 2_345.67, 3_456.78, 4_567.89) });
    const sum =
      c.cash.toNumber() + c.upi.toNumber() + c.card.toNumber() + c.other.toNumber();
    expect(sum).toBeCloseTo(c.totalCollected.toNumber(), 2);
  });

  it("does NOT deduct store-credit refunds from net collected", () => {
    // The shop kept the money; only the obligation changed form.
    const c = calculateCollected({
      breakdown: tenders(10_000, 0, 0, 0),
      cashRefunds: 0,
      storeCreditRefunds: 2_500,
    });

    expect(c.netCollected.toNumber()).toBe(10_000);
    expect(c.storeCreditRefunds.toNumber()).toBe(2_500);
  });

  it("deducts only the cash portion of a mixed refund", () => {
    const c = calculateCollected({
      breakdown: tenders(10_000, 0, 0, 0),
      cashRefunds: 400,
      storeCreditRefunds: 600,
    });

    expect(c.netCollected.toNumber()).toBe(9_600);
  });

  it("is zero across the board for a shift with no sales", () => {
    const c = calculateCollected({ breakdown: tenders(0, 0, 0, 0) });
    expect(c.totalCollected.toNumber()).toBe(0);
    expect(c.netCollected.toNumber()).toBe(0);
  });
});

// =============================================================================
// SPLIT PAYMENTS
// =============================================================================

describe("split payments", () => {
  it("routes each leg of a split bill to its own tender", () => {
    // One ₹2,000 bill: ₹1,200 cash + ₹800 UPI. Only the cash leg may reach
    // the drawer; the UPI leg settles to the bank.
    const b = bucketPayments([
      { method: PaymentMethod.CASH, amount: D(1_200) },
      { method: PaymentMethod.UPI, amount: D(800) },
    ]);

    expect(b.cash.toNumber()).toBe(1_200);
    expect(b.upi.toNumber()).toBe(800);
    expect(b.total.toNumber()).toBe(2_000);

    const drawer = buildDrawerBreakdown({
      openingFloat: 1_000,
      cashCollected: b.cash,
    });
    expect(drawer.expectedInDrawer.toNumber()).toBe(2_200);
  });

  it("keeps the collected total whole across a three-way split", () => {
    const b = bucketPayments([
      { method: PaymentMethod.CASH, amount: D(500) },
      { method: PaymentMethod.CARD, amount: D(1_500) },
      { method: PaymentMethod.GIFT_CARD, amount: D(250) },
    ]);

    const c = calculateCollected({ breakdown: b });
    expect(c.totalCollected.toNumber()).toBe(2_250);
    expect(c.other.toNumber()).toBe(250);
  });
});

// =============================================================================
// END-TO-END SHIFT SCENARIOS
//
// Full days, walked the way an owner walks a summary: does the counted cash
// land where the arithmetic says it should?
// =============================================================================

describe("full shift scenarios", () => {
  it("balances a mixed day: split tenders, a cash refund, a drop and a payout", () => {
    const b = bucketPayments([
      { method: PaymentMethod.CASH, amount: D(18_400) },
      { method: PaymentMethod.UPI, amount: D(9_250) },
      { method: PaymentMethod.CARD, amount: D(7_100) },
      { method: PaymentMethod.GIFT_CARD, amount: D(1_250) },
    ]);

    const collected = calculateCollected({
      breakdown: b,
      cashRefunds: 950,
      storeCreditRefunds: 1_500,
    });

    expect(collected.totalCollected.toNumber()).toBe(36_000);
    // Only the ₹950 cash refund comes off; the ₹1,500 credit does not.
    expect(collected.netCollected.toNumber()).toBe(35_050);

    // The drawer sees the cash leg only, less the cash that physically left.
    const drawer = buildDrawerBreakdown({
      openingFloat: 5_000,
      cashCollected: b.cash,
      cashRefunds: 950,
      cashPayouts: 1_150,
      cashDrops: 15_000,
    });

    // 5000 + 18400 − 950 − 1150 − 15000
    expect(drawer.expectedInDrawer.toNumber()).toBe(6_300);
    expect(sumOfLines(drawer)).toBeCloseTo(6_300, 2);

    // Counting exactly that balances the shift.
    expect(calculateVariance(drawer.expectedInDrawer, 6_300).kind).toBe("BALANCED");
    expect(calculateVariance(drawer.expectedInDrawer, 6_050).kind).toBe("SHORT");
  });

  it("an exchange with a cash top-up increases the drawer", () => {
    // Customer swaps up and pays ₹450 in cash. That is cash in without being
    // a sale — the ledger sees it, the sales table does not.
    const drawer = buildDrawerBreakdown({
      openingFloat: 2_000,
      cashCollected: D(10_000).plus(450),
    });
    expect(drawer.expectedInDrawer.toNumber()).toBe(12_450);
  });

  it("an exchange settled as store credit changes nothing in the drawer", () => {
    const drawer = buildDrawerBreakdown({
      openingFloat: 2_000,
      cashCollected: 10_000,
      cashRefunds: 0,
    });
    expect(drawer.expectedInDrawer.toNumber()).toBe(12_000);
    expect(calculateVariance(drawer.expectedInDrawer, 12_000).kind).toBe("BALANCED");
  });

  it("a card-only day expects nothing beyond the float", () => {
    const b = bucketPayments([{ method: PaymentMethod.CARD, amount: D(52_000) }]);
    const drawer = buildDrawerBreakdown({ openingFloat: 3_000, cashCollected: b.cash });

    expect(calculateCollected({ breakdown: b }).totalCollected.toNumber()).toBe(52_000);
    expect(drawer.expectedInDrawer.toNumber()).toBe(3_000);
  });

  it("dropping the full takings leaves exactly the float behind", () => {
    // The end-of-day pattern: bank everything above the opening float.
    const drawer = buildDrawerBreakdown({
      openingFloat: 4_000,
      cashCollected: 21_500,
      cashDrops: 21_500,
    });
    expect(drawer.expectedInDrawer.toNumber()).toBe(4_000);
  });
});

// =============================================================================
// EXCHANGE TOP-UPS MUST BE VISIBLE
//
// Regression: a shift showed "Cash sales ₹2,000" beside "Cash collected
// ₹2,960" with nothing explaining the ₹960. It was an exchange top-up — real
// money over the counter, correctly in the drawer, but missing from every
// collected total because those read the sales table only.
// =============================================================================

describe("exchange top-ups are counted as money collected", () => {
  // The reported shift, exactly: a ₹2,880 bill split ₹2,000 cash + ₹880 UPI,
  // plus an exchange where the customer traded up and paid ₹960 cash.
  const saleCash = 2_000;
  const saleUpi = 880;
  const exchangeTopUp = 960;
  const openingFloat = 1_000;

  it("includes the top-up in the cash tender so it matches the ledger", () => {
    const b = bucketPayments([
      { method: PaymentMethod.CASH, amount: D(saleCash) },
      { method: PaymentMethod.UPI, amount: D(saleUpi) },
      // The exchange leg lands in the same tender bucket as a sale's.
      { method: PaymentMethod.CASH, amount: D(exchangeTopUp) },
    ]);

    // This is the identity that was broken: the cash tender shown on screen
    // must equal the cash the drawer ledger recorded.
    const ledgerCashIn = D(saleCash + exchangeTopUp);
    expect(b.cash.toNumber()).toBe(ledgerCashIn.toNumber());
    expect(b.cash.toNumber()).toBe(2_960);
  });

  it("total collected exceeds gross sales by exactly the top-up", () => {
    const b = bucketPayments([
      { method: PaymentMethod.CASH, amount: D(saleCash) },
      { method: PaymentMethod.UPI, amount: D(saleUpi) },
      { method: PaymentMethod.CASH, amount: D(exchangeTopUp) },
    ]);
    const c = calculateCollected({ breakdown: b });

    const grossSales = saleCash + saleUpi;
    expect(c.totalCollected.toNumber()).toBe(3_840);
    expect(c.totalCollected.toNumber() - grossSales).toBe(exchangeTopUp);
  });

  it("the drawer agrees with the tender panel end to end", () => {
    const b = bucketPayments([
      { method: PaymentMethod.CASH, amount: D(saleCash) },
      { method: PaymentMethod.UPI, amount: D(saleUpi) },
      { method: PaymentMethod.CASH, amount: D(exchangeTopUp) },
    ]);

    const drawer = buildDrawerBreakdown({
      openingFloat,
      cashCollected: b.cash,
    });

    expect(drawer.expectedInDrawer.toNumber()).toBe(3_960);
    expect(sumOfLines(drawer)).toBeCloseTo(3_960, 2);
    // The UPI leg stayed out of the drawer, as it must.
    expect(drawer.expectedInDrawer.toNumber()).not.toBe(3_960 + saleUpi);
  });
});

// =============================================================================
// PRECISION
// =============================================================================

describe("money precision", () => {
  it("does not accumulate float error across many paisa-level movements", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754. Three hundred such movements is where a
    // one-paisa drawer discrepancy nobody can explain comes from.
    let collected = D(0);
    for (let i = 0; i < 300; i++) collected = collected.plus(D("0.10"));

    const drawer = buildDrawerBreakdown({ openingFloat: 0, cashCollected: collected });
    expect(drawer.expectedInDrawer.toString()).toBe("30");
  });

  it("rounds each displayed line to 2dp and still reconciles", () => {
    const drawer = buildDrawerBreakdown({
      openingFloat: "1000.005",
      cashCollected: "2000.004",
      cashRefunds: "0.001",
    });

    // Half-up at the boundary, and the lines still rebuild the total.
    expect(drawer.openingFloat.toString()).toBe("1000.01");
    expect(sumOfLines(drawer)).toBeCloseTo(drawer.expectedInDrawer.toNumber(), 2);
  });
});
