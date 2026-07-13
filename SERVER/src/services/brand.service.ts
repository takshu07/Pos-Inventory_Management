// =============================================================================
// BRAND SERVICE
// =============================================================================

import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import { brandRepository } from "../repositories/brand.repository";
import { auditRepository } from "../repositories/audit.repository";
import { logger } from "../config/logger";
import type { PaginatedResponse } from "../types/common.types";
import { stripUndefined } from "../utils/object";
import type {
  CreateBrandInput,
  ListBrandsQuery,
  UpdateBrandInput,
} from "../validation/catalog.validation";

export async function listBrands(query: ListBrandsQuery) {
  const { data, total } = await brandRepository.findMany(query);
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

export async function getBrandById(id: string) {
  const brand = await brandRepository.findById(id);

  if (!brand) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Brand not found.");
  }

  return brand;
}

export async function createBrand(data: CreateBrandInput, executorId: string) {
  const existing = await brandRepository.findByName(data.name);

  if (existing) {
    throw new AppError(HTTP_STATUS.CONFLICT, "A brand with this name already exists.");
  }

  const brand = await brandRepository.create({
    name: data.name,
    description: data.description ?? null,
    logoUrl: data.logoUrl ?? null,
  });

  auditRepository.create({
    performedBy: executorId,
    action: "CREATE",
    module: "BRAND",
    tableName: "brands",
    recordId: brand.id,
    newData: brand as unknown as Record<string, unknown>,
  });

  logger.info({ executorId, brandId: brand.id }, "Brand created");

  return brand;
}

export async function updateBrand(
  id: string,
  data: UpdateBrandInput,
  executorId: string
) {
  const targetBrand = await brandRepository.findById(id);

  if (!targetBrand) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Brand not found.");
  }

  if (data.name) {
    const existing = await brandRepository.findByName(data.name, id);
    if (existing) {
      throw new AppError(HTTP_STATUS.CONFLICT, "Another brand with this name already exists.");
    }
  }

  const updateData = stripUndefined(data);
  const updatedBrand = await brandRepository.update(id, updateData as any);

  auditRepository.create({
    performedBy: executorId,
    action: "UPDATE",
    module: "BRAND",
    tableName: "brands",
    recordId: id,
    oldData: targetBrand as unknown as Record<string, unknown>,
    newData: updatedBrand as unknown as Record<string, unknown>,
  });

  logger.info({ executorId, brandId: id }, "Brand updated");

  return updatedBrand;
}
