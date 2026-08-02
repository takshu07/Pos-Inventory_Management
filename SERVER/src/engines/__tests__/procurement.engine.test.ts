// =============================================================================
// PROCUREMENT ENGINE — regression tests
//
// These lock down the rules that the procurement milestone introduced, chosen
// for the places where a plausible-looking implementation is WRONG in a way
// that only surfaces as bad stock or bad money:
//
//   • A partial receipt must leave the order OPEN. Marking it RECEIVED strands
//     the outstanding units — nobody can ever book them in.
//   • Over-receipt must be REJECTED, not clamped. Clamping invents stock that
//     the supplier never shipped, which then reconciles against nothing.
//   • Receiving twice must not double-count. This is the bug the
//     `receivedQuantity` column exists to prevent.
//   • A new bill must owe its full total. It defaulted to 0 before this
//     milestone, which made every unpaid bill invisible to the payables queue.
//   • Outstanding must come from the BILLS, not (spend − paid), or an
//     on-account payment silently understates what is owed.
//
// Pure functions only — no database. The integration suite cannot run here:
// cleanDatabase() TRUNCATEs 33 tables and correctly refuses to run against a
// database whose name is not "test", and this project has only the live one.
// =============================================================================

import { describe, expect, it } from "vitest";
import { Prisma } from "../../../generated/prisma";

import {
  calculatePurchaseTotals,
  checkCancellable,
  deriveSupplierBalances,
  outstandingFor,
  planReceipt,
  projectBrandStats,
  summariseReceipt,
} from "../procurement.engine";
import { deriveSettlementStatus } from "../finance.engine";
import { hasMinimumRole } from "../../constants/roles";

const D = (n: number | string) => new Prisma.Decimal(n);

/** A purchase line, defaulting to nothing received yet. */
const line = (id: string, quantity: number, receivedQuantity = 0) => ({
  id,
  quantity,
  receivedQuantity,
});

// =============================================================================
// PURCHASE TOTALS
// =============================================================================

describe("calculatePurchaseTotals", () => {
  it("sums line extensions then applies discount and tax", () => {
    const totals = calculatePurchaseTotals(
      [
        { quantity: 10, costPrice: 100 },
        { quantity: 5, costPrice: 40 },
      ],
      200,
      50
    );

    expect(totals.subtotal).toBe(1_200);
    expect(totals.totalAmount).toBe(1_050); // 1200 - 200 + 50
  });

  it("returns a zero subtotal for an empty bill rather than NaN", () => {
    expect(calculatePurchaseTotals([], 0, 0)).toEqual({ subtotal: 0, totalAmount: 0 });
  });

  it("rejects a discount that drives the total negative", () => {
    // Flooring at zero would produce a bill whose total contradicts its lines.
    expect(() => calculatePurchaseTotals([{ quantity: 1, costPrice: 100 }], 500, 0)).toThrow(
      /cannot be negative/i
    );
  });

  it("allows a discount that exactly zeroes the bill", () => {
    expect(
      calculatePurchaseTotals([{ quantity: 2, costPrice: 50 }], 100, 0).totalAmount
    ).toBe(0);
  });
});

// =============================================================================
// PARTIAL RECEIVE
// =============================================================================

describe("planReceipt — receiving everything outstanding", () => {
  it("receives all open units when no instructions are given", () => {
    const plan = planReceipt([line("a", 10), line("b", 5)]);

    expect(plan.instructions).toEqual([
      { itemId: "a", quantity: 10 },
      { itemId: "b", quantity: 5 },
    ]);
    expect(plan.isFullyReceived).toBe(true);
    expect(plan.totalUnits).toBe(15);
  });

  it("receives only the REMAINDER of a part-received order", () => {
    // The regression this column exists for: booking `quantity` again here
    // would double-count the 4 units already on the shelf.
    const plan = planReceipt([line("a", 10, 4)]);

    expect(plan.instructions).toEqual([{ itemId: "a", quantity: 6 }]);
    expect(plan.isFullyReceived).toBe(true);
  });

  it("skips lines that are already complete", () => {
    const plan = planReceipt([line("a", 10, 10), line("b", 3)]);

    expect(plan.instructions).toEqual([{ itemId: "b", quantity: 3 }]);
    expect(plan.totalUnits).toBe(3);
  });

  it("refuses a receipt with nothing left to receive", () => {
    expect(() => planReceipt([line("a", 10, 10)])).toThrow(/already fully received/i);
  });
});

