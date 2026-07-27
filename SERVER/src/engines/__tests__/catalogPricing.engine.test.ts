// =============================================================================
// CATALOG PRICING ENGINE — unit tests
//
// This is money logic, so the suite is exhaustive by design: every rung of the
// resolution ladder, every tie-break, both clamp paths, and the exact worked
// examples from the product specification.
// =============================================================================

import { describe, expect, it } from "vitest";

import { Prisma } from "../../../generated/prisma";
import type { DiscountRuleScope, DiscountRuleType } from "../../../generated/prisma";
import {
  backSolveDiscount,
  deriveStatus,
  discountAmountFor,
  resolve,
  resolveMany,
  type PricingRuleInput,
  type PricingVariantInput,
} from "../catalogPricing.engine";

const D = (n: number | string) => new Prisma.Decimal(n);

const NOW = new Date("2026-07-27T12:00:00.000Z");
const PAST = new Date("2026-01-01T00:00:00.000Z");
const FUTURE = new Date("2027-01-01T00:00:00.000Z");

function variant(over: Partial<PricingVariantInput> = {}): PricingVariantInput {
  return {
    id: "v1",
    productId: "p1",
    categoryId: "c1",
    brandId: "b1",
    mrp: D(1000),
    costPrice: D(400),
    defaultDiscountType: "PERCENTAGE",
    defaultDiscountValue: D(0),
    maxDiscountPct: null,
    discountAllowed: true,
    ...over,
  };
}

let ruleSeq = 0;
function rule(over: Partial<PricingRuleInput> = {}): PricingRuleInput {
  ruleSeq += 1;
  return {
    id: `r${ruleSeq}`,
    name: `Rule ${ruleSeq}`,
    scope: "PRODUCT" as DiscountRuleScope,
    type: "PERCENTAGE" as DiscountRuleType,
    value: D(10),
    productId: "p1",
    categoryId: null,
    brandId: null,
    priority: 0,
    startDate: null,
    endDate: null,
    isEnabled: true,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    ...over,
  };
}

// ── The specification's worked examples ──────────────────────────────────────

describe("specification examples", () => {
  it("MRP 1000 − 20% = 800", () => {
    const r = resolve(variant({ defaultDiscountType: "PERCENTAGE", defaultDiscountValue: D(20) }), [], NOW);
    expect(r.sellingPrice.toFixed(2)).toBe("800.00");
    expect(r.source.tier).toBe("DEFAULT");
  });

  it("MRP 1000 − flat 150 = 850", () => {
    const r = resolve(variant({ defaultDiscountType: "FLAT", defaultDiscountValue: D(150) }), [], NOW);
    expect(r.sellingPrice.toFixed(2)).toBe("850.00");
  });

  it("the full ladder: default 10%, category 25%, product 40% → 600 (not compounded)", () => {
    const v = variant({ defaultDiscountType: "PERCENTAGE", defaultDiscountValue: D(10) });
    const rules = [
      rule({ scope: "CATEGORY", categoryId: "c1", productId: null, value: D(25) }),
      rule({ scope: "PRODUCT", productId: "p1", value: D(40) }),
    ];
    const r = resolve(v, rules, NOW);

    // 1000 × 0.9 × 0.75 × 0.6 would be 405. Outright wins give 600.
    expect(r.sellingPrice.toFixed(2)).toBe("600.00");
    expect(r.source.tier).toBe("PRODUCT");
    expect(r.effectiveDiscount.toFixed(2)).toBe("400.00");
    expect(r.effectiveDiscountPct.toFixed(2)).toBe("40.00");
  });

  it("exposes MRP, default discount, current discount, source and price together", () => {
    const v = variant({ defaultDiscountType: "PERCENTAGE", defaultDiscountValue: D(10) });
    const rules = [rule({ scope: "CATEGORY", categoryId: "c1", productId: null, value: D(30), name: "Summer Sale" })];
    const r = resolve(v, rules, NOW);

    expect(r.mrp.toFixed(2)).toBe("1000.00");
    expect(r.defaultDiscount.toFixed(2)).toBe("100.00");
    expect(r.effectiveDiscountPct.toFixed(2)).toBe("30.00");
    expect(r.sellingPrice.toFixed(2)).toBe("700.00");
    expect(r.source.label).toBe("Category Discount — Summer Sale");
  });
});

