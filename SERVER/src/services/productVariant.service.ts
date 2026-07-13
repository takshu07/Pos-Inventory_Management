// =============================================================================
// PRODUCT VARIANT SERVICE
// =============================================================================

import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import { productVariantRepository } from "../repositories/productVariant.repository";
import { productRepository } from "../repositories/product.repository";
import { auditRepository } from "../repositories/audit.repository";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import type { PaginatedResponse } from "../types/common.types";
import { stripUndefined } from "../utils/object";
import type {
  CreateProductVariantInput,
  ListProductVariantsQuery,
  UpdateProductVariantInput,
} from "../validation/productVariant.validation";

export async function listProductVariants(query: ListProductVariantsQuery) {
  const { data, total } = await productVariantRepository.findMany(query);
  const totalPages = Math.ceil(total / query.limit);

  const response: PaginatedResponse<(typeof data)[0]> = {
    data,
    meta: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPreviousPage: query.page > 1,
    },
  };

  return response;
}

export async function getProductVariantById(id: string) {
  const variant = await productVariantRepository.findById(id);

  if (!variant) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Product Variant not found.");
  }

  return variant;
}

export async function getProductVariantByBarcode(barcode: string) {
  const variant = await productVariantRepository.findByBarcode(barcode);

  if (!variant) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Product Variant not found for this barcode.");
  }

  return variant;
}

export async function createProductVariant(data: CreateProductVariantInput, executorId: string) {
  // 1. Verify Parent Product exists and is active
  const product = await productRepository.findById(data.productId);
  if (!product || !product.isActive) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Cannot create a variant for an invalid or inactive Product.");
  }

  // 2. Verify Size and Color (Inline check since repositories may not exist yet)
  const size = await prisma.size.findUnique({ where: { id: data.sizeId } });
  if (!size || !size.isActive) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid or inactive Size selected.");
  }

  const color = await prisma.color.findUnique({ where: { id: data.colorId } });
  if (!color || !color.isActive) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid or inactive Color selected.");
  }

  // 3. Verify Constraints (SKU, Barcode, Combination)
  const { existingSku, existingBarcode } = await productVariantRepository.checkConstraints(data.sku, data.barcode);
  if (existingSku) throw new AppError(HTTP_STATUS.CONFLICT, "This SKU is already in use.");
  if (existingBarcode) throw new AppError(HTTP_STATUS.CONFLICT, "This Barcode is already in use.");

  const existingCombo = await productVariantRepository.checkCombination(data.productId, data.sizeId, data.colorId);
  if (existingCombo) {
    throw new AppError(HTTP_STATUS.CONFLICT, "A variant with this exact Product, Size, and Color already exists.");
  }

  // 4. Create Variant (Notice: currentStock is strictly omitted. Only Inventory adjustments can alter stock)
  const variant = await productVariantRepository.create({
    sku: data.sku,
    barcode: data.barcode ?? null,
    costPrice: data.costPrice,
    sellingPrice: data.sellingPrice,
    mrp: data.mrp,
    reorderLevel: data.reorderLevel,
    maximumStock: data.maximumStock ?? null,
    weight: data.weight ?? null,
    imageUrl: data.imageUrl ?? null,
    product: { connect: { id: data.productId } },
    size: { connect: { id: data.sizeId } },
    color: { connect: { id: data.colorId } },
  });

  auditRepository.create({
    performedBy: executorId,
    action: "CREATE",
    module: "PRODUCT", // Conceptually part of the product module
    tableName: "product_variants",
    recordId: variant.id,
    newData: variant as unknown as Record<string, unknown>,
  });

  logger.info({ executorId, variantId: variant.id }, "Product Variant created");

  return variant;
}

export async function updateProductVariant(
  id: string,
  data: UpdateProductVariantInput,
  executorId: string
) {
  const target = await productVariantRepository.findById(id);
  if (!target) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Product Variant not found.");
  }

  // 1. Validate pricing logic on partial updates
  const newCostPrice = data.costPrice ?? target.costPrice;
  const newSellingPrice = data.sellingPrice ?? target.sellingPrice;
  const newMrp = data.mrp ?? target.mrp;

  if (newSellingPrice.lt(newCostPrice)) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Selling price cannot be lower than cost price.");
  }
  if (newMrp.lt(newSellingPrice)) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "MRP cannot be lower than selling price.");
  }

  // 2. Size and Color existence validation if they are changing
  if (data.sizeId && data.sizeId !== target.sizeId) {
    const size = await prisma.size.findUnique({ where: { id: data.sizeId } });
    if (!size || !size.isActive) throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid or inactive Size.");
  }

  if (data.colorId && data.colorId !== target.colorId) {
    const color = await prisma.color.findUnique({ where: { id: data.colorId } });
    if (!color || !color.isActive) throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid or inactive Color.");
  }

  // 3. Constraints (SKU, Barcode, Combination)
  if (data.sku || data.barcode) {
    const skuToCheck = data.sku ?? target.sku;
    const barcodeToCheck = data.barcode !== undefined ? data.barcode : target.barcode;
    const { existingSku, existingBarcode } = await productVariantRepository.checkConstraints(skuToCheck, barcodeToCheck, id);
    if (existingSku) throw new AppError(HTTP_STATUS.CONFLICT, "This SKU is already in use.");
    if (existingBarcode) throw new AppError(HTTP_STATUS.CONFLICT, "This Barcode is already in use.");
  }

  if (data.sizeId || data.colorId) {
    const sId = data.sizeId ?? target.sizeId;
    const cId = data.colorId ?? target.colorId;
    const existingCombo = await productVariantRepository.checkCombination(target.productId, sId, cId, id);
    if (existingCombo) throw new AppError(HTTP_STATUS.CONFLICT, "A variant with this exact Product, Size, and Color already exists.");
  }

  // 4. Build Update Payload
  const { sizeId, colorId, ...restData } = data;
  const updatePayload: any = { ...stripUndefined(restData) };

  if (sizeId) updatePayload.size = { connect: { id: sizeId } };
  if (colorId) updatePayload.color = { connect: { id: colorId } };
  
  // NOTE: We do not allow changing the `productId` once a variant is created to prevent accounting/inventory nightmares.

  const updatedVariant = await productVariantRepository.update(id, updatePayload);

  auditRepository.create({
    performedBy: executorId,
    action: "UPDATE",
    module: "PRODUCT",
    tableName: "product_variants",
    recordId: id,
    oldData: target as unknown as Record<string, unknown>,
    newData: updatedVariant as unknown as Record<string, unknown>,
  });

  logger.info({ executorId, variantId: id }, "Product Variant updated");

  return updatedVariant;
}