describe("planReceipt — partial instructions", () => {
  it("keeps the order OPEN when some units remain", () => {
    const plan = planReceipt([line("a", 10)], [{ itemId: "a", quantity: 4 }]);

    expect(plan.isFullyReceived).toBe(false);
    expect(plan.totalUnits).toBe(4);
  });

  it("closes the order only when the last unit lands", () => {
    const plan = planReceipt([line("a", 10, 6)], [{ itemId: "a", quantity: 4 }]);
    expect(plan.isFullyReceived).toBe(true);
  });

  it("stays open when ANOTHER line is still outstanding", () => {
    // A per-line check that forgot the siblings would call this complete and
    // strand line b forever.
    const plan = planReceipt(
      [line("a", 10), line("b", 5)],
      [{ itemId: "a", quantity: 10 }]
    );

    expect(plan.isFullyReceived).toBe(false);
  });

  it("drops zero-quantity lines so untouched rows can be submitted verbatim", () => {
    const plan = planReceipt(
      [line("a", 10), line("b", 5)],
      [
        { itemId: "a", quantity: 3 },
        { itemId: "b", quantity: 0 },
      ]
    );

    expect(plan.instructions).toEqual([{ itemId: "a", quantity: 3 }]);
  });

  it("refuses a receipt where every submitted line is zero", () => {
    expect(() =>
      planReceipt([line("a", 10)], [{ itemId: "a", quantity: 0 }])
    ).toThrow(/nothing to receive/i);
  });
});

describe("planReceipt — rejections", () => {
  it("rejects over-receipt rather than clamping it", () => {
    expect(() => planReceipt([line("a", 10)], [{ itemId: "a", quantity: 11 }])).toThrow(
      /only 10 remain outstanding/i
    );
  });

  it("counts already-received units when checking the cap", () => {
    // 10 ordered, 8 in — only 2 may still be received, even though 5 < 10.
    expect(() => planReceipt([line("a", 10, 8)], [{ itemId: "a", quantity: 5 }])).toThrow(
      /only 2 remain outstanding/i
    );
  });

  it("carries a structured reason so the UI can explain the refusal", () => {
    try {
      planReceipt([line("a", 10)], [{ itemId: "a", quantity: 99 }]);
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e.details).toMatchObject({ reason: "OVER_RECEIPT", outstanding: 10 });
    }
  });

  it("rejects a line that belongs to a different purchase", () => {
    expect(() => planReceipt([line("a", 10)], [{ itemId: "zzz", quantity: 1 }])).toThrow(
      /does not belong to this purchase/i
    );
  });

  it("rejects the same line submitted twice", () => {
    // Two entries of 6 against a 10-unit line each pass the cap individually
    // but total 12 — silently receiving both would over-book by 2.
    expect(() =>
      planReceipt(
        [line("a", 10)],
        [
          { itemId: "a", quantity: 6 },
          { itemId: "a", quantity: 6 },
        ]
      )
    ).toThrow(/submitted twice/i);
  });

  it("rejects a negative quantity", () => {
    expect(() => planReceipt([line("a", 10)], [{ itemId: "a", quantity: -5 }])).toThrow(
      /cannot be negative/i
    );
  });
});

// =============================================================================
// INVENTORY RECONCILIATION
// Stock booked in must equal units ordered — never more, never twice.
// =============================================================================

