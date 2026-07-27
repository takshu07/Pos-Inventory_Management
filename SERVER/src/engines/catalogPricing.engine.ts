// =============================================================================
// CATALOG PRICING ENGINE
//
// THE single source of truth for "what is this item's shelf price right now?".
//
// Not to be confused with engines/pricing.engine.ts, which is the BASKET layer
// ("what does this cart cost?" — cart promotions, manual discount, tax,
// rounding). The two compose in one direction only:
//
//     catalogPricing.engine  →  shelf price per item
//              ↓
//     pricing.engine         →  cart total (promotions & tax on top)
//
// Everything here is PURE: no database access, no clock reads beyond the `now`
// you pass in, no I/O. Rules are supplied by the caller (see
// services/effectivePrice.service.ts, which batches the DB work). That keeps
// the money logic exhaustively unit-testable and makes the resolution order
// auditable in one file.
//
// ── The ladder ───────────────────────────────────────────────────────────────
// Exactly ONE discount ever applies. The highest-priority tier wins OUTRIGHT;
// discounts are never stacked or compounded:
//
//     PRODUCT rule → CATEGORY rule → BRAND rule → variant default → none
//
// Worked example from the spec:
//     MRP 1000, default 10% (=900), category 25% (=750), product 40% (=600)
//     → the product rule wins outright → 600. Not 1000×0.9×0.75×0.6.
// =============================================================================

import { Prisma } from "../../generated/prisma";
import type { DiscountRuleScope, DiscountRuleType, DiscountStatus } from "../../generated/prisma";
import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

/** Money is always rounded to 2dp, half-up — matching pricing.engine's RoundingRule. */
const round2 = (d: Prisma.Decimal): Prisma.Decimal =>
  d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** Discount types the engine can actually evaluate today. */
const IMPLEMENTED_TYPES: ReadonlySet<DiscountRuleType> = new Set<DiscountRuleType>([
  "PERCENTAGE",
  "FLAT",
]);

/** Scopes the engine can actually resolve today. BRAND is schema-ready, not live. */
const IMPLEMENTED_SCOPES: ReadonlySet<DiscountRuleScope> = new Set<DiscountRuleScope>([
  "PRODUCT",
  "CATEGORY",
]);

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * The minimum a rule must expose to be resolved. Structurally compatible with
 * the Prisma `DiscountRule` model, but declared independently so the engine
 * stays testable without constructing full ORM objects.
 */
export interface PricingRuleInput {
  id: string;
  name: string;
  scope: DiscountRuleScope;
  type: DiscountRuleType;
  value: Prisma.Decimal;
  productId: string | null;
  categoryId: string | null;
  brandId: string | null;
  priority: number;
  startDate: Date | null;
  endDate: Date | null;
  isEnabled: boolean;
  createdAt: Date;
}

/** The variant being priced, plus the ancestry the ladder needs to match rules. */
export interface PricingVariantInput {
  id: string;
  productId: string;
  categoryId: string;
  brandId: string | null;
  mrp: Prisma.Decimal;
  costPrice: Prisma.Decimal;
  defaultDiscountType: DiscountRuleType;
  defaultDiscountValue: Prisma.Decimal;
  /** Ceiling on any discount for this variant, as a percentage of MRP. */
  maxDiscountPct?: Prisma.Decimal | null;
  /** When false, promotional rules are ignored for this variant. */
  discountAllowed?: boolean;
}

/** Which rung of the ladder produced the price. */
export type DiscountSourceTier = "PRODUCT" | "CATEGORY" | "BRAND" | "DEFAULT" | "NONE";

export interface DiscountSource {
  tier: DiscountSourceTier;
  /** Null for DEFAULT and NONE — those come from the variant, not a rule. */
  ruleId: string | null;
  ruleName: string | null;
  type: DiscountRuleType | null;
  /** The rule's configured value (20 for "20%", 150 for "₹150 off"). */
  value: Prisma.Decimal | null;
  /** Human-readable explanation for the UI: "Category Discount — Summer Sale". */
  label: string;
}

