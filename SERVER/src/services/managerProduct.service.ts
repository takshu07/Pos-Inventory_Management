// =============================================================================
// MANAGER PRODUCT SERVICE
//
// Operational, READ-ONLY catalog for managers. Reads delegate to the shared
// catalog.service (no duplicated aggregation logic), then STRIP every financial
// field before the data leaves this layer:
//   • costPrice / avgCostPrice
//   • margin / avgMargin
//   • inventoryValue
// Managers assist customers; they never see profit, cost, or inventory value.
//
// There are intentionally NO write functions in this module.
// =============================================================================

import * as catalogService from "./catalog.service";
import { categoryRepository } from "../repositories/category.repository";
import { brandRepository } from "../repositories/brand.repository";
import type { PaginatedResponse } from "../types/common.types";
import type {
  ManagerListProductsQuery,
  ManagerSearchQuery,
} from "../validation/managerProduct.validation";

// The manager-facing row: the shared CatalogRow with all financial fields removed.
export type ManagerCatalogRow = Omit<
  catalogService.CatalogRow,
  "avgCostPrice" | "avgMargin" | "inventoryValue"
>;

function stripFinancials(row: catalogService.CatalogRow): ManagerCatalogRow {
  const { avgCostPrice: _c, avgMargin: _m, inventoryValue: _v, ...safe } = row;
  return safe;
}

function toCatalogQuery(query: ManagerListProductsQuery): catalogService.CatalogListQuery {
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

export async function listProducts(
  query: ManagerListProductsQuery
): Promise<PaginatedResponse<ManagerCatalogRow>> {
  const result = await catalogService.listProducts(toCatalogQuery(query));
  return { ...result, data: result.data.map(stripFinancials) };
}

/**
 * Fast typeahead search for the manager lookup. Returns a flat, bounded list of
 * financial-free rows ordered by relevance-ish recency. Accepts an AbortSignal
 * pathway implicitly via the controller (React Query cancels stale requests).
 */
export async function searchProducts(query: ManagerSearchQuery): Promise<ManagerCatalogRow[]> {
  const result = await catalogService.listProducts({
    page: 1,
    limit: query.limit,
    search: query.q || undefined,
    isActive: true, // lookup only surfaces active catalog items
    sortBy: "name",
    sortOrder: "asc",
  });
  return result.data.map(stripFinancials);
}

/**
 * Full product detail for the read-only drawer — financial fields removed from
 * both the rollup and every variant (managers never see costPrice/margin).
 */
export async function getProductById(id: string) {
  const detail = await catalogService.getProductDetail(id);

  const { avgMargin: _m, inventoryValue: _v, ...rollup } = detail.rollup;

  const variants = detail.variants.map((v) => {
    // Strip everything a manager must never see: cost, supplier linkage,
    // discount ceilings. They keep price/stock/barcode/size/color/location.
    const {
      costPrice: _cost,
      supplierId: _sid,
      supplierSku: _ssku,
      leadTimeDays: _lt,
      maxDiscountPct: _mdp,
      ...safeVariant
    } = v as typeof v & {
      supplierId?: unknown;
      supplierSku?: unknown;
      leadTimeDays?: unknown;
      maxDiscountPct?: unknown;
    };
    return safeVariant;
  });

  return { ...detail, variants, rollup };
}

// ─── Filter option sources (reuse existing catalog modules) ───────────────────
// The spec asks for manager category/brand filter endpoints. Rather than
// duplicate the category/brand modules, we surface a lightweight active-only
// projection sourced from their repositories.

export async function listCategories() {
  const { data } = await categoryRepository.findMany({ page: 1, limit: 100, isActive: true });
  return data.map((c) => ({ id: c.id, name: c.name }));
}

export async function listBrands() {
  const { data } = await brandRepository.findMany({ page: 1, limit: 100, isActive: true });
  return data.map((b) => ({ id: b.id, name: b.name }));
}
