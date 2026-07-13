// =============================================================================
// PRODUCT SERVICE
// =============================================================================

import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import { productRepository } from "../repositories/product.repository";
import { categoryRepository } from "../repositories/category.repository";
import { brandRepository } from "../repositories/brand.repository";
import { auditRepository } from "../repositories/audit.repository";
import { logger } from "../config/logger";
import type { PaginatedResponse } from "../types/common.types";
import { stripUndefined } from "../utils/object";
import type {
  CreateProductInput,
  ListProductsQuery,
  UpdateProductInput,
} from "../validation/product.validation";

export async function listProducts(query: ListProductsQuery) {
  const { data, total } = await productRepository.findMany(query);
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

export async function getProductById(id: string) {
  const product = await productRepository.findById(id);

  if (!product) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Product not found.");
  }

  return product;
}

export async function createProduct(data: CreateProductInput, executorId: string) {
  // 1. Verify Category exists and is active
  const category = await categoryRepository.findById(data.categoryId);
  if (!category || !category.isActive) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid or inactive category selected.");
  }

  // 2. Verify Brand exists and is active (if provided)
  if (data.brandId) {
    const brand = await brandRepository.findById(data.brandId);
    if (!brand || !brand.isActive) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid or inactive brand selected.");
    }
  }

  // 3. Enforce Unique Name
  const existing = await productRepository.findByName(data.name);
  if (existing) {
    throw new AppError(HTTP_STATUS.CONFLICT, "A product with this name already exists.");
  }

  // 4. Create Product
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

  logger.info({ executorId, productId: product.id }, "Product created");

  return product;
}

export async function updateProduct(
  id: string,
  data: UpdateProductInput,
  executorId: string
) {
  const targetProduct = await productRepository.findById(id);

  if (!targetProduct) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Product not found.");
  }

  // 1. Verify Category
  if (data.categoryId && data.categoryId !== targetProduct.categoryId) {
    const category = await categoryRepository.findById(data.categoryId);
    if (!category || !category.isActive) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid or inactive category selected.");
    }
  }

  // 2. Verify Brand
  if (data.brandId && data.brandId !== targetProduct.brandId) {
    const brand = await brandRepository.findById(data.brandId);
    if (!brand || !brand.isActive) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid or inactive brand selected.");
    }
  }

  // 3. Enforce Unique Name
  if (data.name) {
    const existing = await productRepository.findByName(data.name, id);
    if (existing) {
      throw new AppError(HTTP_STATUS.CONFLICT, "Another product with this name already exists.");
    }
  }

  // 4. Future-proofing constraint: Prevent archiving if active variants exist
  if (data.isActive === false && targetProduct.isActive === true) {
    const hasVariants = await productRepository.hasActiveVariants(id);
    if (hasVariants) {
      throw new AppError(
        HTTP_STATUS.CONFLICT,
        "Cannot archive product because it still has active variants. Archive or delete variants first."
      );
    }
  }

  // 5. Build update payload correctly matching Prisma relations
  const { categoryId, brandId, ...restData } = data;
  const updatePayload: any = { ...stripUndefined(restData) };
  
  if (categoryId) {
    updatePayload.category = { connect: { id: categoryId } };
  }
  
  // Explicitly handle nulling out the brand versus connecting a new one
  if (brandId !== undefined) {
    if (brandId === null) {
      updatePayload.brand = { disconnect: true };
    } else {
      updatePayload.brand = { connect: { id: brandId } };
    }
  }

  const updatedProduct = await productRepository.update(id, updatePayload);

  auditRepository.create({
    performedBy: executorId,
    action: "UPDATE",
    module: "PRODUCT",
    tableName: "products",
    recordId: id,
    oldData: targetProduct as unknown as Record<string, unknown>,
    newData: updatedProduct as unknown as Record<string, unknown>,
  });

  logger.info({ executorId, productId: id }, "Product updated");

  return updatedProduct;
}
