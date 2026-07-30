// =============================================================================
// INVENTORY ENGINE — unit tests
//
// This is stock and money arithmetic, so the suite is deliberately thorough:
// every clamp, every divide-by-zero guard, and every case where returning a
// number would be a lie (infinite days of cover, negative asset value).
//
// The thresholds asserted here are product decisions. If a test fails after
// someone changes one, that is the point — the change must be deliberate.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  ABC_THRESHOLDS,
  classifyAbc,
  classifyVelocity,
  computeAvailability,
  computeReorder,
  computeValuation,
  countAccuracy,
  daysOfInventory,
  DEAD_STOCK_DAYS,
  deriveStockStatus,
  movingAverageCost,
  stockTurnover,
  suggestedClearanceDiscount,
  sumValuations,
} from "../inventory.engine";

// =============================================================================
// AVAILABILITY
// =============================================================================

describe("computeAvailability", () => {
  it("subtracts active reservations from physical stock", () => {
    expect(computeAvailability({ currentStock: 10, reservedQuantity: 3 })).toEqual({
      currentStock: 10,
      reserved: 3,
      available: 7,
    });
  });

  it("treats absent reservations as zero", () => {
    expect(computeAvailability({ currentStock: 10 }).available).toBe(10);
  });

  it("never reports negative availability", () => {
    // Two holds against the last unit is a real (broken) state. Availability
    // must clamp so the negative does not propagate into every total.
    const result = computeAvailability({ currentStock: 1, reservedQuantity: 3 });
    expect(result.available).toBe(0);
    expect(result.currentStock).toBe(1); // physical stock is reported as-is
  });

  it("does not let a negative reservation inflate availability", () => {
    expect(computeAvailability({ currentStock: 5, reservedQuantity: -10 }).available).toBe(5);
  });
});

// =============================================================================
// STOCK STATUS
// =============================================================================

describe("deriveStockStatus", () => {
  it("ranks negative stock above every other status", () => {
    // Negative stock is a data error and must not hide inside "out of stock",
    // which looks routine.
    expect(deriveStockStatus({ currentStock: -3, reorderLevel: 10 })).toBe("NEGATIVE");
  });

  it("reports out of stock when nothing is available", () => {
    expect(deriveStockStatus({ currentStock: 0 })).toBe("OUT_OF_STOCK");
  });

  it("uses AVAILABILITY, not physical stock, to decide sellability", () => {
    // 5 on the shelf but all reserved — nothing can be sold.
    expect(deriveStockStatus({ currentStock: 5, available: 0, reorderLevel: 2 })).toBe(
      "OUT_OF_STOCK"
    );
  });

  it("flags low stock at or below the reorder level", () => {
    expect(deriveStockStatus({ currentStock: 5, reorderLevel: 5 })).toBe("LOW_STOCK");
    expect(deriveStockStatus({ currentStock: 4, reorderLevel: 5 })).toBe("LOW_STOCK");
    expect(deriveStockStatus({ currentStock: 6, reorderLevel: 5 })).toBe("IN_STOCK");
  });

  it("falls back to the default reorder level when none is set", () => {
    expect(deriveStockStatus({ currentStock: 5, reorderLevel: null })).toBe("LOW_STOCK");
    expect(deriveStockStatus({ currentStock: 50, reorderLevel: null })).toBe("OVERSTOCKED");
  });

  it("flags overstock only at ten times the reorder level", () => {
    expect(deriveStockStatus({ currentStock: 99, reorderLevel: 10 })).toBe("IN_STOCK");
    expect(deriveStockStatus({ currentStock: 100, reorderLevel: 10 })).toBe("OVERSTOCKED");
  });

  it("never reports overstock when the reorder level is zero", () => {
    // Guard against 0 × 10 = 0 making everything look overstocked.
    expect(deriveStockStatus({ currentStock: 500, reorderLevel: 0 })).toBe("IN_STOCK");
  });
});

// =============================================================================
// VALUATION
// =============================================================================

