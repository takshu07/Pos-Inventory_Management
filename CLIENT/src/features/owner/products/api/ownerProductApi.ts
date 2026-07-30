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

// ── Full transactional create (product creation wizard) ───────────────────────

/**
 * Creates a product with all its variants in ONE server-side transaction.
 *
 * TIMEOUT: overrides the client's 15s default. This endpoint does far more work
 * than a normal request — product + N variants + N opening-stock movements +
 * audit, all inside a single transaction against a network-latency-bound
 * (Neon serverless) database. The server already budgets up to 15s to acquire a
 * connection plus 30s for the transaction itself (see SERVER config/prisma.ts
 * `transactionOptions`), so a 15s client timeout aborts requests the server is
 * still legitimately processing.
 *
 * That failure mode is worse than a slow request: axios gives up, the UI shows
 * "timeout of 15000ms exceeded", but the transaction keeps running and the
 * product IS created — so the user retries and creates a duplicate. The client
 * budget must therefore be at least the server's, plus headroom for transfer.
 */
const FULL_CREATE_TIMEOUT_MS = 60_000;

export async function createFullProduct(payload: unknown): Promise<ProductDetail> {
  const res = await apiClient.post<any>("/owner/products/full", payload, {
    timeout: FULL_CREATE_TIMEOUT_MS,
  });
  return res.data;
}

// ── Wizard lookups ────────────────────────────────────────────────────────────

export interface SizeOption {
  id: string;
  name: string;
}
export interface ColorOption {
  id: string;
  name: string;
  hexCode: string | null;
}
export interface SupplierOption {
  id: string;
  businessName: string;
}

export async function fetchSizeOptions(): Promise<SizeOption[]> {
  const res = await apiClient.get<any>("/owner/products/lookups/sizes");
  return res.data ?? [];
}
export async function fetchColorOptions(): Promise<ColorOption[]> {
  const res = await apiClient.get<any>("/owner/products/lookups/colors");
  return res.data ?? [];
}
export async function fetchSupplierOptions(): Promise<SupplierOption[]> {
  const res = await apiClient.get<any>("/owner/products/lookups/suppliers");
  return res.data ?? [];
}
