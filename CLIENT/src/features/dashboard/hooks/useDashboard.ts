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
  if (filters.range) {
    const start = new Date();
    start.setHours(0, 0, 0, 0); // Default to start of day for accurate full-day counting

    if (filters.range === "today") {
      // already start of day
    } else if (filters.range === "7d") {
      start.setDate(start.getDate() - 7);
    } else if (filters.range === "30d") {
      start.setDate(start.getDate() - 30);
    } else if (filters.range === "90d") {
      start.setDate(start.getDate() - 90);
    } else if (filters.range === "1y") {
      start.setFullYear(start.getFullYear() - 1);
    }

    apiFilters.startDate = start.toISOString();
    delete (apiFilters as any).range;
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
    // Don't keep polling when the dashboard tab is in the background — saves a
    // request every 30s per idle tab. It refetches immediately on refocus.
    refetchIntervalInBackground: false,
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
