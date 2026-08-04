// =============================================================================
// FULL PRODUCT CREATE SERVICE  (product creation wizard backend)
//
// Creates a complete, sellable catalog item in ONE Prisma transaction:
//
//   Product → Variants → Inventory (opening stock) → Inventory Movements → Audit
//
// If any single step fails, the whole thing rolls back — no orphaned products,
// no half-stocked variants. Every opening unit is still ledgered as an
// OPENING_STOCK movement, so stock remains fully auditable.
//
// Size/Color are provided by NAME; we resolve existing lookup rows case-
// insensitively or create them on the fly, so the wizard owner can introduce a
// new size/color inline without a separate admin trip.
//
// ── Why this is written as bulk operations ───────────────────────────────────
// Everything here is set-based rather than per-variant. The original loop cost
// six sequential round-trips per variant (2 lookups + 1 insert + 3 for the
// movement), so a 25-variant product needed ~150. Measured against Neon at
// ~330ms per round-trip that is ~50s — over the 30s transaction timeout, which
// made large grids fail with a 500 rather than merely being slow. The bulk form
// is a small constant number of round-trips regardless of variant count.
// =============================================================================

import { Prisma } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import { auditRepository } from "../repositories/audit.repository";
import { categoryRepository } from "../repositories/category.repository";
import { brandRepository } from "../repositories/brand.repository";
import { backSolveDiscount } from "../engines/catalogPricing.engine";
import { recomputeVariants } from "./effectivePrice.service";
import * as catalogService from "./catalog.service";
import type {
  CreateFullProductInput,
  FullProductVariantInput,
} from "../validation/ownerProductFull.validation";

// ─── Pre-flight validation (outside the transaction) ──────────────────────────
// Cheap existence/uniqueness checks run first so we fail fast with clear 4xx
// errors instead of aborting a transaction mid-flight.

async function preflight(data: CreateFullProductInput) {
  const skus = data.variants.map((v) => v.sku);
  const barcodes = data.variants.map((v) => v.barcode).filter((b): b is string => !!b);

  // All five checks are independent reads, so they're issued concurrently — at
  // Neon's round-trip latency, running them in sequence cost about as much as
  // the entire rest of the request. Results are still EVALUATED in the original
  // order below, so the error a client sees for a doubly-invalid payload is
  // unchanged.
  const [category, brand, existingName, skuClashes, barcodeClashes] = await Promise.all([
    categoryRepository.findById(data.categoryId),
    data.brandId ? brandRepository.findById(data.brandId) : Promise.resolve(null),
    prisma.product.findFirst({
      where: { name: { equals: data.name, mode: "insensitive" } },
      select: { id: true },
    }),
    prisma.productVariant.findMany({
      where: { sku: { in: skus } },
      select: { sku: true },
    }),
    barcodes.length > 0
      ? prisma.productVariant.findMany({
          where: { barcode: { in: barcodes } },
          select: { barcode: true },
        })
      : Promise.resolve([]),
  ]);

  // Category must exist and be active.
  if (!category || !category.isActive) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid or inactive category selected.");
  }

  // Brand (optional) must exist and be active.
  if (data.brandId && (!brand || !brand.isActive)) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid or inactive brand selected.");
  }

  // Product name must be unique.
  if (existingName) {
    throw new AppError(HTTP_STATUS.CONFLICT, "A product with this name already exists.");
  }

  // SKUs must be globally unique (not already in the DB).
  if (skuClashes.length > 0) {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      `These SKUs are already in use: ${skuClashes.map((s) => s.sku).join(", ")}.`
    );
  }

  // Barcodes must be globally unique.
  if (barcodeClashes.length > 0) {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      `These barcodes are already in use: ${barcodeClashes.map((b) => b.barcode).join(", ")}.`
    );
  }

  return { categoryName: category.name };
}

// ─── Size / Color resolution (batched, within the transaction) ────────────────
//
// Resolved per DISTINCT name, not per variant. A 5-size × 5-color grid is 25
// variants but only 10 distinct lookup values; resolving inside the variant loop
// issued 50 sequential round-trips for those 10 values. At ~330ms per round-trip
// against Neon that alone was ~16s of the transaction's budget.

/** Case-insensitive key for matching wizard-supplied names to lookup rows. */
const key = (name: string) => name.trim().toLowerCase();

/**
 * Resolve every distinct size name to an id in two round-trips: one findMany for
 * the ones that exist, one createMany for the rest.
 */
