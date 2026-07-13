// =============================================================================
// CATEGORY SERVICE
// =============================================================================

import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import { categoryRepository } from "../repositories/category.repository";
import { auditRepository } from "../repositories/audit.repository";
import { logger } from "../config/logger";
import type { PaginatedResponse } from "../types/common.types";
import { stripUndefined } from "../utils/object";
import type {
  CreateCategoryInput,
  ListCategoriesQuery,
  UpdateCategoryInput,
} from "../validation/catalog.validation";

export async function listCategories(query: ListCategoriesQuery) {
  const { data, total } = await categoryRepository.findMany(query);
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

export async function getCategoryById(id: string) {
  const category = await categoryRepository.findById(id);

  if (!category) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Category not found.");
  }

  return category;
}

export async function createCategory(data: CreateCategoryInput, executorId: string) {
  const existing = await categoryRepository.findByName(data.name);

  if (existing) {
    throw new AppError(HTTP_STATUS.CONFLICT, "A category with this name already exists.");
  }

  const category = await categoryRepository.create({
    name: data.name,
    description: data.description ?? null,
    imageUrl: data.imageUrl ?? null,
    displayOrder: data.displayOrder,
  });

  auditRepository.create({
    performedBy: executorId,
    action: "CREATE",
    module: "CATEGORY",
    tableName: "categories",
    recordId: category.id,
    newData: category as unknown as Record<string, unknown>,
  });

  logger.info({ executorId, categoryId: category.id }, "Category created");

  return category;
}

export async function updateCategory(
  id: string,
  data: UpdateCategoryInput,
  executorId: string
) {
  const targetCategory = await categoryRepository.findById(id);

  if (!targetCategory) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Category not found.");
  }

  if (data.name) {
    const existing = await categoryRepository.findByName(data.name, id);
    if (existing) {
      throw new AppError(HTTP_STATUS.CONFLICT, "Another category with this name already exists.");
    }
  }

  const updateData = stripUndefined(data);
  const updatedCategory = await categoryRepository.update(id, updateData as any);

  auditRepository.create({
    performedBy: executorId,
    action: "UPDATE",
    module: "CATEGORY",
    tableName: "categories",
    recordId: id,
    oldData: targetCategory as unknown as Record<string, unknown>,
    newData: updatedCategory as unknown as Record<string, unknown>,
  });

  logger.info({ executorId, categoryId: id }, "Category updated");

  return updatedCategory;
}