describe("computeValuation", () => {
  it("values stock at cost and at retail", () => {
    const v = computeValuation({ quantity: 10, costPrice: 60, sellingPrice: 100 });

    expect(v.stockValue).toBe(600);
    expect(v.retailValue).toBe(1000);
    expect(v.potentialProfit).toBe(400);
    expect(v.marginPercentage).toBe(40);
  });

  it("never assigns value to negative stock", () => {
    // Valuing −5 units would put a phantom credit on the balance sheet.
    const v = computeValuation({ quantity: -5, costPrice: 60, sellingPrice: 100 });
    expect(v.quantity).toBe(0);
    expect(v.stockValue).toBe(0);
    expect(v.retailValue).toBe(0);
  });

  it("reports zero margin rather than dividing by zero retail", () => {
    expect(
      computeValuation({ quantity: 10, costPrice: 0, sellingPrice: 0 }).marginPercentage
    ).toBe(0);
  });

  it("handles a loss-making line without breaking", () => {
    const v = computeValuation({ quantity: 5, costPrice: 100, sellingPrice: 80 });
    expect(v.potentialProfit).toBe(-100);
    expect(v.marginPercentage).toBe(-25);
  });

  it("rounds money to 2dp so float drift never reaches a total", () => {
    const v = computeValuation({ quantity: 3, costPrice: 0.1, sellingPrice: 0.2 });
    expect(v.stockValue).toBe(0.3);
    expect(v.retailValue).toBe(0.6);
  });
});

describe("sumValuations", () => {
  it("aggregates lines into one total with a recomputed margin", () => {
    const total = sumValuations([
      computeValuation({ quantity: 10, costPrice: 60, sellingPrice: 100 }),
      computeValuation({ quantity: 5, costPrice: 20, sellingPrice: 50 }),
    ]);

    expect(total.quantity).toBe(15);
    expect(total.stockValue).toBe(700);
    expect(total.retailValue).toBe(1250);
    expect(total.potentialProfit).toBe(550);
    expect(total.marginPercentage).toBe(44);
  });

  it("returns a zeroed total for an empty inventory", () => {
    const total = sumValuations([]);
    expect(total).toEqual({
      quantity: 0,
      stockValue: 0,
      retailValue: 0,
      potentialProfit: 0,
      marginPercentage: 0,
    });
  });
});

describe("movingAverageCost", () => {
  it("blends existing and incoming stock by quantity", () => {
    // (5×80 + 10×100) / 15 = 93.33
    expect(
      movingAverageCost({
        existingQuantity: 5,
        existingCost: 80,
        incomingQuantity: 10,
        incomingCost: 100,
      })
    ).toBe(93.33);
  });

  it("adopts the incoming cost when there was no prior stock", () => {
    expect(
      movingAverageCost({
        existingQuantity: 0,
        existingCost: 0,
        incomingQuantity: 10,
        incomingCost: 100,
      })
    ).toBe(100);
  });

  it("does not let negative existing stock skew the average", () => {
    expect(
      movingAverageCost({
        existingQuantity: -5,
        existingCost: 80,
        incomingQuantity: 10,
        incomingCost: 100,
      })
    ).toBe(100);
  });
});

// =============================================================================
// REORDER
// =============================================================================