async function resolveSizeIds(
  tx: Prisma.TransactionClient,
  names: string[]
): Promise<Map<string, string>> {
  const distinct = [...new Map(names.map((n) => [key(n), n.trim()])).values()];
  if (distinct.length === 0) return new Map();

  const existing = await tx.size.findMany({
    where: { name: { in: distinct, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  const byName = new Map(existing.map((s) => [key(s.name), s.id]));

  const missing = distinct.filter((n) => !byName.has(key(n)));
  if (missing.length > 0) {
    const created = await tx.size.createManyAndReturn({
      data: missing.map((name) => ({ name })),
      select: { id: true, name: true },
    });
    for (const s of created) byName.set(key(s.name), s.id);
  }
  return byName;
}

/** Same batching for colors, carrying each new color's hex through. */
async function resolveColorIds(
  tx: Prisma.TransactionClient,
  colors: { name: string; hex?: string | null | undefined }[]
): Promise<Map<string, string>> {
  const distinct = [...new Map(colors.map((c) => [key(c.name), c])).values()].map((c) => ({
    ...c,
    name: c.name.trim(),
  }));
  if (distinct.length === 0) return new Map();

  const existing = await tx.color.findMany({
    where: { name: { in: distinct.map((c) => c.name), mode: "insensitive" } },
    select: { id: true, name: true },
  });
  const byName = new Map(existing.map((c) => [key(c.name), c.id]));

  const missing = distinct.filter((c) => !byName.has(key(c.name)));
  if (missing.length > 0) {
    const created = await tx.color.createManyAndReturn({
      data: missing.map((c) => ({ name: c.name, ...(c.hex ? { hexCode: c.hex } : {}) })),
      select: { id: true, name: true },
    });
    for (const c of created) byName.set(key(c.name), c.id);
  }
  return byName;
}

// ─── Variant persistence helper ───────────────────────────────────────────────

function variantCreateData(
  v: FullProductVariantInput,
  productId: string,
  sizeId: string,
  colorId: string
): Prisma.ProductVariantUncheckedCreateInput {
  // Base discount for this variant. When the wizard sends an explicit
  // discountType/discountValue we store it as-is; otherwise we back-solve a
  // FLAT discount from (mrp − sellingPrice) so the stored discount always
  // reproduces the price the owner saw in the wizard.
  const explicitDiscount = v.discountType !== undefined && v.discountValue !== undefined;
  const discount = explicitDiscount
    ? { type: v.discountType!, value: new Prisma.Decimal(v.discountValue!) }
    : backSolveDiscount(new Prisma.Decimal(v.mrp), new Prisma.Decimal(v.sellingPrice));

  return {
    productId,
    sizeId,
    colorId,
    sku: v.sku,
    barcode: v.barcode ?? null,
    isActive: v.isActive,
    costPrice: v.costPrice,
    // Seeded here so the column is never null; the engine recomputes the
    // authoritative value inside the same transaction (see createFullProduct),
    // which matters when a discount rule already targets this category.
    sellingPrice: v.sellingPrice,
    mrp: v.mrp,
    defaultDiscountType: discount.type,
    defaultDiscountValue: discount.value,
    isManualPricing: v.isManualPricing ?? !explicitDiscount,
    // currentStock stays 0 here — opening stock is applied via a movement below.
    currentStock: 0,
    reorderLevel: v.reorderLevel,
    maximumStock: v.maximumStock ?? null,
    weight: v.weight ?? null,
    lengthCm: v.lengthCm ?? null,
    widthCm: v.widthCm ?? null,
    heightCm: v.heightCm ?? null,
    warehouse: v.warehouse ?? null,
    rack: v.rack ?? null,
    shelf: v.shelf ?? null,
    bin: v.bin ?? null,
    shelfLocation: v.shelfLocation ?? null,
    discountAllowed: v.discountAllowed,
    maxDiscountPct: v.maxDiscountPct ?? null,
    supplierId: v.supplierId ?? null,
    supplierSku: v.supplierSku ?? null,
    leadTimeDays: v.leadTimeDays ?? null,
    imageUrl: v.imageUrl ?? null,
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function createFullProduct(data: CreateFullProductInput, executorId: string) {
  await preflight(data);

  const isActive = data.status === "ACTIVE";

  const product = await prisma.$transaction(async (tx) => {
    // 1. Product
    const createdProduct = await tx.product.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        categoryId: data.categoryId,
        brandId: data.brandId ?? null,
        imageUrls: data.imageUrls,
        searchKeywords: data.searchKeywords ?? null,
        status: data.status,
        isActive,
        gender: data.gender ?? null,
        season: data.season ?? null,
        collectionName: data.collectionName ?? null,
        fabricMaterial: data.fabricMaterial ?? null,
        sleeveType: data.sleeveType ?? null,
        neckType: data.neckType ?? null,
        fit: data.fit ?? null,
        pattern: data.pattern ?? null,
        occasion: data.occasion ?? null,
        hsnCode: data.hsnCode ?? null,
        gstRate: data.gstRate ?? null,
      },
    });

    // 2. Size/color lookups — batched, so this costs a constant handful of
    // round-trips instead of two per variant.
    const sizeIds = await resolveSizeIds(
      tx,
      data.variants.map((v) => v.sizeName)
    );
    const colorIds = await resolveColorIds(
      tx,
      data.variants.map((v) => ({ name: v.colorName, hex: v.colorHex }))
    );

    // 3. Variants — one bulk insert. The generated ids are matched back to their
    // input rows BY SKU rather than by array position: SKU is unique (preflight
    // guarantees it) and pairing the wrong id to a row here would silently file
    // one variant's opening stock against another.
    const createdVariants = await tx.productVariant.createManyAndReturn({
      data: data.variants.map((v) => {
        const sizeId = sizeIds.get(key(v.sizeName));
        const colorId = colorIds.get(key(v.colorName));
        // Unreachable via the API (both maps are built from these same names),
        // but an id silently going undefined would corrupt the variant grid.
        if (!sizeId || !colorId) {
          throw new AppError(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            `Could not resolve size/color for variant ${v.sku}.`
          );
        }
        return variantCreateData(v, createdProduct.id, sizeId, colorId);
      }),
      select: { id: true, sku: true },
    });
    const createdVariantIds = createdVariants.map((v) => v.id);

    // 4. Opening stock. These are brand-new variants created with currentStock 0
    // in this same transaction, so stockBefore is known to be 0 and stockAfter is
    // exactly the opening quantity — there is nothing to read back. That lets the
    // ledger be written as one bulk insert plus one bulk stock update, rather
    // than the three round-trips per variant executeMovement needs for the
    // general (concurrent, unknown-prior-stock) case.
    const idBySku = new Map(createdVariants.map((v) => [v.sku, v.id]));
    const stocked = data.variants
      .filter((v) => v.openingStock > 0)
      .map((v) => {
        const id = idBySku.get(v.sku);
        if (!id) {
          throw new AppError(
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            `Variant ${v.sku} was not persisted; opening stock cannot be applied.`
          );
        }
        return { v, id };
      });

    if (stocked.length > 0) {
      await tx.inventoryMovement.createMany({
        data: stocked.map(({ v, id }) => ({
          variantId: id,
          employeeId: executorId,
          type: "OPENING_STOCK" as const,
          quantityChanged: v.openingStock,
          stockBefore: 0,
          stockAfter: v.openingStock,
          reason: "Opening stock (product creation wizard)",
        })),
      });

      // Apply the stock itself. Variants sharing an opening quantity are updated
      // together, so this is one statement per DISTINCT quantity (typically one).
      const byQty = new Map<number, string[]>();
      for (const { v, id } of stocked) {
        const ids = byQty.get(v.openingStock);
        if (ids) ids.push(id);
        else byQty.set(v.openingStock, [id]);
      }
      await Promise.all(
        [...byQty].map(([qty, ids]) =>
          tx.productVariant.updateMany({
            where: { id: { in: ids } },
            data: { currentStock: qty },
          })
        )
      );
    }

    // 5. Derive the authoritative selling prices, inside the same transaction.
    // A discount rule may already target this product's category, in which case
    // the shelf price is NOT simply the value typed into the wizard.
    await recomputeVariants(createdVariantIds, { tx });

    return createdProduct;
  });

  // 5. Audit (fire-and-forget, after the transaction commits).
  auditRepository.create({
    performedBy: executorId,
    action: "CREATE",
    module: "PRODUCT",
    tableName: "products",
    recordId: product.id,
    newData: {
      ...(product as unknown as Record<string, unknown>),
      variantCount: data.variants.length,
    },
  });

  logger.info(
    { executorId, productId: product.id, variants: data.variants.length },
    "[Owner] Full product created via wizard"
  );

  // Return the fully assembled detail (with variant rollups) for the client.
  return catalogService.getProductDetail(product.id);
}
