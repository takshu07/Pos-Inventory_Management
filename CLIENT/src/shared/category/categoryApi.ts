/**
 * Category transport layer.
 *
 * ONE module serves both portals, differing only in base path:
 *   OWNER   → /owner/categories    (full administration)
 *   MANAGER → /manager/categories  (read-only; write helpers are never called)
 *
 * The base path is chosen from the caller's role, so a manager's UI physically
 * cannot issue a request to an owner endpoint. That is convenience, not
 * security — the server returns 403 regardless. Both layers are required.
 *
 * The axios response interceptor unwraps `{ success, message, data }` to `data`,
 * so a paginated call resolves to `{ data: [...], meta: {...} }` and a single
 * call resolves to the entity.
 */

import { apiClient } from "@/lib/api/axios";
import type { Role } from "@/types";
import type {
  CategoryActivityEvent,
  CategoryAnalyticsDashboard,
  CategoryDiscount,
  CategoryProductRow,
  CategoryRow,
  CategorySummary,
  SingleCategoryAnalytics,
} from "./types";

/** Resolves the base path for a role. OWNER gets the administration surface. */
export function categoryBase(role: Role | null): string {
  return role === "OWNER" ? "/owner/categories" : "/manager/categories";
}

export interface CategoryListParams {
  page: number;
  limit: number;
  search?: string | undefined;
  status?: string | undefined;
  hasProducts?: string | undefined;
  createdFrom?: string | undefined;
  createdTo?: string | undefined;
  sortBy?: string | undefined;
  includeArchived?: string | undefined;
}

export interface PaginatedMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface CategoryListResult {
  data: CategoryRow[];
  meta: PaginatedMeta;
}