describe("inventory reconciliation across a sequence of receipts", () => {
  it("books exactly the ordered quantity across three partial receipts", () => {
    const lines = [line("a", 10)];
    let received = 0;

    for (const qty of [3, 5, 2]) {
      const plan = planReceipt(
        [line("a", 10, received)],
        [{ itemId: "a", quantity: qty }]
      );
      received += plan.totalUnits;
    }

    expect(received).toBe(10);
    expect(summariseReceipt([line("a", 10, received)]).isFullyReceived).toBe(true);
    // And a fourth receipt has nothing left to take.
    expect(() => planReceipt([line("a", 10, received)])).toThrow(/already fully received/i);
    expect(lines).toHaveLength(1);
  });

  it("never lets the running total exceed what was ordered", () => {
    let received = 4;
    // Whatever the user types, the cap is the outstanding balance.
    expect(() =>
      planReceipt([line("a", 10, received)], [{ itemId: "a", quantity: 7 }])
    ).toThrow(/only 6 remain/i);

    const plan = planReceipt([line("a", 10, received)], [{ itemId: "a", quantity: 6 }]);
    received += plan.totalUnits;
    expect(received).toBe(10);
  });

  it("outstandingFor never reports a negative balance", () => {
    // Defensive: if data ever drifts past the ordered quantity, the UI must not
    // render "-3 outstanding" or offer a negative receipt.
    expect(outstandingFor(line("a", 5, 8))).toBe(0);
  });
});

// =============================================================================
// RECEIPT PROGRESS
// =============================================================================

describe("summariseReceipt", () => {
  it("aggregates progress across lines", () => {
    const progress = summariseReceipt([line("a", 10, 5), line("b", 10, 0)]);

    expect(progress).toMatchObject({
      orderedUnits: 20,
      receivedUnits: 5,
      outstandingUnits: 15,
      isFullyReceived: false,
      percentReceived: 25,
    });
  });

  it("reports 100% only when everything is in", () => {
    expect(summariseReceipt([line("a", 4, 4)]).percentReceived).toBe(100);
    expect(summariseReceipt([line("a", 4, 4)]).isFullyReceived).toBe(true);
  });

  it("treats an empty purchase as 0%, not fully received", () => {
    // orderedUnits === 0 would make `received >= ordered` trivially true.
    expect(summariseReceipt([])).toMatchObject({
      percentReceived: 0,
      isFullyReceived: false,
    });
  });
});

// =============================================================================
// DUE AMOUNTS & PAYMENT SETTLEMENT
// =============================================================================

describe("due amount on a newly created bill", () => {
  it("owes the full total before anything is paid", () => {
    // THE REGRESSION: dueAmount used to default to 0, so a brand-new unpaid
    // bill reported nothing outstanding and never entered the payables queue.
    const settlement = deriveSettlementStatus({ total: D(1_000), paid: D(0) });

    expect(settlement.dueAmount.toNumber()).toBe(1_000);
    expect(settlement.status).toBe("UNPAID");
  });
});

describe("payment settlement", () => {
  it("moves to PARTIALLY_PAID and reduces the balance", () => {
    const s = deriveSettlementStatus({ total: D(300), paid: D(100) });
    expect(s.status).toBe("PARTIALLY_PAID");
    expect(s.dueAmount.toNumber()).toBe(200);
  });

  it("settles to PAID with a zero balance on full payment", () => {
    const s = deriveSettlementStatus({ total: D(300), paid: D(300) });
    expect(s.status).toBe("PAID");
    expect(s.dueAmount.toNumber()).toBe(0);
  });

  it("never reports a negative balance on overpayment", () => {
    const s = deriveSettlementStatus({ total: D(300), paid: D(400) });
    expect(s.dueAmount.toNumber()).toBe(0);
    expect(s.status).toBe("PAID");
  });

  it("reports OVERDUE ahead of PARTIALLY_PAID once past the due date", () => {
    // A half-paid bill three weeks late is overdue, not "partially paid" — the
    // status a payables screen sorts by must be the one demanding action.
    const s = deriveSettlementStatus({
      total: D(300),
      paid: D(100),
      dueDate: new Date("2020-01-01"),
    });
    expect(s.status).toBe("OVERDUE");
  });

  it("treats a bill with no agreed term as not overdue", () => {
    const s = deriveSettlementStatus({ total: D(300), paid: D(0), dueDate: null });
    expect(s.status).toBe("UNPAID");
  });

  it("a fully paid bill is never overdue", () => {
    const s = deriveSettlementStatus({
      total: D(300),
      paid: D(300),
      dueDate: new Date("2020-01-01"),
    });
    expect(s.status).toBe("PAID");
  });

  it("a cancelled bill owes nothing", () => {
    const s = deriveSettlementStatus({ total: D(300), paid: D(0), isCancelled: true });
    expect(s.status).toBe("CANCELLED");
    expect(s.dueAmount.toNumber()).toBe(0);
  });
});

