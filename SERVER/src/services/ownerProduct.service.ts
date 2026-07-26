// =============================================================================
// OWNER PRODUCT SERVICE
//
// Complete catalog administration. READ operations delegate to the shared
// catalog.service (never duplicated); WRITE operations (create/update/archive/
// restore/delete/duplicate, pricing, stock) live here because only the Owner
// module may mutate the catalog.
//
// Stock changes are delegated to the inventory-movement engine so currentStock
// is never written directly and every change is ledgered + audited.
// =============================================================================

import type { Prisma } from "../../generated/prisma";
import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import { logger } from "../config/logger";
import { prisma } from "../config/prisma";
import { productRepository } from "../repositories/product.repository";
import { categoryRepository } from "../repositories/category.repository";
import { brandRepository } from "../repositories/brand.repository";
import { auditRepository } from "../repositories/audit.repository";
import { stripUndefined } from "../utils/object";
import * as catalogService from "./catalog.service";
import { createManualAdjustment } from "./inventoryMovement.service";
import type {
  OwnerCreateProductInput,
  OwnerListProductsQuery,
  OwnerPricingUpdateInput,
  OwnerStockAdjustInput,
  OwnerUpdateProductInput,
} from "../validation/ownerProduct.validation";

// ─── Query normalization ──────────────────────────────────────────────────────

function toCatalogQuery(query: OwnerListProductsQuery): catalogService.CatalogListQuery {
  // "newest" is UI sugar for createdAt desc.
  const sortBy = query.sortBy === "newest" ? "createdAt" : query.sortBy;
  return {
    page: query.page,
    limit: query.limit,
    search: query.search,
    categoryId: query.categoryId,
    brandId: query.brandId,
    isActive: query.isActive,
    stockStatus: query.stockStatus,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    sortBy,
    sortOrder: query.sortOrder,
  };
}

// ─── Reads (delegate to shared catalog service) ───────────────────────────────

export function listProducts(query: OwnerListProductsQuery) {
  return catalogService.listProducts(toCatalogQuery(query));
}

export function getProductById(id: string) {
  return catalogService.getProductDetail(id);
}

/** Full catalog statistics — owner sees financial fields (value, margin). */
export function getStats() {
  return catalogService.getCatalogStats();
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export async function createProduct(data: OwnerCreateProductInput, executorId: string) {
  const category = await categoryRepository.findById(data.categoryId);
  if (!category || !category.isActive) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid or inactive category selected.");
  }

  if (data.brandId) {
    const brand = await brandRepository.findById(data.brandId);
    if (!brand || !brand.isActive) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid or inactive brand selected.");
    }
  }

  const existing = await productRepository.findByName(data.name);
  if (existing) {
    throw new AppError(HTTP_STATUS.CONFLICT, "A product with this name already exists.");
  }

  const product = await productRepository.create({
    name: data.name,
    description: data.description ?? null,
    searchKeywords: data.searchKeywords ?? null,
    imageUrls: data.imageUrls ?? [],
    category: { connect: { id: data.categoryId } },
    ...(data.brandId && { brand: { connect: { id: data.brandId } } }),
  });

  auditRepository.create({
    performedBy: executorId,
    action: "CREATE",
    module: "PRODUCT",
    tableName: "products",
    recordId: product.id,
    newData: product as unknown as Record<string, unknown>,
  });

  logger.info({ executorId, productId: product.id }, "[Owner] Product created");
  return product;
}

export async function updateProduct(
  id: string,
  data: OwnerUpdateProductInput,
  executorId: string
) {
  const target = await productRepository.findById(id);
  if (!target) throw new AppError(HTTP_STATUS.NOT_FOUND, "Product not found.");

  if (data.categoryId && data.categoryId !== target.categoryId) {
    const category = await categoryRepository.findById(data.categoryId);
    if (!category || !category.isActive) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid or inactive category selected.");
    }
  }

  if (data.brandId && data.brandId !== target.brandId) {
    const brand = await brandRepository.findById(data.brandId);
    if (!brand || !brand.isActive) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid or inactive brand selected.");
    }
  }

  if (data.name) {
    const existing = await productRepository.findByName(data.name, id);
    if (existing) {
      throw new AppError(HTTP_STATUS.CONFLICT, "Another product with this name already exists.");
    }
  }

  const { categoryId, brandId, ...rest } = data;
  const payload: Record<string, unknown> = { ...stripUndefined(rest) };
  if (categoryId) payload["category"] = { connect: { id: categoryId } };
  if (brandId !== undefined) {
    payload["brand"] = brandId === null ? { disconnect: true } : { connect: { id: brandId } };
  }

  const updated = await productRepository.update(id, payload);

  auditRepository.create({
    performedBy: executorId,
    action: "UPDATE",
    module: "PRODUCT",
    tableName: "products",
    recordId: id,
    oldData: target as unknown as Record<string, unknown>,
    newData: updated as unknown as Record<string, unknown>,
  });

  logger.info({ executorId, productId: id }, "[Owner] Product updated");
  return updated;
}

/** Archive = soft-delete (isActive false). Restore = reactivate. */
export function archiveProduct(id: string, executorId: string) {
  return updateProduct(id, { isActive: false }, executorId);
}

