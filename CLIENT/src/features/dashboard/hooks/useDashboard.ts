/**
 * @file features/dashboard/hooks/useDashboard.ts
 *
 * Purpose: TanStack Query hooks for dashboard data fetching.
 *
 * Responsibilities:
 * - Handle caching, retries, and background refetching.
 * - Map React Query states (isLoading, isError) to the UI.
 * - Provide clean interfaces for the UI components.
 */

import { useQuery } from "@tanstack/react-query";
import { DASHBOARD_QUERY_KEYS } from "../constants";
import {
  getSalesKPIs,
  getSalesChartData,
  getTopProducts,
  getRecentSales,
  getInventoryAlerts,
  getNotifications,
} from "../api/dashboardApi";

/**
 * Hook to fetch top-level Key Performance Indicators (Revenue, Orders, etc.)
 */
export function useSalesKPIs(filters: { range?: string; startDate?: string; endDate?: string } = {}) {
  // If a string range is passed (e.g. "7d"), calculate dates here or pass to API
  const apiFilters = { ...filters };
  if (filters.range === "today") {
    apiFilters.startDate = new Date().toISOString();
  }
  
  return useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.kpis(filters),
    queryFn: () => getSalesKPIs(apiFilters),
    staleTime: 1000 * 60 * 2,
  });
}

/**
 * Hook to fetch data for the sales trend chart.
 */
export function useSalesChart(range: string) {
  return useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.charts({ range }),
    queryFn: () => getSalesChartData(range),
    staleTime: 1000 * 60 * 5, 
  });
}

/**
 * Hook to fetch top selling products list.
 */
export function useTopProducts() {
  return useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.topProducts(),
    queryFn: getTopProducts,
    staleTime: 1000 * 60 * 10,
  });
}

/**
 * Hook to fetch the most recent sales transactions.
 * Refetches frequently to keep the feed alive.
 */
export function useRecentSales() {
  return useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.recentSales(),
    queryFn: getRecentSales,
    refetchInterval: 1000 * 30, // Auto-refresh every 30s
    staleTime: 1000 * 15,
  });
}

/**
 * Hook to fetch inventory low-stock alerts.
 */
export function useInventoryAlerts() {
  return useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.inventoryAlerts(),
    queryFn: getInventoryAlerts,
    staleTime: 1000 * 60 * 5,
  });
}

/**
 * Hook to fetch user-targeted notifications.
 */
export function useNotifications() {
  return useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.notifications(),
    queryFn: getNotifications,
    refetchInterval: 1000 * 60, // Auto-refresh every 1 min
    staleTime: 1000 * 30,
  });
}