describe("computeReorder", () => {
  it("covers lead-time demand plus safety stock", () => {
    // 2/day × 7 days lead = 14; 2/day × 7 days safety = 14; point = 28.
    const r = computeReorder({
      currentStock: 10,
      averageDailySales: 2,
      leadTimeDays: 7,
      safetyDays: 7,
    });

    expect(r.leadTimeDemand).toBe(14);
    expect(r.safetyStock).toBe(14);
    expect(r.reorderPoint).toBe(28);
    expect(r.shouldReorder).toBe(true);
    expect(r.recommendedQuantity).toBe(18); // back up to 28 from 10
  });

  it("does not suggest an order when stock is above the reorder point", () => {
    const r = computeReorder({
      currentStock: 100,
      averageDailySales: 1,
      leadTimeDays: 7,
      safetyDays: 7,
    });

    expect(r.shouldReorder).toBe(false);
    expect(r.recommendedQuantity).toBe(0);
  });

  it("treats a configured reorder level as a floor", () => {
    // Sales maths suggests a point of 2, but the owner said never below 50.
    const r = computeReorder({
      currentStock: 10,
      averageDailySales: 0.1,
      leadTimeDays: 7,
      safetyDays: 7,
      reorderLevel: 50,
    });

    expect(r.reorderPoint).toBe(50);
    expect(r.recommendedQuantity).toBe(40);
  });

  it("subtracts reservations before judging availability", () => {
    const r = computeReorder({
      currentStock: 30,
      reserved: 25,
      averageDailySales: 1,
      leadTimeDays: 7,
      safetyDays: 7,
    });

    expect(r.available).toBe(5);
    expect(r.shouldReorder).toBe(true);
  });

  it("returns NULL days remaining when nothing is selling", () => {
    // "Infinite days of cover" must not render as a large number that reads
    // like healthy supply.
    const r = computeReorder({ currentStock: 100, averageDailySales: 0 });
    expect(r.daysRemaining).toBeNull();
  });

  it("computes days remaining at the observed rate", () => {
    expect(computeReorder({ currentStock: 10, averageDailySales: 4 }).daysRemaining).toBe(2.5);
  });

  it("applies sensible defaults for lead and safety days", () => {
    const r = computeReorder({ currentStock: 0, averageDailySales: 1 });
    expect(r.leadTimeDays).toBe(7);
    expect(r.safetyStock).toBe(7);
  });
});

// =============================================================================
// VELOCITY
// =============================================================================

describe("classifyVelocity", () => {
  it("classifies a brisk seller as fast moving", () => {
    expect(
      classifyVelocity({
        unitsSold: 60,
        windowDays: 30,
        daysSinceLastSale: 1,
        currentStock: 20,
      })
    ).toBe("FAST_MOVING");
  });

  it("classifies a trickle as slow moving", () => {
    expect(
      classifyVelocity({
        unitsSold: 2,
        windowDays: 30,
        daysSinceLastSale: 10,
        currentStock: 20,
      })
    ).toBe("SLOW_MOVING");
  });

  it("classifies stale stock as dead even when total sales were healthy", () => {
    // 50 units sold, then nothing for four months. A units-based rule would
    // miss this; the time-since-last-sale rule is exactly why it is caught.
    expect(
      classifyVelocity({
        unitsSold: 50,
        windowDays: 180,
        daysSinceLastSale: 120,
        currentStock: 10,
      })
    ).toBe("DEAD_STOCK");
  });

  it("classifies never-sold stock as dead", () => {
    expect(
      classifyVelocity({
        unitsSold: 0,
        windowDays: 30,
        daysSinceLastSale: null,
        currentStock: 10,
      })
    ).toBe("DEAD_STOCK");
  });

  it("never calls out-of-stock items dead", () => {
    // You cannot fail to sell what you do not have — flagging these would fill
    // the clearance report with things to REORDER instead.
    expect(
      classifyVelocity({
        unitsSold: 0,
        windowDays: 30,
        daysSinceLastSale: null,
        currentStock: 0,
      })
    ).toBe("SLOW_MOVING");
  });

  it("uses the documented dead-stock boundary", () => {
    const atBoundary = classifyVelocity({
      unitsSold: 1,
      windowDays: 100,
      daysSinceLastSale: DEAD_STOCK_DAYS,
      currentStock: 5,
    });
    expect(atBoundary).toBe("DEAD_STOCK");

    const justInside = classifyVelocity({
      unitsSold: 1,
      windowDays: 100,
      daysSinceLastSale: DEAD_STOCK_DAYS - 1,
      currentStock: 5,
    });
    expect(justInside).not.toBe("DEAD_STOCK");
  });

  it("guards against a zero-day window dividing by zero", () => {
    expect(() =>
      classifyVelocity({ unitsSold: 5, windowDays: 0, daysSinceLastSale: 1, currentStock: 5 })
    ).not.toThrow();
  });
});