export function restoreProduct(id: string, executorId: string) {
  return updateProduct(id, { isActive: true }, executorId);
}

/**
 * Hard delete. Blocked when the product has variants that participate in sales/
 * purchases/inventory history (the FK relations are onDelete: Restrict). We fail
 * fast with a clear message rather than surfacing a raw Prisma constraint error;
 * archiving is the safe alternative and is what the UI steers owners toward.
 */
export async function deleteProduct(id: string, executorId: string) {
  const target = await productRepository.findById(id);
  if (!target) throw new AppError(HTTP_STATUS.NOT_FOUND, "Product not found.");

  const variantCount = await prisma.productVariant.count({ where: { productId: id } });
  if (variantCount > 0) {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      "Cannot delete a product that has variants. Delete its variants first, or archive the product instead."
    );
  }

  await prisma.product.delete({ where: { id } });

  auditRepository.create({
    performedBy: executorId,
    action: "DELETE",
    module: "PRODUCT",
    tableName: "products",
    recordId: id,
    oldData: target as unknown as Record<string, unknown>,
  });

  logger.info({ executorId, productId: id }, "[Owner] Product deleted");
  return { id };
}

/**
 * Duplicate a product's core fields (not its variants — SKUs/barcodes are
 * unique and must be re-issued deliberately). The copy is created inactive with
 * a "(Copy)" suffix so the owner can review before publishing.
 */
export async function duplicateProduct(id: string, executorId: string) {
  const source = await prisma.product.findUnique({ where: { id } });
  if (!source) throw new AppError(HTTP_STATUS.NOT_FOUND, "Product not found.");

  let name = `${source.name} (Copy)`;
  // Ensure the duplicated name is unique.
  let n = 2;
  while (await productRepository.findByName(name)) {
    name = `${source.name} (Copy ${n++})`;
  }

  const copy = await productRepository.create({
    name,
    description: source.description,
    searchKeywords: source.searchKeywords,
    imageUrls: source.imageUrls,
    category: { connect: { id: source.categoryId } },
    ...(source.brandId && { brand: { connect: { id: source.brandId } } }),
  });

  // Created copies start inactive until the owner adds variants and publishes.
  const inactiveCopy = await productRepository.update(copy.id, { isActive: false });

  auditRepository.create({
    performedBy: executorId,
    action: "CREATE",
    module: "PRODUCT",
    tableName: "products",
    recordId: copy.id,
    newData: inactiveCopy as unknown as Record<string, unknown>,
  });

  logger.info({ executorId, sourceId: id, copyId: copy.id }, "[Owner] Product duplicated");
  return inactiveCopy;
}

// ─── Pricing & Stock (variant-level) ──────────────────────────────────────────

/**
 * Update a variant's prices. Stock is NEVER touched here — that goes through
 * adjustStock so it is ledgered.
 */
export async function updatePricing(data: OwnerPricingUpdateInput, executorId: string) {
  const variant = await prisma.productVariant.findUnique({ where: { id: data.variantId } });
  if (!variant) throw new AppError(HTTP_STATUS.NOT_FOUND, "Product variant not found.");

  const payload = stripUndefined({
    costPrice: data.costPrice,
    sellingPrice: data.sellingPrice,
    mrp: data.mrp,
  });

  if (Object.keys(payload).length === 0) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "No pricing fields provided.");
  }

  const updated = await prisma.productVariant.update({
    where: { id: data.variantId },
    data: payload as Prisma.ProductVariantUpdateInput,
  });

  auditRepository.create({
    performedBy: executorId,
    action: "UPDATE",
    module: "PRODUCT",
    tableName: "product_variants",
    recordId: data.variantId,
    oldData: variant as unknown as Record<string, unknown>,
    newData: updated as unknown as Record<string, unknown>,
  });

  logger.info({ executorId, variantId: data.variantId }, "[Owner] Variant pricing updated");
  return updated;
}

/**
 * Adjust a variant's stock via the inventory-movement engine (ledgered + audited,
 * never a direct currentStock write).
 */
export function adjustStock(data: OwnerStockAdjustInput, executorId: string) {
  return createManualAdjustment(
    {
      variantId: data.variantId,
      type: "MANUAL_ADJUSTMENT",
      quantityChanged: data.quantityDelta,
      reason: data.reason,
    },
    executorId
  );
}

// ─── Advanced operations (stubbed — RBAC-enforced, feature pending) ────────────
// These endpoints exist and are OWNER-gated so the API surface + frontend can be
// built against them, but the heavy implementation (CSV parsing, PDF label
// generation, barcode/QR image rendering, bulk transactions) is deliberately
// deferred to a follow-up pass. Each returns 501 with a clear message rather
// than silently succeeding.

function notImplemented(feature: string): never {
  throw new AppError(
    HTTP_STATUS.NOT_IMPLEMENTED,
    `${feature} is not yet available. This endpoint is scaffolded and RBAC-protected; implementation is scheduled for a follow-up release.`
  );
}

export function importProducts(): never {
  return notImplemented("Bulk product import");
}

export function exportProducts(): never {
  return notImplemented("Product export");
}