export interface EffectivePrice {
  mrp: Prisma.Decimal;
  costPrice: Prisma.Decimal;
  /** The variant's own base discount, as an absolute rupee amount off MRP. */
  defaultDiscount: Prisma.Decimal;
  /** The discount that actually won, as an absolute rupee amount off MRP. */
  effectiveDiscount: Prisma.Decimal;
  /** Same, as a percentage of MRP — for display only. */
  effectiveDiscountPct: Prisma.Decimal;
  /** THE price. mrp − effectiveDiscount, clamped to >= 0, rounded to 2dp. */
  sellingPrice: Prisma.Decimal;
  source: DiscountSource;
  /** sellingPrice − costPrice. Negative when selling below cost. */
  margin: Prisma.Decimal;
  /** Alias of margin, per-unit profit. Kept distinct for reporting clarity. */
  profit: Prisma.Decimal;
  /** margin / sellingPrice × 100. Zero when sellingPrice is 0. */
  profitPct: Prisma.Decimal;
  /** True when a FLAT discount exceeded MRP and was clamped to yield 0. */
  wasClamped: boolean;
  /** True when maxDiscountPct capped the discount below what the rule asked. */
  wasCapped: boolean;
}

// ── Status derivation (the no-cron mechanism) ────────────────────────────────

/**
 * A rule's status is NEVER stored — it is derived from (isEnabled, dates) every
 * time it is read. That is what makes discounts activate and expire on a clock
 * without a scheduler: a rule ending at 23:59 simply stops matching at 00:00.
 *
 *   disabled            → DISABLED
 *   ended in the past   → EXPIRED
 *   starts in future    → SCHEDULED
 *   enabled, in window  → ACTIVE
 *
 * DRAFT is reserved for enabled rules that have no dates AND no value yet; the
 * service layer marks those explicitly. Anything with a usable value is live.
 */
export function deriveStatus(
  rule: Pick<PricingRuleInput, "isEnabled" | "startDate" | "endDate">,
  now: Date = new Date()
): DiscountStatus {
  if (!rule.isEnabled) return "DISABLED";
  if (rule.endDate && rule.endDate.getTime() < now.getTime()) return "EXPIRED";
  if (rule.startDate && rule.startDate.getTime() > now.getTime()) return "SCHEDULED";
  return "ACTIVE";
}

/** True only for rules that are live *right now*. */
export function isRuleActive(
  rule: Pick<PricingRuleInput, "isEnabled" | "startDate" | "endDate">,
  now: Date = new Date()
): boolean {
  return deriveStatus(rule, now) === "ACTIVE";
}

// ── Discount arithmetic ──────────────────────────────────────────────────────

/**
 * Convert a (type, value) discount into an absolute rupee amount off `mrp`,
 * clamped to [0, mrp] so a price can never go negative.
 *
 * A FLAT ₹500 discount on a ₹300 MRP yields ₹300 off (price 0), never ₹-200.
 */
export function discountAmountFor(
  mrp: Prisma.Decimal,
  type: DiscountRuleType,
  value: Prisma.Decimal
): { amount: Prisma.Decimal; wasClamped: boolean } {
  if (!IMPLEMENTED_TYPES.has(type)) {
    throw new AppError(
      HTTP_STATUS.NOT_IMPLEMENTED,
      `Discount type ${type} is declared in the schema but not implemented yet.`
    );
  }
  if (mrp.lte(ZERO) || value.lte(ZERO)) {
    return { amount: ZERO, wasClamped: false };
  }

  const raw = type === "PERCENTAGE" ? mrp.mul(value).div(HUNDRED) : value;

  if (raw.gt(mrp)) return { amount: mrp, wasClamped: true };
  return { amount: raw, wasClamped: false };
}

/**
 * The inverse, for "Enable Manual Pricing": the owner types a selling price and
 * we back-solve the discount so MRP / discount / selling price never drift
 * apart. Always returns FLAT — an exact rupee difference, immune to the
 * rounding drift a derived percentage would reintroduce.
 */