// ── Ladder & precedence ──────────────────────────────────────────────────────

describe("resolution ladder", () => {
  it("product beats category even when the category discount is larger", () => {
    const rules = [
      rule({ scope: "CATEGORY", categoryId: "c1", productId: null, value: D(50) }),
      rule({ scope: "PRODUCT", productId: "p1", value: D(20) }),
    ];
    const r = resolve(variant(), rules, NOW);
    expect(r.source.tier).toBe("PRODUCT");
    expect(r.sellingPrice.toFixed(2)).toBe("800.00");
  });

  it("category applies when no product rule exists", () => {
    const rules = [rule({ scope: "CATEGORY", categoryId: "c1", productId: null, value: D(40) })];
    expect(resolve(variant(), rules, NOW).source.tier).toBe("CATEGORY");
  });

  it("falls back to the variant default when no rule targets it", () => {
    const rules = [rule({ scope: "PRODUCT", productId: "OTHER" })];
    const v = variant({ defaultDiscountValue: D(15) });
    const r = resolve(v, rules, NOW);
    expect(r.source.tier).toBe("DEFAULT");
    expect(r.sellingPrice.toFixed(2)).toBe("850.00");
  });

  it("reports NONE when there is no discount at all", () => {
    const r = resolve(variant(), [], NOW);
    expect(r.source.tier).toBe("NONE");
    expect(r.sellingPrice.toFixed(2)).toBe("1000.00");
    expect(r.source.label).toBe("No Discount");
  });

  it("never raises a price: a weaker promotional rule does not displace a better default", () => {
    const v = variant({ defaultDiscountType: "PERCENTAGE", defaultDiscountValue: D(30) });
    const rules = [rule({ scope: "CATEGORY", categoryId: "c1", productId: null, value: D(5) })];
    const r = resolve(v, rules, NOW);
    expect(r.sellingPrice.toFixed(2)).toBe("700.00");
    expect(r.source.tier).toBe("DEFAULT");
  });

  it("BRAND rules are not resolved yet (schema-ready, not implemented)", () => {
    const rules = [rule({ scope: "BRAND", brandId: "b1", productId: null, value: D(50) })];
    expect(resolve(variant(), rules, NOW).source.tier).toBe("NONE");
  });
});

// ── Tie-breaking ─────────────────────────────────────────────────────────────

describe("deterministic tie-breaks", () => {
  it("higher priority wins within a tier", () => {
    const rules = [
      rule({ id: "low", priority: 1, value: D(50) }),
      rule({ id: "high", priority: 9, value: D(10) }),
    ];
    expect(resolve(variant(), rules, NOW).source.ruleId).toBe("high");
  });

  it("equal priority → larger discount wins", () => {
    const rules = [rule({ id: "small", value: D(10) }), rule({ id: "big", value: D(35) })];
    expect(resolve(variant(), rules, NOW).source.ruleId).toBe("big");
  });

  it("equal priority and equal discount → newer rule wins", () => {
    const rules = [
      rule({ id: "older", value: D(20), createdAt: new Date("2026-01-01") }),
      rule({ id: "newer", value: D(20), createdAt: new Date("2026-06-01") }),
    ];
    expect(resolve(variant(), rules, NOW).source.ruleId).toBe("newer");
  });

  it("is stable regardless of input order", () => {
    const a = rule({ id: "aaa", value: D(20), createdAt: new Date("2026-01-01") });
    const b = rule({ id: "bbb", value: D(20), createdAt: new Date("2026-01-01") });
    expect(resolve(variant(), [a, b], NOW).source.ruleId).toBe(
      resolve(variant(), [b, a], NOW).source.ruleId
    );
  });
});