// =============================================================================
// SUPPLIER BALANCES
// =============================================================================

describe("deriveSupplierBalances", () => {
  it("sums spend and outstanding across a supplier's bills", () => {
    const b = deriveSupplierBalances({
      purchaseCount: 3,
      totalSpend: D(1_000),
      paidOnBills: D(400),
      outstanding: D(600),
      totalPaid: D(400),
      paymentCount: 2,
    });

    expect(b).toMatchObject({
      purchaseCount: 3,
      totalSpend: 1_000,
      outstanding: 600,
      totalPaid: 400,
      onAccountCredit: 0,
    });
  });

  it("takes outstanding from the BILLS, not (spend − paid)", () => {
    // ₹500 was paid on account — not against any bill. The bills still owe
    // their full ₹1000. Deriving (1000 − 500) would claim only ₹500 is owed
    // and quietly under-report the liability.
    const b = deriveSupplierBalances({
      purchaseCount: 2,
      totalSpend: D(1_000),
      paidOnBills: D(0),
      outstanding: D(1_000),
      totalPaid: D(500),
      paymentCount: 1,
    });

    expect(b.outstanding).toBe(1_000);
    expect(b.onAccountCredit).toBe(500);
  });

  it("reports zero credit when every payment is bill-linked", () => {
    const b = deriveSupplierBalances({
      purchaseCount: 1,
      totalSpend: D(300),
      paidOnBills: D(100),
      outstanding: D(200),
      totalPaid: D(100),
      paymentCount: 1,
    });

    expect(b.onAccountCredit).toBe(0);
  });

  it("returns zeroes for a supplier with no history rather than NaN", () => {
    const b = deriveSupplierBalances({
      purchaseCount: 0,
      totalSpend: null,
      paidOnBills: null,
      outstanding: null,
      totalPaid: null,
      paymentCount: 0,
    });

    expect(b).toMatchObject({
      totalSpend: 0,
      outstanding: 0,
      totalPaid: 0,
      onAccountCredit: 0,
    });
  });

  it("does not accumulate floating-point noise in the credit figure", () => {
    const b = deriveSupplierBalances({
      purchaseCount: 1,
      totalSpend: D("100.10"),
      paidOnBills: D("0.10"),
      outstanding: D("100.00"),
      totalPaid: D("0.30"),
      paymentCount: 2,
    });

    // 0.30 - 0.10 is 0.19999… in binary floating point.
    expect(b.onAccountCredit).toBe(0.2);
  });
});

// =============================================================================
// BRAND STATISTICS
// =============================================================================