/** Strips empty values so they never reach the server as `?status=`. */
function clean(params: object): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params)
      .filter(([, v]) => v !== "" && v !== null && v !== undefined)
      .map(([k, v]) => [k, String(v)])
  );
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function fetchCategories(
  base: string,
  params: CategoryListParams
): Promise<CategoryListResult> {
  const res = await apiClient.get<any>(base, { params: clean(params) });
  return {
    data: res.data?.data ?? [],
    meta: res.data?.meta ?? {
      total: 0,
      page: 1,
      limit: params.limit,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  };
}

export async function fetchCategorySummary(base: string): Promise<CategorySummary> {
  const res = await apiClient.get<any>(`${base}/summary`);
  return res.data;
}

export async function fetchCategory(base: string, id: string): Promise<CategoryRow> {
  const res = await apiClient.get<any>(`${base}/${id}`);
  return res.data;
}

export interface CategoryOption {
  id: string;
  name: string;
  productCount: number;
}

export async function fetchCategoryOptions(
  base: string,
  excludeId?: string
): Promise<CategoryOption[]> {
  const res = await apiClient.get<any>(`${base}/options`, {
    params: excludeId ? { exclude: excludeId } : {},
  });
  return res.data ?? [];
}

export async function fetchCategoryProducts(
  base: string,
  id: string,
  params: { page: number; limit: number; search?: string; sortBy?: string }
): Promise<{ data: CategoryProductRow[]; meta: PaginatedMeta }> {
  const res = await apiClient.get<any>(`${base}/${id}/products`, { params: clean(params) });
  return {
    data: res.data?.data ?? [],
    meta: res.data?.meta ?? {
      total: 0,
      page: 1,
      limit: params.limit,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  };
}

// ── Writes (OWNER only — the manager UI never reaches these) ─────────────────

export interface CategoryWriteInput {
  name: string;
  description?: string | null;
  searchKeywords?: string | null;
  imageUrl?: string | null;
  status?: string;
  displayOrder?: number;
}

export async function createCategory(input: CategoryWriteInput): Promise<CategoryRow> {
  const res = await apiClient.post<any>("/owner/categories", input);
  return res.data;
}

export async function updateCategory(
  id: string,
  input: Partial<CategoryWriteInput>
): Promise<CategoryRow> {
  const res = await apiClient.patch<any>(`/owner/categories/${id}`, input);
  return res.data;
}

export interface DeleteCategoryResult {
  id: string;
  name: string;
  movedProducts: number;
  movedTo: { id: string; name: string } | null;
}

/**
 * Delete a category. When it still holds products the server responds 409 with
 * `details.reason === "CATEGORY_NOT_EMPTY"`; pass `reassignToId` to move the
 * products first. Products are never cascade-deleted.
 */
export async function deleteCategory(
  id: string,
  reassignToId?: string
): Promise<DeleteCategoryResult> {
  const res = await apiClient.delete<any>(`/owner/categories/${id}`, {
    params: reassignToId ? { reassignToId } : {},
  });
  return res.data;
}

export async function archiveCategory(id: string): Promise<CategoryRow> {
  const res = await apiClient.post<any>(`/owner/categories/${id}/archive`);
  return res.data;
}

export async function activateCategory(id: string): Promise<CategoryRow> {
  const res = await apiClient.post<any>(`/owner/categories/${id}/activate`);
  return res.data;
}

export interface BulkActionResult {
  processed: number;
  skipped: { id: string; name: string; reason: string }[];
}

export async function bulkCategoryAction(
  ids: string[],
  action: "ARCHIVE" | "ACTIVATE" | "DEACTIVATE" | "DELETE"
): Promise<BulkActionResult> {
  const res = await apiClient.post<any>("/owner/categories/bulk", { ids, action });
  return res.data;
}

export async function setCategoryImage(id: string, imageUrl: string): Promise<CategoryRow> {
  const res = await apiClient.patch<any>(`/owner/categories/${id}/image`, { imageUrl });
  return res.data;
}

export async function removeCategoryImage(id: string): Promise<CategoryRow> {
  const res = await apiClient.delete<any>(`/owner/categories/${id}/image`);
  return res.data;
}

// ── Phase 2: discounts & activity ───────────────────────────────────────────

export async function fetchCategoryDiscounts(id: string): Promise<CategoryDiscount[]> {
  const res = await apiClient.get<any>(`/owner/categories/${id}/discounts`);
  return res.data ?? [];
}

export interface AssignDiscountInput {
  name: string;
  description?: string;
  type: "PERCENTAGE" | "FLAT";
  value: number;
  priority?: number;
  startDate?: string;
  endDate?: string;
  isEnabled?: boolean;
}

export async function assignCategoryDiscount(
  id: string,
  input: AssignDiscountInput
): Promise<CategoryDiscount & { affectedVariants: number }> {
  const res = await apiClient.post<any>(`/owner/categories/${id}/discounts`, input);
  return res.data;
}

export async function fetchCategoryActivity(
  id: string,
  params: { page: number; limit: number }
): Promise<{ data: CategoryActivityEvent[]; meta: PaginatedMeta }> {
  const res = await apiClient.get<any>(`/owner/categories/${id}/activity`, { params });
  return {
    data: res.data?.data ?? [],
    meta: res.data?.meta ?? {
      total: 0,
      page: 1,
      limit: params.limit,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  };
}

// ── Phase 3: analytics, reports & export ────────────────────────────────────

export async function fetchCategoryAnalytics(params: {
  period?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<CategoryAnalyticsDashboard> {
  const res = await apiClient.get<any>("/owner/categories/analytics", {
    params: clean(params),
  });
  return res.data;
}

export async function fetchSingleCategoryAnalytics(
  id: string,
  params: { period?: string; limit?: number } = {}
): Promise<SingleCategoryAnalytics> {
  const res = await apiClient.get<any>(`/owner/categories/${id}/analytics`, {
    params: clean(params),
  });
  return res.data;
}

export interface CategoryReport {
  report: string;
  title: string;
  period: { from: string; to: string; label: string };
  totals: Record<string, number>;
  rows: Record<string, unknown>[];
}

export async function fetchCategoryReport(
  report: string,
  params: { period?: string; limit?: number } = {}
): Promise<CategoryReport> {
  const res = await apiClient.get<any>(`/owner/categories/reports/${report}`, {
    params: clean(params),
  });
  return res.data;
}

/**
 * Downloads an export.
 *
 * `responseType: "blob"` bypasses the JSON interceptor — these endpoints return
 * a file, not the usual envelope. PDF exports arrive as print-ready HTML (the
 * server does not claim application/pdf for HTML), so they open in a print
 * window instead of being saved; everything else downloads.
 */
export async function downloadCategoryExport(
  params: Record<string, string | undefined>,
  format: "csv" | "excel" | "pdf",
  path = "/owner/categories/export"
): Promise<void> {
  const res = await apiClient.get(path, {
    params: clean({ ...params, format }),
    responseType: "blob",
  });

  const blob = res as unknown as Blob;

  if (format === "pdf") {
    const url = URL.createObjectURL(new Blob([blob], { type: "text/html" }));
    const printWindow = window.open(url, "_blank");
    // Revoke once the new window has had time to load; revoking immediately
    // would leave the popup pointing at a dead URL.
    if (printWindow) setTimeout(() => URL.revokeObjectURL(url), 60_000);
    else URL.revokeObjectURL(url);
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `categories-${new Date().toISOString().slice(0, 10)}.${
    format === "excel" ? "xls" : "csv"
  }`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