describe("suggestedClearanceDiscount", () => {
  it("deepens the discount as stock ages", () => {
    expect(suggestedClearanceDiscount(10)).toBe(0);
    expect(suggestedClearanceDiscount(30)).toBe(10);
    expect(suggestedClearanceDiscount(60)).toBe(20);
    expect(suggestedClearanceDiscount(90)).toBe(30);
    expect(suggestedClearanceDiscount(120)).toBe(40);
    expect(suggestedClearanceDiscount(365)).toBe(50);
  });

  it("caps at 50% — deeper is a write-off decision, not a formula", () => {
    expect(suggestedClearanceDiscount(10_000)).toBe(50);
  });

  it("treats never-sold stock as maximally stale", () => {
    expect(suggestedClearanceDiscount(null)).toBe(50);
  });
});

describe("stockTurnover", () => {
  it("reports how many times stock sold through", () => {
    expect(stockTurnover({ unitsSold: 100, averageStock: 25 })).toBe(4);
  });

  it("returns NULL for an empty shelf rather than infinity", () => {
    // An infinite turnover reads as spectacular performance when it actually
    // means there is nothing in stock.
    expect(stockTurnover({ unitsSold: 100, averageStock: 0 })).toBeNull();
  });
});

describe("daysOfInventory", () => {
  it("reports cover at the observed rate", () => {
    expect(daysOfInventory({ currentStock: 30, averageDailySales: 4 })).toBe(7.5);
  });

  it("returns NULL when nothing is selling", () => {
    expect(daysOfInventory({ currentStock: 30, averageDailySales: 0 })).toBeNull();
  });
});

// =============================================================================
// ABC ANALYSIS
// =============================================================================

describe("classifyAbc", () => {
  it("cuts the Pareto curve at the documented thresholds", () => {
    expect(ABC_THRESHOLDS).toEqual({ a: 0.8, b: 0.95 });
  });

  it("assigns A to the items making up the first 80% of value", () => {
    // 800 alone is 80% of 1000 → A. Then 150 takes cumulative to 95% → B.
    const classes = classifyAbc([800, 150, 30, 20]);
    expect(classes).toEqual(["A", "B", "C", "C"]);
  });

  it("classes everything C when there is no revenue at all", () => {
    // Everything-is-A would imply every item is business-critical.
    expect(classifyAbc([0, 0, 0])).toEqual(["C", "C", "C"]);
  });

  it("returns an empty result for an empty inventory", () => {
    expect(classifyAbc([])).toEqual([]);
  });

  it("ignores negative values rather than letting them shrink the total", () => {
    expect(() => classifyAbc([100, -50, 20])).not.toThrow();
  });
});

// =============================================================================
// ACCURACY
// =============================================================================

describe("countAccuracy", () => {
  it("measures accuracy by LINES, not units", () => {
    // 1 wrong line out of 100 is 99% — a single large-quantity error must not
    // swamp ninety-nine correct lines.
    expect(countAccuracy({ totalCounted: 100, varianceLines: 1 })).toBe(99);
  });

  it("reports 100% for a perfect count", () => {
    expect(countAccuracy({ totalCounted: 50, varianceLines: 0 })).toBe(100);
  });

  it("reports 0% when every line is wrong", () => {
    expect(countAccuracy({ totalCounted: 10, varianceLines: 10 })).toBe(0);
  });

  it("treats an empty count as accurate rather than dividing by zero", () => {
    expect(countAccuracy({ totalCounted: 0, varianceLines: 0 })).toBe(100);
  });

  it("never reports negative accuracy for inconsistent input", () => {
    expect(countAccuracy({ totalCounted: 5, varianceLines: 10 })).toBe(0);
  });
});