describe("projectBrandStats", () => {
  it("converts Postgres BIGINT and Decimal strings into plain numbers", () => {
    // COUNT returns BIGINT and SUM(numeric) returns a string; neither survives
    // JSON, and `bigint` throws on JSON.stringify.
    const stats = projectBrandStats({
      productCount: 12n,
      variantCount: 48n,
      unitsSold: 300n,
      revenue: "150000.50",
      stockUnits: 220n,
      stockValue: "44000.25",
    });

    expect(stats.productCount).toBe(12);
    expect(stats.variantCount).toBe(48);
    expect(stats.unitsSold).toBe(300);
    expect(stats.revenue).toBeCloseTo(150_000.5);
    expect(stats.stockValue).toBeCloseTo(44_000.25);
    expect(typeof stats.productCount).toBe("number");
  });

  it("computes the average selling price from revenue and units", () => {
    const stats = projectBrandStats({
      productCount: 1n,
      variantCount: 1n,
      unitsSold: 4n,
      revenue: "1000",
      stockUnits: 0n,
      stockValue: "0",
    });

    expect(stats.averageSellingPrice).toBe(250);
  });

  it("returns 0 rather than NaN when a brand has sold nothing", () => {
    const stats = projectBrandStats({
      productCount: 3n,
      variantCount: 9n,
      unitsSold: 0n,
      revenue: "0",
      stockUnits: 50n,
      stockValue: "5000",
    });

    expect(stats.averageSellingPrice).toBe(0);
    expect(Number.isNaN(stats.averageSellingPrice)).toBe(false);
  });

  it("treats a brand with no stat row as all-zero, not null", () => {
    // A brand with no products returns no row from the grouped query. Rendering
    // "—" there is indistinguishable from a failed query.
    expect(projectBrandStats(undefined)).toEqual({
      productCount: 0,
      variantCount: 0,
      unitsSold: 0,
      revenue: 0,
      stockUnits: 0,
      stockValue: 0,
      averageSellingPrice: 0,
    });
  });

  it("handles a null revenue from a COALESCE-free path", () => {
    const stats = projectBrandStats({
      productCount: 1n,
      variantCount: 1n,
      unitsSold: 0n,
      revenue: null,
      stockUnits: 0n,
      stockValue: null,
    });

    expect(stats.revenue).toBe(0);
    expect(stats.stockValue).toBe(0);
  });
});

// =============================================================================
// CANCELLATION RULES
// =============================================================================

describe("checkCancellable", () => {
  it("allows cancelling an untouched order", () => {
    expect(checkCancellable({ status: "ORDERED", receivedUnits: 0, paidAmount: 0 })).toBeNull();
  });

  it("refuses once ANY stock has been received", () => {
    // Reversing a receipt is a supplier return, not a side effect of cancelling
    // the paperwork — otherwise stock sits on the shelf backed by no order.
    expect(
      checkCancellable({ status: "PARTIAL", receivedUnits: 1, paidAmount: 0 })
    ).toBe("ALREADY_RECEIVED");
  });

  it("refuses once ANY money has been paid", () => {
    expect(
      checkCancellable({ status: "ORDERED", receivedUnits: 0, paidAmount: 0.5 })
    ).toBe("ALREADY_PAID");
  });

  it("refuses to cancel twice", () => {
    expect(
      checkCancellable({ status: "CANCELLED", receivedUnits: 0, paidAmount: 0 })
    ).toBe("ALREADY_CANCELLED");
  });

  it("reports the stock refusal ahead of the payment one", () => {
    // Both block, but received stock is the harder problem to unwind and is the
    // more useful thing to tell the user first.
    expect(
      checkCancellable({ status: "PARTIAL", receivedUnits: 5, paidAmount: 100 })
    ).toBe("ALREADY_RECEIVED");
  });
});

// =============================================================================
// RBAC
// Procurement is OWNER-only at the router level; these lock the hierarchy the
// route guards depend on.
// =============================================================================

describe("RBAC — procurement is owner-only", () => {
  it("admits an owner to an OWNER-gated route", () => {
    expect(hasMinimumRole("OWNER", "OWNER")).toBe(true);
  });

  it("refuses a manager", () => {
    // Managers are operational; purchases, suppliers and brands are business
    // administration. This is what the 403s on /brands, /suppliers and
    // /purchases rely on.
    expect(hasMinimumRole("MANAGER", "OWNER")).toBe(false);
  });

  it("refuses a cashier", () => {
    expect(hasMinimumRole("CASHIER", "OWNER")).toBe(false);
  });

  it("still lets an owner through a MANAGER-gated route", () => {
    // requireRole is a MINIMUM-role check, so the hierarchy must not invert.
    expect(hasMinimumRole("OWNER", "MANAGER")).toBe(true);
    expect(hasMinimumRole("MANAGER", "MANAGER")).toBe(true);
    expect(hasMinimumRole("CASHIER", "MANAGER")).toBe(false);
  });
});