export function backSolveDiscount(
  mrp: Prisma.Decimal,
  sellingPrice: Prisma.Decimal
): { type: DiscountRuleType; value: Prisma.Decimal } {
  if (mrp.lte(ZERO)) return { type: "FLAT", value: ZERO };
  const diff = mrp.minus(sellingPrice);
  return { type: "FLAT", value: round2(diff.lt(ZERO) ? ZERO : diff) };
}

// ── Rule matching & ordering ─────────────────────────────────────────────────

const TIER_RANK: Record<DiscountSourceTier, number> = {
  PRODUCT: 4,
  CATEGORY: 3,
  BRAND: 2,
  DEFAULT: 1,
  NONE: 0,
};

/** Does this rule target this variant at all? */
function ruleTargets(rule: PricingRuleInput, variant: PricingVariantInput): boolean {
  switch (rule.scope) {
    case "PRODUCT":
      return rule.productId === variant.productId;
    case "CATEGORY":
      return rule.categoryId === variant.categoryId;
    case "BRAND":
      return variant.brandId !== null && rule.brandId === variant.brandId;
    default:
      return false;
  }
}

/**
 * Total ordering over competing rules. Deterministic to the last tie-break so
 * the same inputs always produce the same winner — an owner must never see a
 * price flip between two page loads.
 *
 *   1. scope tier      (PRODUCT beats CATEGORY beats BRAND — always)
 *   2. priority        (higher wins, within a tier)
 *   3. larger discount (customer-favourable)
 *   4. newer rule      (most recent intent)
 *   5. id ascending    (final, arbitrary but stable)
 */
function compareRules(
  a: { rule: PricingRuleInput; amount: Prisma.Decimal },
  b: { rule: PricingRuleInput; amount: Prisma.Decimal }
): number {
  const tierDiff = TIER_RANK[a.rule.scope as DiscountSourceTier] - TIER_RANK[b.rule.scope as DiscountSourceTier];
  if (tierDiff !== 0) return -tierDiff;

  if (a.rule.priority !== b.rule.priority) return b.rule.priority - a.rule.priority;

  const amountDiff = b.amount.comparedTo(a.amount);
  if (amountDiff !== 0) return amountDiff;

  const timeDiff = b.rule.createdAt.getTime() - a.rule.createdAt.getTime();
  if (timeDiff !== 0) return timeDiff;

  return a.rule.id < b.rule.id ? -1 : a.rule.id > b.rule.id ? 1 : 0;
}

const TIER_LABEL: Record<DiscountSourceTier, string> = {
  PRODUCT: "Product Discount",
  CATEGORY: "Category Discount",
  BRAND: "Brand Discount",
  DEFAULT: "Default Discount",
  NONE: "No Discount",
};

// ── The resolver ─────────────────────────────────────────────────────────────

/**
 * Resolve one variant's effective price against a set of candidate rules.
 *
 * `rules` may contain rules for any product/category/brand and any status —
 * filtering is done here, so callers can hand over one broad rule set and price
 * a whole page of variants against it without re-querying (see
 * effectivePrice.service.getEffectivePrices).
 */
