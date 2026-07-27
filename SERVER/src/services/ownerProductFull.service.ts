// =============================================================================
// FULL PRODUCT CREATE SERVICE  (product creation wizard backend)
//
// Creates a complete, sellable catalog item in ONE Prisma transaction:
//
//   Product → Variants → Inventory (opening stock) → Inventory Movements → Audit
//
// If any single step fails, the whole thing rolls back — no orphaned products,
// no half-stocked variants. Stock is applied through the same inventory-movement
// engine the rest of the app uses (OPENING_STOCK movements), so currentStock is
// never written directly and every unit is ledgered.
//
// Size/Color are provided by NAME; we resolve existing lookup rows case-
// insensitively or create them on the fly, so the wizard owner can introduce a
// new size/color inline without a separate admin trip.
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
import { executeMovement } from "./inventoryMovement.service";
import * as catalogService from "./catalog.service";
import type {
  CreateFullProductInput,
  FullProductVariantInput,
} from "../validation/ownerProductFull.validation";

// ─── Pre-flight validation (outside the transaction) ──────────────────────────
// Cheap existence/uniqueness checks run first so we fail fast with clear 4xx
// errors instead of aborting a transaction mid-flight.

async function preflight(data: CreateFullProductInput) {
  // Category must exist and be active.
  const category = await categoryRepository.findById(data.categoryId);
  if (!category || !category.isActive) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid or inactive category selected.");
  }

  // Brand (optional) must exist and be active.
  if (data.brandId) {
    const brand = await brandRepository.findById(data.brandId);
    if (!brand || !brand.isActive) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid or inactive brand selected.");
    }
  }

  // Product name must be unique.
  const existingName = await prisma.product.findFirst({
    where: { name: { equals: data.name, mode: "insensitive" } },
    select: { id: true },
  });
  if (existingName) {
    throw new AppError(HTTP_STATUS.CONFLICT, "A product with this name already exists.");
  }

  // SKUs must be globally unique (not already in the DB).
  const skus = data.variants.map((v) => v.sku);
  const skuClashes = await prisma.productVariant.findMany({
    where: { sku: { in: skus } },
    select: { sku: true },
  });
  if (skuClashes.length > 0) {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      `These SKUs are already in use: ${skuClashes.map((s) => s.sku).join(", ")}.`
    );
  }

  // Barcodes must be globally unique.
  const barcodes = data.variants.map((v) => v.barcode).filter((b): b is string => !!b);
  if (barcodes.length > 0) {
    const barcodeClashes = await prisma.productVariant.findMany({
      where: { barcode: { in: barcodes } },
      select: { barcode: true },
    });
    if (barcodeClashes.length > 0) {
      throw new AppError(
        HTTP_STATUS.CONFLICT,
        `These barcodes are already in use: ${barcodeClashes.map((b) => b.barcode).join(", ")}.`
      );
    }
  }

  return { categoryName: category.name };
}

// ─── Size / Color resolution (within the transaction) ─────────────────────────

async function resolveSizeId(tx: Prisma.TransactionClient, name: string): Promise<string> {
  const existing = await tx.size.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await tx.size.create({ data: { name } });
  return created.id;
}

async function resolveColorId(
  tx: Prisma.TransactionClient,
  name: string,
  hex?: string | null
): Promise<string> {
  const existing = await tx.color.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await tx.color.create({
    data: { name, ...(hex ? { hexCode: hex } : {}) },
  });
  return created.id;
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

    // 2. Variants + 3/4. Opening-stock movements
    const createdVariantIds: string[] = [];

    for (const v of data.variants) {
      const sizeId = await resolveSizeId(tx, v.sizeName);
      const colorId = await resolveColorId(tx, v.colorName, v.colorHex);

      const variant = await tx.productVariant.create({
        data: variantCreateData(v, createdProduct.id, sizeId, colorId),
      });
      createdVariantIds.push(variant.id);

      // Opening stock via the inventory-movement engine (ledgered, sets stock).
      if (v.openingStock > 0) {
        await executeMovement(
          {
            variantId: variant.id,
            employeeId: executorId,
            type: "OPENING_STOCK",
            quantityChanged: v.openingStock,
            reason: "Opening stock (product creation wizard)",
          },
          tx
        );
      }
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
