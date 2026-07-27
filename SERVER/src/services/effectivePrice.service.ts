// =============================================================================
// EFFECTIVE PRICE SERVICE
//
// The database-facing half of the catalog pricing engine, and — critically —
// THE ONLY PLACE IN THE CODEBASE THAT WRITES ProductVariant.sellingPrice.
//
// engines/catalogPricing.engine.ts holds the pure money logic (which discount
// wins, what the price is). This service supplies it with rules from the
// database, batches the work, and persists the derived price back to the
// sellingPrice cache column.
//
// ── Read / write model ───────────────────────────────────────────────────────
// Reads are AUTHORITATIVE: getEffectivePrice(s) always resolves live against
// current rules and never trusts the cached column. So the Discounts UI, the
// product detail drawer, the POS lookup and checkout are correct even the
// instant after a rule expires.
//
// Writes are an EAGER CACHE: whenever something price-affecting changes we
// recompute and persist, in bounded chunks. The cached column exists because
// catalog.service.ts filters and sorts on sellingPrice in SQL (buildWhere's
// minPrice/maxPrice, the priceLow/priceHigh sorts) — that cannot be done
// against a value computed in JavaScript.
//
// Because reads and checkout both resolve live, a momentarily stale cache can
// only ever affect SORT ORDER on a catalog list. It can never cause a customer
// to be charged the wrong price. That bounded failure mode is the whole reason
// this hybrid is preferred over pure eager-write.
// =============================================================================

import { Prisma } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import {
  resolve as resolveEffective,
  resolveMany,
  type EffectivePrice,
  type PricingRuleInput,
  type PricingVariantInput,
} from "../engines/catalogPricing.engine";

// ── Tuning ───────────────────────────────────────────────────────────────────

/** Rows per UPDATE ... FROM (VALUES ...) statement when refreshing the cache. */
const CHUNK_SIZE = 500;

/**
 * Above this many affected variants, only the first chunk is written
 * synchronously; the remainder continues in the background so an owner
 * enabling a category-wide sale never waits on a 50 000-row update.
 */
const EAGER_FANOUT_LIMIT = 5_000;

// ── Shared selections ────────────────────────────────────────────────────────

/** Everything the engine needs about a variant, and nothing more. */
const variantPricingSelect = {
  id: true,
  mrp: true,
  costPrice: true,
  defaultDiscountType: true,
  defaultDiscountValue: true,
  maxDiscountPct: true,
  discountAllowed: true,
  product: { select: { id: true, categoryId: true, brandId: true } },
} satisfies Prisma.ProductVariantSelect;

type VariantPricingRow = Prisma.ProductVariantGetPayload<{ select: typeof variantPricingSelect }>;

function toEngineVariant(row: VariantPricingRow): PricingVariantInput {
  return {
    id: row.id,
    productId: row.product.id,
    categoryId: row.product.categoryId,
    brandId: row.product.brandId,
    mrp: row.mrp,
    costPrice: row.costPrice,
    defaultDiscountType: row.defaultDiscountType,
    defaultDiscountValue: row.defaultDiscountValue,
    maxDiscountPct: row.maxDiscountPct,
    discountAllowed: row.discountAllowed,
  };
}

// ── Rule loading ─────────────────────────────────────────────────────────────

/**
 * Load the rules that could possibly apply right now.
 *
 * Deliberately filtered in SQL only by `isEnabled` and the date window — the
 * engine does the precise status derivation. Note the OR-form date predicates:
 * a null start/end means "unbounded in that direction". (The pre-existing
 * Promotion query in sale.service.ts:71-74 gets this wrong with an AND, which
 * silently disables every promotion that has a start date. Not fixed here —
 * different subsystem, and changing live checkout behaviour deserves its own
 * change.)
 */
export async function loadActiveRules(
  now: Date = new Date(),
  tx?: Prisma.TransactionClient
): Promise<PricingRuleInput[]> {
  const client = tx ?? prisma;
  return client.discountRule.findMany({
    where: {
      isEnabled: true,
      AND: [
        { OR: [{ startDate: null }, { startDate: { lte: now } }] },
        { OR: [{ endDate: null }, { endDate: { gte: now } }] },
      ],
    },
    select: {
      id: true,
      name: true,
      scope: true,
      type: true,
      value: true,
      productId: true,
      categoryId: true,
      brandId: true,
      priority: true,
      startDate: true,
      endDate: true,
      isEnabled: true,
      createdAt: true,
    },
  });
}

// ── Public reads (always live, never cached) ─────────────────────────────────

/** Effective price for one variant. */
export async function getEffectivePriceForVariant(
  variantId: string,
  now: Date = new Date()
): Promise<EffectivePrice | null> {
  const [row, rules] = await Promise.all([
    prisma.productVariant.findUnique({ where: { id: variantId }, select: variantPricingSelect }),
    loadActiveRules(now),
  ]);
  if (!row) return null;
  return resolveEffective(toEngineVariant(row), rules, now);
}

