/**
 * Owner Products — transport layer.
 *
 * Talks to /api/v1/owner/products (baseURL already includes /api/v1). Every
 * endpoint here is OWNER-only server-side; the frontend guard is convenience,
 * the 403 from the backend is the real boundary.
 *
 * The axios response interceptor unwraps the { success, message, data } envelope
 * to `data`, so a paginated call resolves to `{ data: [...], meta: {...} }` and
 * a single call resolves to the entity.
 */

import { apiClient } from "@/lib/api/axios";
import type {
  CatalogStats,
  ProductDetail,
  ProductRow,
} from "@/shared/product";

export interface OwnerListParams {
  page: number;
  limit: number;
  search?: string;
  categoryId?: string;
  brandId?: string;
  isActive?: string; // "true" | "false"
  stockStatus?: string;
  minPrice?: string;
  maxPrice?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface OwnerListResult {
  data: ProductRow[];
  total: number;
}

function clean(params: object) {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, v]) => v !== "" && v !== null && v !== undefined
    )
  );
}

export async function fetchOwnerProducts(params: OwnerListParams): Promise<OwnerListResult> {
  const res = await apiClient.get<any>("/owner/products", { params: clean(params) });
  return {
    data: res.data?.data ?? [],
    total: res.data?.meta?.total ?? 0,
  };
}

export async function fetchOwnerStats(): Promise<CatalogStats> {
  const res = await apiClient.get<any>("/owner/products/stats");
  return res.data;
}

export async function fetchOwnerProduct(id: string): Promise<ProductDetail> {
  const res = await apiClient.get<any>(`/owner/products/${id}`);
  return res.data;
}

export interface ProductWriteInput {
  name: string;
  description?: string | null;
  categoryId: string;
  brandId?: string | null;
  imageUrls?: string[];
  searchKeywords?: string;
  isActive?: boolean;
}

export async function createOwnerProduct(input: ProductWriteInput): Promise<ProductDetail> {
  const res = await apiClient.post<any>("/owner/products", input);
  return res.data;
}

export async function updateOwnerProduct(
  id: string,
  input: Partial<ProductWriteInput>
): Promise<ProductDetail> {
  const res = await apiClient.patch<any>(`/owner/products/${id}`, input);
  return res.data;
}

export async function deleteOwnerProduct(id: string): Promise<{ id: string }> {
  const res = await apiClient.delete<any>(`/owner/products/${id}`);
  return res.data;
}

export async function archiveOwnerProduct(id: string): Promise<ProductDetail> {
  const res = await apiClient.post<any>(`/owner/products/${id}/archive`);
  return res.data;
}

export async function restoreOwnerProduct(id: string): Promise<ProductDetail> {
  const res = await apiClient.post<any>(`/owner/products/${id}/restore`);
  return res.data;
}

export async function duplicateOwnerProduct(id: string): Promise<ProductDetail> {
  const res = await apiClient.post<any>(`/owner/products/${id}/duplicate`);
  return res.data;
}

export async function adjustOwnerStock(input: {
  variantId: string;
  quantityDelta: number;
  reason: string;
}): Promise<unknown> {
  const res = await apiClient.patch<any>("/owner/products/stock", input);
  return res.data;
}

export async function updateOwnerPricing(input: {
  variantId: string;
  costPrice?: number;
  sellingPrice?: number;
  mrp?: number;
}): Promise<unknown> {
  const res = await apiClient.patch<any>("/owner/products/pricing", input);
  return res.data;
}
