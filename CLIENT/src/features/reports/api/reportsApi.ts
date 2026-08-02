/**
 * Reports — transport layer.
 *
 * ONE FUNCTION PER REPORT, ONE FILTER SHAPE FOR ALL OF THEM.
 *
 * Every report accepts the same filter object, because the server accepts the
 * same filter set on every report. Typing each report's params separately would
 * let one of them quietly stop supporting `brandId` with nothing catching it.
 *
 * The response types are deliberately loose (`any` at the boundary, narrow at
 * the page): twelve fully-typed report shapes would be ~600 lines of interface
 * that restates the server's DTOs, and the pages already read only the fields
 * they render.
 */

import { apiClient } from "@/lib/api";
import type { ReportFilterState } from "@/components/shared/bi";

const BASE = "/reports";

export type ReportKey =
  | "sales" | "products" | "categories" | "brands" | "customers"
  | "employees" | "inventory" | "purchases" | "payments" | "returns" | "profit";

export interface ReportParams extends Partial<ReportFilterState> {
  page?: number;
  limit?: number;
  granularity?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  bucket?: string;
  velocityDays?: number;
  groupBy?: string;
  inactiveDays?: number;
  includeBreakdown?: boolean;
}

function clean<T extends object>(params: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== "" && v !== null && v !== undefined)
  );
}

/** Unwraps the paginated envelope, which several reports return. */
export interface PaginatedReport<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
  /** Report-specific sidecars (summary, segments, valuation…). */
  [key: string]: unknown;
}

function toPaginated<T>(res: any, fallbackLimit: number): PaginatedReport<T> {
  const total = res?.meta?.total ?? 0;
  const { data, meta, success, ...rest } = res ?? {};
  return {
    ...rest,
    data: data ?? [],
    total,
    page: meta?.page ?? 1,
    totalPages: meta?.totalPages ?? Math.max(1, Math.ceil(total / fallbackLimit)),
  };
}

// =============================================================================
// DASHBOARD & FILTER SOURCES
// =============================================================================

export async function fetchReportDashboard(params: ReportParams): Promise<any> {
  const res = await apiClient.get<any>(`${BASE}/dashboard`, { params: clean(params) });
  return res.data;
}

export async function fetchFilterOptions(): Promise<{
  categories: Array<{ id: string; name: string }>;
  brands: Array<{ id: string; name: string }>;
  suppliers: Array<{ id: string; name: string }>;
  employees: Array<{ id: string; name: string; employeeCode: string; role: string }>;
}> {
  const res = await apiClient.get<any>(`${BASE}/filter-options`);
  return res.data ?? { categories: [], brands: [], suppliers: [], employees: [] };
}

// =============================================================================
// NON-PAGINATED REPORTS  (the whole payload lives under `data`)
// =============================================================================

export async function fetchSalesReport(params: ReportParams): Promise<any> {
  const res = await apiClient.get<any>(`${BASE}/sales`, { params: clean(params) });
  return res.data;
}

export async function fetchCategoryReport(params: ReportParams): Promise<any> {
  const res = await apiClient.get<any>(`${BASE}/categories`, { params: clean(params) });
  return res.data;
}

export async function fetchBrandReport(params: ReportParams): Promise<any> {
  const res = await apiClient.get<any>(`${BASE}/brands`, { params: clean(params) });
  return res.data;
}

export async function fetchEmployeeReport(params: ReportParams): Promise<any> {
  const res = await apiClient.get<any>(`${BASE}/employees`, { params: clean(params) });
  return res.data;
}

export async function fetchPurchaseReport(params: ReportParams): Promise<any> {
  const res = await apiClient.get<any>(`${BASE}/purchases`, { params: clean(params) });
  return res.data;
}

export async function fetchPaymentReport(params: ReportParams): Promise<any> {
  const res = await apiClient.get<any>(`${BASE}/payments`, { params: clean(params) });
  return res.data;
}

export async function fetchProfitReport(params: ReportParams): Promise<any> {
  const res = await apiClient.get<any>(`${BASE}/profit`, { params: clean(params) });
  return res.data;
}

// =============================================================================
// PAGINATED REPORTS  (rows under `data`, sidecars beside it)
// =============================================================================

export async function fetchProductReport(params: ReportParams): Promise<PaginatedReport<any>> {
  const res: any = await apiClient.get<any>(`${BASE}/products`, { params: clean(params) });
  return toPaginated(res, params.limit ?? 25);
}

export async function fetchCustomerReport(params: ReportParams): Promise<PaginatedReport<any>> {
  const res: any = await apiClient.get<any>(`${BASE}/customers`, { params: clean(params) });
  return toPaginated(res, params.limit ?? 25);
}

export async function fetchInventoryReport(params: ReportParams): Promise<PaginatedReport<any>> {
  const res: any = await apiClient.get<any>(`${BASE}/inventory`, { params: clean(params) });
  return toPaginated(res, params.limit ?? 25);
}

export async function fetchReturnReport(params: ReportParams): Promise<PaginatedReport<any>> {
  const res: any = await apiClient.get<any>(`${BASE}/returns`, { params: clean(params) });
  return toPaginated(res, params.limit ?? 25);
}

// =============================================================================
// GLOBAL SEARCH
// =============================================================================

export interface SearchHit {
  id: string;
  label: string;
  sublabel: string;
  href: string;
  amount?: number;
  date?: string;
  status?: string;
  stock?: number;
  barcode?: string | null;
  rewardPoints?: number;
}

export interface GlobalSearchResult {
  query: string;
  invoices: SearchHit[];
  products: SearchHit[];
  customers: SearchHit[];
  suppliers: SearchHit[];
  employees: SearchHit[];
}

export async function globalSearch(q: string, limit = 8): Promise<GlobalSearchResult> {
  const res = await apiClient.get<any>(`${BASE}/search`, { params: { q, limit } });
  return res.data;
}
