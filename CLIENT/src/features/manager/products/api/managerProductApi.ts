/**
 * Manager Products — transport layer.
 *
 * Talks to /api/v1/manager/products. READ-ONLY: there are no create/update/
 * delete calls here because the manager module has no write capability. The
 * backend strips all financial fields before responding, so nothing sensitive
 * ever reaches this layer.
 */

import { apiClient } from "@/lib/api/axios";
import type { FilterOption, ProductDetail, ProductRow } from "@/shared/product";

export interface ManagerListParams {
  page: number;
  limit: number;
  search?: string;
  categoryId?: string;
  brandId?: string;
  isActive?: string;
  stockStatus?: string;
  minPrice?: string;
  maxPrice?: string;
  sortBy?: string;
}

export interface ManagerListResult {
  data: ProductRow[];
  total: number;
}

function clean(params: object) {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== "" && v !== null && v !== undefined)
  );
}

export async function fetchManagerProducts(params: ManagerListParams): Promise<ManagerListResult> {
  const res = await apiClient.get<any>("/manager/products", { params: clean(params) });
  return {
    data: res.data?.data ?? [],
    total: res.data?.meta?.total ?? 0,
  };
}

/** Fast typeahead. Accepts an AbortSignal so stale keystrokes are cancelled. */
export async function searchManagerProducts(
  q: string,
  limit: number,
  signal?: AbortSignal
): Promise<ProductRow[]> {
  const res = await apiClient.get<any>("/manager/products/search", {
    params: { q, limit },
    signal,
  });
  return res.data ?? [];
}

export async function fetchManagerProduct(id: string): Promise<ProductDetail> {
  const res = await apiClient.get<any>(`/manager/products/${id}`);
  return res.data;
}

export async function fetchManagerCategories(): Promise<FilterOption[]> {
  const res = await apiClient.get<any>("/manager/products/categories");
  return res.data ?? [];
}

export async function fetchManagerBrands(): Promise<FilterOption[]> {
  const res = await apiClient.get<any>("/manager/products/brands");
  return res.data ?? [];
}