/**
 * Effective prices for many variants in TWO queries total, regardless of count.
 * Use this anywhere a list is rendered — catalog pages, POS search results —
 * so pricing never becomes an N+1.
 */
export async function getEffectivePrices(
  variantIds: string[],
  now: Date = new Date()
): Promise<Map<string, EffectivePrice>> {
  if (variantIds.length === 0) return new Map();

  const [rows, rules] = await Promise.all([
    prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: variantPricingSelect,
    }),
    loadActiveRules(now),
  ]);

  return resolveMany(rows.map(toEngineVariant), rules, now);
}

/**
 * Every variant of one product, priced. Backs GET /pricing/product/:id, which
 * is what the Product page uses to explain WHY a price is what it is.
 */
export async function getEffectivePricesForProduct(
  productId: string,
  now: Date = new Date()
): Promise<Map<string, EffectivePrice>> {
  const [rows, rules] = await Promise.all([
    prisma.productVariant.findMany({
      where: { productId },
      select: variantPricingSelect,
    }),
    loadActiveRules(now),
  ]);
  return resolveMany(rows.map(toEngineVariant), rules, now);
}

// ── Cache maintenance (the only writer) ──────────────────────────────────────

/**
 * Persist derived prices for a set of variants.
 *
 * Uses a single UPDATE ... FROM (VALUES ...) per chunk rather than N individual
 * updates: against a remote Neon instance each round-trip costs real latency,
 * so 500 rows in one statement is dramatically faster than 500 statements.
 */
async function writePriceChunk(
  chunk: Array<{ id: string; price: EffectivePrice }>,
  tx?: Prisma.TransactionClient
): Promise<void> {
  if (chunk.length === 0) return;
  const client = tx ?? prisma;
  const now = new Date();

  const values = Prisma.join(
    chunk.map(
      (c) =>
        Prisma.sql`(${c.id}, ${c.price.sellingPrice.toFixed(2)}::numeric(10,2), ${
          c.price.source.ruleId
        }::text, ${now}::timestamp)`
    )
  );

  await client.$executeRaw`
    UPDATE "product_variants" AS pv
    SET "sellingPrice"    = v.selling,
        "appliedRuleId"   = v.rule_id,
        "priceComputedAt" = v.computed_at
    FROM (VALUES ${values}) AS v(id, selling, rule_id, computed_at)
    WHERE pv.id = v.id`;
}

/**
 * Recompute and persist sellingPrice for the given variants.
 *
 * Returns how many rows were written synchronously. When the set exceeds
 * EAGER_FANOUT_LIMIT the remainder is continued in the background (fire-and-
 * forget with structured logging, the same pattern the audit repository uses)
 * so a request never blocks on an unbounded update.
 */
export async function recomputeVariants(
  variantIds: string[],
  opts: { tx?: Prisma.TransactionClient; now?: Date; forceSync?: boolean } = {}
): Promise<{ affected: number; deferred: number }> {
  if (variantIds.length === 0) return { affected: 0, deferred: 0 };

  const now = opts.now ?? new Date();
  const client = opts.tx ?? prisma;

  const [rows, rules] = await Promise.all([
    client.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: variantPricingSelect,
    }),
    loadActiveRules(now, opts.tx),
  ]);

  const priced = rows.map((row) => ({
    id: row.id,
    price: resolveEffective(toEngineVariant(row), rules, now),
  }));

  // Inside a caller's transaction, everything must be written synchronously —
  // deferring would escape the transaction's atomicity.
  const syncLimit = opts.tx || opts.forceSync ? priced.length : Math.min(priced.length, EAGER_FANOUT_LIMIT);

  for (let i = 0; i < syncLimit; i += CHUNK_SIZE) {
    await writePriceChunk(priced.slice(i, i + CHUNK_SIZE), opts.tx);
  }

  const deferred = priced.slice(syncLimit);
  if (deferred.length > 0) {
    void (async () => {
      try {
        for (let i = 0; i < deferred.length; i += CHUNK_SIZE) {
          await writePriceChunk(deferred.slice(i, i + CHUNK_SIZE));
        }
        logger.info(
          { count: deferred.length },
          "[PricingEngine] Background price recompute finished"
        );
      } catch (error) {
        // Safe to swallow: reads and checkout resolve live, so a failed cache
        // write degrades catalog sort order only — never a charged price.
        logger.error({ err: error, count: deferred.length }, "[PricingEngine] Background price recompute failed");
      }
    })();
  }

  return { affected: syncLimit, deferred: deferred.length };
}

/** Recompute one variant. Convenience wrapper; always synchronous. */
export async function recomputeVariant(
  variantId: string,
  opts: { tx?: Prisma.TransactionClient; now?: Date } = {}
): Promise<void> {
  await recomputeVariants([variantId], { ...opts, forceSync: true });
}

