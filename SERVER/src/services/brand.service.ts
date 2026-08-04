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
import { projectBrandStats } from "../engines/procurement.engine";
import type {
  CreateBrandInput,
  ListBrandsQuery,
  UpdateBrandInput,
} from "../validation/catalog.validation";

/**
 * Attaches catalogue and sales statistics to a page of brands.
 *
 * Stats are fetched for the CURRENT PAGE only — a single extra query per page
 * regardless of how many brands exist. Postgres returns COUNT/SUM as BIGINT and
 * Decimal as string, neither of which survives JSON, so both are normalised to
 * numbers here rather than in every consumer.
 */
async function withStats<T extends { id: string }>(brands: T[]) {
  const rows = await brandRepository.statsFor(brands.map((b) => b.id));
  const byId = new Map(rows.map((r) => [r.brandId, r]));

  return brands.map((brand) => ({
    ...brand,
    stats: projectBrandStats(byId.get(brand.id)),
  }));
}

export async function listBrands(query: ListBrandsQuery) {
  const { data, total } = await brandRepository.findMany(query);
  const totalPages = Math.ceil(total / query.limit);
  const enriched = await withStats(data);

  const response: PaginatedResponse<(typeof enriched)[0]> = {
    data: enriched,
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

  const [enriched] = await withStats([brand]);
  return enriched;
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

/**
 * Deletes a brand outright.
 *
 * Only ever permitted for a brand nothing references. Products hold a
 * `Restrict` foreign key to Brand, so deleting a referenced brand would fail at
 * the database anyway — this turns that raw constraint error into an actionable
 * message and points at the right alternative. Deactivating is the correct move
 * for a brand with history: it preserves every historical product and sale
 * while removing the brand from pickers.
 */
export async function deleteBrand(id: string, executorId: string) {
  const brand = await brandRepository.findById(id);

  if (!brand) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Brand not found.");
  }

  const productCount = await brandRepository.referenceCount(id);

  if (productCount > 0) {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      `${brand.name} still has ${productCount} product(s). Deactivate the brand instead of deleting it.`,
      { reason: "BRAND_IN_USE", productCount }
    );
  }

  await brandRepository.remove(id);

  auditRepository.create({
    performedBy: executorId,
    action: "DELETE",
    module: "BRAND",
    tableName: "brands",
    recordId: id,
    oldData: brand as unknown as Record<string, unknown>,
  });

  logger.info({ executorId, brandId: id }, "Brand deleted");

  return { id };
}
