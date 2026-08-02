/**
 * Reports — React Query bindings.
 *
 * Reports are read-only, so there are no mutations and no invalidation graph.
 * What they need instead is a sane cache posture: each report is an expensive
 * grouped aggregate, and an owner clicking between report tabs should not
 * re-run the same query. 60 seconds is long enough for that and short enough
 * that a report opened after lunch is not showing this morning's numbers.
 */

import { useQuery } from "@tanstack/react-query";

import * as api from "../api/reportsApi";
import type { ReportParams } from "../api/reportsApi";

const REPORT_STALE_MS = 60_000;

export const reportKeys = {
  all: ["reports"] as const,
  dashboard: (params: ReportParams) => [...reportKeys.all, "dashboard", params] as const,
  filterOptions: () => [...reportKeys.all, "filter-options"] as const,
  report: (key: string, params: ReportParams) => [...reportKeys.all, key, params] as const,
  search: (q: string) => [...reportKeys.all, "search", q] as const,
};

export function useReportDashboard(params: ReportParams) {
  return useQuery({
    queryKey: reportKeys.dashboard(params),
    queryFn: () => api.fetchReportDashboard(params),
    staleTime: REPORT_STALE_MS,
  });
}

/**
 * Dropdown sources for the shared filter bar.
 *
 * Cached for ten minutes and shared across every report by query key, so
 * navigating between twelve report screens fetches the category and brand lists
 * exactly once.
 */
export function useFilterOptions() {
  return useQuery({
    queryKey: reportKeys.filterOptions(),
    queryFn: api.fetchFilterOptions,
    staleTime: 10 * 60_000,
  });
}

export function useSalesReport(params: ReportParams) {
  return useQuery({
    queryKey: reportKeys.report("sales", params),
    queryFn: () => api.fetchSalesReport(params),
    staleTime: REPORT_STALE_MS,
  });
}

export function useProductReport(params: ReportParams) {
  return useQuery({
    queryKey: reportKeys.report("products", params),
    queryFn: () => api.fetchProductReport(params),
    staleTime: REPORT_STALE_MS,
  });
}

export function useCategoryReport(params: ReportParams) {
  return useQuery({
    queryKey: reportKeys.report("categories", params),
    queryFn: () => api.fetchCategoryReport(params),
    staleTime: REPORT_STALE_MS,
  });
}

export function useBrandReport(params: ReportParams) {
  return useQuery({
    queryKey: reportKeys.report("brands", params),
    queryFn: () => api.fetchBrandReport(params),
    staleTime: REPORT_STALE_MS,
  });
}

export function useCustomerReport(params: ReportParams) {
  return useQuery({
    queryKey: reportKeys.report("customers", params),
    queryFn: () => api.fetchCustomerReport(params),
    staleTime: REPORT_STALE_MS,
  });
}

export function useEmployeeReport(params: ReportParams) {
  return useQuery({
    queryKey: reportKeys.report("employees", params),
    queryFn: () => api.fetchEmployeeReport(params),
    staleTime: REPORT_STALE_MS,
  });
}

export function useInventoryReport(params: ReportParams) {
  return useQuery({
    queryKey: reportKeys.report("inventory", params),
    queryFn: () => api.fetchInventoryReport(params),
    staleTime: REPORT_STALE_MS,
  });
}

export function usePurchaseReport(params: ReportParams) {
  return useQuery({
    queryKey: reportKeys.report("purchases", params),
    queryFn: () => api.fetchPurchaseReport(params),
    staleTime: REPORT_STALE_MS,
  });
}

export function usePaymentReport(params: ReportParams) {
  return useQuery({
    queryKey: reportKeys.report("payments", params),
    queryFn: () => api.fetchPaymentReport(params),
    staleTime: REPORT_STALE_MS,
  });
}

export function useReturnReport(params: ReportParams) {
  return useQuery({
    queryKey: reportKeys.report("returns", params),
    queryFn: () => api.fetchReturnReport(params),
    staleTime: REPORT_STALE_MS,
  });
}

export function useProfitReport(params: ReportParams) {
  return useQuery({
    queryKey: reportKeys.report("profit", params),
    queryFn: () => api.fetchProfitReport(params),
    staleTime: REPORT_STALE_MS,
  });
}

/**
 * Global search.
 *
 * Disabled below two characters — a one-letter query matches most of the
 * catalogue and costs five LIKE scans to return noise.
 */
export function useGlobalSearch(query: string, enabled = true) {
  return useQuery({
    queryKey: reportKeys.search(query),
    queryFn: () => api.globalSearch(query),
    enabled: enabled && query.trim().length >= 2,
    staleTime: 30_000,
  });
}