// ── Time-based activation (no cron) ──────────────────────────────────────────

describe("status derivation", () => {
  it("derives each status from flags and dates", () => {
    expect(deriveStatus({ isEnabled: false, startDate: null, endDate: null }, NOW)).toBe("DISABLED");
    expect(deriveStatus({ isEnabled: true, startDate: null, endDate: PAST }, NOW)).toBe("EXPIRED");
    expect(deriveStatus({ isEnabled: true, startDate: FUTURE, endDate: null }, NOW)).toBe("SCHEDULED");
    expect(deriveStatus({ isEnabled: true, startDate: PAST, endDate: FUTURE }, NOW)).toBe("ACTIVE");
    expect(deriveStatus({ isEnabled: true, startDate: null, endDate: null }, NOW)).toBe("ACTIVE");
  });

  it("a disabled rule outranks its dates", () => {
    expect(deriveStatus({ isEnabled: false, startDate: PAST, endDate: FUTURE }, NOW)).toBe("DISABLED");
  });

  it("expired and scheduled rules do not affect price", () => {
    const expired = rule({ endDate: PAST, value: D(50) });
    const scheduled = rule({ startDate: FUTURE, value: D(50) });
    const disabled = rule({ isEnabled: false, value: D(50) });
    for (const r of [expired, scheduled, disabled]) {
      expect(resolve(variant(), [r], NOW).sellingPrice.toFixed(2)).toBe("1000.00");
    }
  });

  it("the same rule set prices differently as the clock moves — no job required", () => {
    const seasonal = rule({
      value: D(40),
      startDate: new Date("2026-07-01T00:00:00.000Z"),
      endDate: new Date("2026-07-31T23:59:59.000Z"),
    });
    const before = resolve(variant(), [seasonal], new Date("2026-06-30T12:00:00Z"));
    const during = resolve(variant(), [seasonal], new Date("2026-07-15T12:00:00Z"));
    const after = resolve(variant(), [seasonal], new Date("2026-08-01T12:00:00Z"));

    expect(before.sellingPrice.toFixed(2)).toBe("1000.00");
    expect(during.sellingPrice.toFixed(2)).toBe("600.00");
    expect(after.sellingPrice.toFixed(2)).toBe("1000.00");
  });
});

// ── Clamping, capping, edge cases ────────────────────────────────────────────

describe("clamping and edge cases", () => {
  it("a FLAT discount larger than MRP clamps to zero, never negative", () => {
    const v = variant({ mrp: D(300), defaultDiscountType: "FLAT", defaultDiscountValue: D(500) });
    const r = resolve(v, [], NOW);
    expect(r.sellingPrice.toFixed(2)).toBe("0.00");
    expect(r.wasClamped).toBe(true);
  });

  it("maxDiscountPct caps the discount and flags it", () => {
    const v = variant({ maxDiscountPct: D(15) });
    const rules = [rule({ value: D(50) })];
    const r = resolve(v, rules, NOW);
    expect(r.sellingPrice.toFixed(2)).toBe("850.00");
    expect(r.wasCapped).toBe(true);
  });

  it("discountAllowed:false blocks promotional rules but keeps the owner's own default", () => {
    const v = variant({ discountAllowed: false, defaultDiscountValue: D(10) });
    const rules = [rule({ value: D(50) })];
    const r = resolve(v, rules, NOW);
    expect(r.sellingPrice.toFixed(2)).toBe("900.00");
    expect(r.source.tier).toBe("DEFAULT");
  });

  it("handles mrp = 0 without dividing by zero", () => {
    const r = resolve(variant({ mrp: D(0), defaultDiscountValue: D(20) }), [], NOW);
    expect(r.sellingPrice.toFixed(2)).toBe("0.00");
    expect(r.effectiveDiscountPct.toFixed(2)).toBe("0.00");
    expect(r.profitPct.toFixed(2)).toBe("0.00");
  });

  it("rounds once so the shown discount and price always reconcile", () => {
    // 33.33% of 999 = 333.0 (recurring). Price and discount must sum to MRP.
    const v = variant({ mrp: D(999), defaultDiscountType: "PERCENTAGE", defaultDiscountValue: D("33.33") });
    const r = resolve(v, [], NOW);
    expect(r.sellingPrice.plus(r.effectiveDiscount).toFixed(2)).toBe("999.00");
  });

  it("reports negative margin when selling below cost", () => {
    const v = variant({ mrp: D(1000), costPrice: D(900), defaultDiscountValue: D(50) });
    const r = resolve(v, [], NOW);
    expect(r.sellingPrice.toFixed(2)).toBe("500.00");
    expect(r.margin.toFixed(2)).toBe("-400.00");
  });

  it("computes margin, profit and profit %", () => {
    const v = variant({ mrp: D(1000), costPrice: D(400), defaultDiscountValue: D(20) });
    const r = resolve(v, [], NOW);
    expect(r.sellingPrice.toFixed(2)).toBe("800.00");
    expect(r.margin.toFixed(2)).toBe("400.00");
    expect(r.profit.toFixed(2)).toBe("400.00");
    expect(r.profitPct.toFixed(2)).toBe("50.00");
  });

  it("rejects declared-but-unimplemented discount types", () => {
    expect(() => discountAmountFor(D(1000), "BOGO", D(1))).toThrow(/not implemented/i);
  });
});