/** Recompute every variant of a product (e.g. after its category changes). */
export async function recomputeProduct(
  productId: string,
  opts: { tx?: Prisma.TransactionClient; now?: Date } = {}
): Promise<{ affected: number; deferred: number }> {
  const client = opts.tx ?? prisma;
  const variants = await client.productVariant.findMany({
    where: { productId },
    select: { id: true },
  });
  return recomputeVariants(
    variants.map((v) => v.id),
    opts
  );
}

/**
 * Recompute every variant a rule could touch. Called after any rule mutation
 * (create / update / enable / disable / delete).
 *
 * For a DELETED rule the scope/target must be passed explicitly, since the row
 * is already gone by the time we recompute.
 */
export async function recomputeForRuleTarget(
  target: { scope: "PRODUCT" | "CATEGORY" | "BRAND"; productId?: string | null; categoryId?: string | null; brandId?: string | null },
  opts: { tx?: Prisma.TransactionClient; now?: Date } = {}
): Promise<{ affected: number; deferred: number }> {
  const client = opts.tx ?? prisma;

  const where: Prisma.ProductVariantWhereInput =
    target.scope === "PRODUCT"
      ? { productId: target.productId ?? "" }
      : target.scope === "CATEGORY"
        ? { product: { categoryId: target.categoryId ?? "" } }
        : { product: { brandId: target.brandId ?? "" } };

  const variants = await client.productVariant.findMany({ where, select: { id: true } });
  return recomputeVariants(
    variants.map((v) => v.id),
    opts
  );
}

/** How many variants a rule would affect — powers the "affects N products" UI hint. */
export async function countAffectedVariants(target: {
  scope: "PRODUCT" | "CATEGORY" | "BRAND";
  productId?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
}): Promise<number> {
  const where: Prisma.ProductVariantWhereInput =
    target.scope === "PRODUCT"
      ? { productId: target.productId ?? "" }
      : target.scope === "CATEGORY"
        ? { product: { categoryId: target.categoryId ?? "" } }
        : { product: { brandId: target.brandId ?? "" } };

  return prisma.productVariant.count({ where });
}

// ── Serialisation ────────────────────────────────────────────────────────────

/** JSON-safe shape of an EffectivePrice for API responses. */
export interface EffectivePriceDTO {
  mrp: number;
  costPrice: number;
  defaultDiscount: number;
  effectiveDiscount: number;
  effectiveDiscountPct: number;
  sellingPrice: number;
  margin: number;
  profit: number;
  profitPct: number;
  wasClamped: boolean;
  wasCapped: boolean;
  source: {
    tier: string;
    ruleId: string | null;
    ruleName: string | null;
    type: string | null;
    value: number | null;
    label: string;
  };
}

/**
 * Convert to a JSON-safe DTO.
 *
 * `includeFinancials` is false for Manager responses — margin/profit/cost are
 * Owner-only, matching how managerProduct.service.ts already strips costPrice.
 */
export function toEffectivePriceDTO(
  price: EffectivePrice,
  includeFinancials = true
): EffectivePriceDTO {
  const dto: EffectivePriceDTO = {
    mrp: price.mrp.toNumber(),
    costPrice: includeFinancials ? price.costPrice.toNumber() : 0,
    defaultDiscount: price.defaultDiscount.toNumber(),
    effectiveDiscount: price.effectiveDiscount.toNumber(),
    effectiveDiscountPct: price.effectiveDiscountPct.toNumber(),
    sellingPrice: price.sellingPrice.toNumber(),
    margin: includeFinancials ? price.margin.toNumber() : 0,
    profit: includeFinancials ? price.profit.toNumber() : 0,
    profitPct: includeFinancials ? price.profitPct.toNumber() : 0,
    wasClamped: price.wasClamped,
    wasCapped: price.wasCapped,
    source: {
      tier: price.source.tier,
      ruleId: price.source.ruleId,
      ruleName: price.source.ruleName,
      type: price.source.type,
      value: price.source.value ? price.source.value.toNumber() : null,
      label: price.source.label,
    },
  };

  if (!includeFinancials) {
    delete (dto as Partial<EffectivePriceDTO>).costPrice;
    delete (dto as Partial<EffectivePriceDTO>).margin;
    delete (dto as Partial<EffectivePriceDTO>).profit;
    delete (dto as Partial<EffectivePriceDTO>).profitPct;
  }

  return dto;
}

export const EffectivePriceService = {
  loadActiveRules,
  getEffectivePriceForVariant,
  getEffectivePrices,
  getEffectivePricesForProduct,
  recomputeVariant,
  recomputeVariants,
  recomputeProduct,
  recomputeForRuleTarget,
  countAffectedVariants,
  toEffectivePriceDTO,
};
