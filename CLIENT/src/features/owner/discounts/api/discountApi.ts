/**
 * Discounts — transport layer.
 *
 * Talks to /api/v1/owner/discounts (writes, OWNER-only) and /api/v1/pricing
 * (reads, MANAGER+OWNER). baseURL already includes /api/v1.
 *
 * The axios response interceptor unwraps the { success, message, data } envelope
 * to `data`, so a paginated call resolves to `{ data: [...], meta: {...} }` and
 * a single call resolves to the entity itself.
 *
 * Every endpoint here is enforced server-side. The frontend guard is a
 * convenience; the 403 from the backend is the real boundary.
 */

import { apiClient } from "@/lib/api/axios";

// ── Types ────────────────────────────────────────────────────────────────────

export type DiscountScope = "PRODUCT" | "CATEGORY" | "BRAND";
export type DiscountType = "PERCENTAGE" | "FLAT";

/** Derived server-side from (isEnabled, startDate, endDate) — never stored. */
export type DiscountStatus = "DRAFT" | "SCHEDULED" | "ACTIVE" | "EXPIRED" | "DISABLED";

export interface DiscountRule {
  id: string;
  name: string;
  description: string | null;
  scope: DiscountScope;
  type: DiscountType;
  value: number;
  priority: number;
  startDate: string | null;
  endDate: string | null;
  isEnabled: boolean;
  status: DiscountStatus;
  target: { id: string; name: string; type: DiscountScope } | null;
  createdAt: string;
  updatedAt: string;
  /** Present on create/update responses only. */
  affectedVariants?: number;
}

export interface DiscountDashboard {
  counts: {
    total: number;
    active: number;
    scheduled: number;
    expired: number;
    disabled: number;
    endingSoon: number;
    productScoped: number;
    categoryScoped: number;
  };
  active: DiscountRule[];
  scheduled: DiscountRule[];
  expired: DiscountRule[];
  endingSoon: DiscountRule[];
  recentlyModified: DiscountRule[];
}

export interface DiscountHistoryEntry {
  id: string;
  ruleId: string | null;
  ruleName: string;
  action: "CREATED" | "UPDATED" | "ENABLED" | "DISABLED" | "DELETED";
  oldData: unknown;
  newData: unknown;
  employeeId: string | null;
  createdAt: string;
}

// Effective-pricing reads (/api/v1/pricing) live in shared/product/pricingApi —
// both portals consume them, so they are not owned by this feature.

export interface DiscountListParams {
  page: number;
  limit: number;
  search?: string;
  scope?: DiscountScope;
  status?: DiscountStatus;
  productId?: string;
  categoryId?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface DiscountListResult {
  data: DiscountRule[];
  total: number;
}

export interface DiscountWriteInput {
  name: string;
  description?: string | null;
  type: DiscountType;
  value: number;
  priority?: number;
  /** Date-only ("2026-12-31") is widened to the whole day in STORE time. */
  startDate?: string | null;
  endDate?: string | null;
  isEnabled?: boolean;
}

function clean(params: object) {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== "" && v !== null && v !== undefined)
  );
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function fetchDiscounts(params: DiscountListParams): Promise<DiscountListResult> {
  const res = await apiClient.get<any>("/owner/discounts", { params: clean(params) });
  return {
    data: res.data?.data ?? [],
    total: res.data?.meta?.total ?? 0,
  };
}

export async function fetchDiscountDashboard(): Promise<DiscountDashboard> {
  const res = await apiClient.get<any>("/owner/discounts/dashboard");
  return res.data;
}

export async function fetchDiscountHistory(params: {
  page: number;
  limit: number;
  ruleId?: string;
}): Promise<{ data: DiscountHistoryEntry[]; total: number }> {
  const res = await apiClient.get<any>("/owner/discounts/history", { params: clean(params) });
  return {
    data: res.data?.data ?? [],
    total: res.data?.meta?.total ?? 0,
  };
}

export async function fetchDiscount(id: string): Promise<DiscountRule> {
  const res = await apiClient.get<any>(`/owner/discounts/${id}`);
  return res.data;
}

/** How many variants a rule would touch — shown before the owner commits. */
export async function fetchImpact(target: {
  scope: "PRODUCT" | "CATEGORY";
  productId?: string;
  categoryId?: string;
}): Promise<{ affectedVariants: number }> {
  const res = await apiClient.get<any>("/owner/discounts/impact", { params: clean(target) });
  return res.data;
}

export interface TargetOption {
  id: string;
  name: string;
}

/**
 * Typeahead source for the rule editor's target pickers. Reuses the existing
 * catalog endpoints rather than adding discount-specific lookup routes.
 */
export async function searchProductOptions(search: string): Promise<TargetOption[]> {
  const res = await apiClient.get<any>("/owner/products", {
    params: clean({ search, limit: 20, page: 1 }),
  });
  const rows = res.data?.data ?? [];
  return rows.map((r: { id: string; name: string }) => ({ id: r.id, name: r.name }));
}

export async function fetchCategoryOptions(): Promise<TargetOption[]> {
  const res = await apiClient.get<any>("/categories", {
    params: { isActive: "true", limit: 100 },
  });
  const rows = res.data?.data ?? res.data ?? [];
  return rows.map((r: { id: string; name: string }) => ({ id: r.id, name: r.name }));
}

// ── Writes (OWNER-only server-side) ──────────────────────────────────────────

export async function createProductDiscount(
  input: DiscountWriteInput & { productId: string }
): Promise<DiscountRule> {
  const res = await apiClient.post<any>("/owner/discounts/product", input);
  return res.data;
}

export async function createCategoryDiscount(
  input: DiscountWriteInput & { categoryId: string }
): Promise<DiscountRule> {
  const res = await apiClient.post<any>("/owner/discounts/category", input);
  return res.data;
}

export async function updateDiscount(
  id: string,
  input: Partial<DiscountWriteInput>
): Promise<DiscountRule> {
  const res = await apiClient.patch<any>(`/owner/discounts/${id}`, input);
  return res.data;
}

export async function deleteDiscount(id: string): Promise<{ affectedVariants: number }> {
  const res = await apiClient.delete<any>(`/owner/discounts/${id}`);
  return res.data;
}

export async function bulkDiscountAction(
  ids: string[],
  action: "ENABLE" | "DISABLE" | "DELETE"
): Promise<{ processed: number; affectedVariants: number }> {
  const res = await apiClient.post<any>("/owner/discounts/bulk", { ids, action });
  return res.data;
}