// ── Manual pricing round-trip ────────────────────────────────────────────────

describe("manual pricing back-solve", () => {
  it("back-solves the discount from a typed selling price", () => {
    const { type, value } = backSolveDiscount(D(1000), D(850));
    expect(type).toBe("FLAT");
    expect(value.toFixed(2)).toBe("150.00");
  });

  it("round-trips exactly: typed price → discount → same price", () => {
    for (const [mrp, selling] of [
      [1000, 850],
      [999, 666.67],
      [1499, 1],
      [250, 250],
    ] as const) {
      const { type, value } = backSolveDiscount(D(mrp), D(selling));
      const back = resolve(
        variant({ mrp: D(mrp), defaultDiscountType: type, defaultDiscountValue: value }),
        [],
        NOW
      );
      expect(back.sellingPrice.toFixed(2)).toBe(D(selling).toFixed(2));
    }
  });

  it("never yields a negative discount when selling above MRP", () => {
    expect(backSolveDiscount(D(500), D(700)).value.toFixed(2)).toBe("0.00");
  });

  it("handles mrp = 0", () => {
    expect(backSolveDiscount(D(0), D(0)).value.toFixed(2)).toBe("0.00");
  });
});

// ── Batching ─────────────────────────────────────────────────────────────────

describe("resolveMany", () => {
  it("prices a mixed set against one shared rule list", () => {
    const variants = [
      variant({ id: "a", productId: "p1", categoryId: "c1" }),
      variant({ id: "b", productId: "p2", categoryId: "c1" }),
      variant({ id: "c", productId: "p3", categoryId: "c2" }),
    ];
    const rules = [
      rule({ scope: "PRODUCT", productId: "p1", value: D(40) }),
      rule({ scope: "CATEGORY", categoryId: "c1", productId: null, value: D(25) }),
    ];
    const out = resolveMany(variants, rules, NOW);

    expect(out.get("a")!.sellingPrice.toFixed(2)).toBe("600.00"); // product rule
    expect(out.get("b")!.sellingPrice.toFixed(2)).toBe("750.00"); // category rule
    expect(out.get("c")!.sellingPrice.toFixed(2)).toBe("1000.00"); // nothing targets it
  });

  it("agrees with resolve() called individually", () => {
    const vs = [variant({ id: "a" }), variant({ id: "b", productId: "p9" })];
    const rules = [rule({ value: D(30) })];
    const many = resolveMany(vs, rules, NOW);
    for (const v of vs) {
      expect(many.get(v.id)!.sellingPrice.toFixed(2)).toBe(resolve(v, rules, NOW).sellingPrice.toFixed(2));
    }
  });
});