export function resolve(
  variant: PricingVariantInput,
  rules: readonly PricingRuleInput[],
  now: Date = new Date()
): EffectivePrice {
  const mrp = new Prisma.Decimal(variant.mrp);
  const costPrice = new Prisma.Decimal(variant.costPrice);

  // The variant's own base discount — the ladder's floor, and what applies when
  // no promotional rule targets this item.
  const base = discountAmountFor(mrp, variant.defaultDiscountType, new Prisma.Decimal(variant.defaultDiscountValue));

  let winner: { rule: PricingRuleInput; amount: Prisma.Decimal } | null = null;

  // `discountAllowed: false` opts a variant out of PROMOTIONAL rules entirely.
  // Its own default discount still applies — that is the owner's own base
  // price, not a promotion.
  if (variant.discountAllowed !== false) {
    const candidates = rules
      .filter(
        (r) =>
          IMPLEMENTED_SCOPES.has(r.scope) &&
          IMPLEMENTED_TYPES.has(r.type) &&
          isRuleActive(r, now) &&
          ruleTargets(r, variant)
      )
      .map((rule) => ({ rule, amount: discountAmountFor(mrp, rule.type, rule.value).amount }));

    if (candidates.length > 0) {
      candidates.sort(compareRules);
      winner = candidates[0]!;
    }
  }

  // A promotional rule only displaces the variant default if it actually beats
  // it. A 5% category sale must never *raise* the price of an item already at
  // 30% off — the customer always gets the better of the two.
  const useRule = winner !== null && winner.amount.gt(base.amount);

  let effectiveDiscount = useRule ? winner!.amount : base.amount;
  let wasClamped = useRule ? false : base.wasClamped;

  if (useRule) {
    wasClamped = discountAmountFor(mrp, winner!.rule.type, winner!.rule.value).wasClamped;
  }

  // Enforce the per-variant ceiling. maxDiscountPct has existed on the schema
  // since the product wizard shipped and the wizard UI already promises it is
  // "enforced at the till" — this is where that promise becomes true.
  let wasCapped = false;
  const maxPct = variant.maxDiscountPct == null ? null : new Prisma.Decimal(variant.maxDiscountPct);
  if (maxPct !== null && maxPct.gte(ZERO) && mrp.gt(ZERO)) {
    const ceiling = mrp.mul(maxPct).div(HUNDRED);
    if (effectiveDiscount.gt(ceiling)) {
      effectiveDiscount = ceiling;
      wasCapped = true;
    }
  }

  // Round ONCE, then derive the discount back from the rounded price so the
  // displayed discount and the displayed price always reconcile exactly.
  // Rounding both independently is how "₹1000 − 33.33% = ₹666.67" ends up
  // showing a ₹333.33 discount against a ₹666.66 price.
  const sellingPrice = round2(Prisma.Decimal.max(mrp.minus(effectiveDiscount), ZERO));
  const reconciledDiscount = round2(mrp.minus(sellingPrice));
  const effectiveDiscountPct = mrp.gt(ZERO)
    ? round2(reconciledDiscount.mul(HUNDRED).div(mrp))
    : ZERO;

  const margin = round2(sellingPrice.minus(costPrice));
  const profitPct = sellingPrice.gt(ZERO) ? round2(margin.mul(HUNDRED).div(sellingPrice)) : ZERO;

  const tier: DiscountSourceTier = useRule
    ? (winner!.rule.scope as DiscountSourceTier)
    : reconciledDiscount.gt(ZERO)
      ? "DEFAULT"
      : "NONE";

  const source: DiscountSource =
    useRule && winner
      ? {
          tier,
          ruleId: winner.rule.id,
          ruleName: winner.rule.name,
          type: winner.rule.type,
          value: winner.rule.value,
          label: `${TIER_LABEL[tier]} — ${winner.rule.name}`,
        }
      : {
          tier,
          ruleId: null,
          ruleName: null,
          type: tier === "DEFAULT" ? variant.defaultDiscountType : null,
          value: tier === "DEFAULT" ? new Prisma.Decimal(variant.defaultDiscountValue) : null,
          label: TIER_LABEL[tier],
        };

  return {
    mrp,
    costPrice,
    defaultDiscount: round2(base.amount),
    effectiveDiscount: reconciledDiscount,
    effectiveDiscountPct,
    sellingPrice,
    source,
    margin,
    profit: margin,
    profitPct,
    wasClamped,
    wasCapped,
  };
}

/**
 * Convenience wrapper for pricing many variants against one shared rule set.
 * The caller loads rules ONCE; this keeps catalog lists and POS lookups off an
 * N+1. Returns a Map keyed by variant id.
 */
export function resolveMany(
  variants: readonly PricingVariantInput[],
  rules: readonly PricingRuleInput[],
  now: Date = new Date()
): Map<string, EffectivePrice> {
  const out = new Map<string, EffectivePrice>();
  for (const v of variants) out.set(v.id, resolve(v, rules, now));
  return out;
}

export const CatalogPricingEngine = {
  resolve,
  resolveMany,
  deriveStatus,
  isRuleActive,
  discountAmountFor,
  backSolveDiscount,
};
