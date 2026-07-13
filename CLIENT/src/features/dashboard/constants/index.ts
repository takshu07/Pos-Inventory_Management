/**
 * @file features/dashboard/constants/index.ts
 *
 * Purpose: Defines constants used across the dashboard module.
 */

export const DASHBOARD_QUERY_KEYS = {
  all: ["dashboard"] as const,
  kpis: (filters: Record<string, any>) => [...DASHBOARD_QUERY_KEYS.all, "kpis", filters] as const,
  charts: (filters: Record<string, any>) => [...DASHBOARD_QUERY_KEYS.all, "charts", filters] as const,
  topProducts: () => [...DASHBOARD_QUERY_KEYS.all, "topProducts"] as const,
  recentSales: () => [...DASHBOARD_QUERY_KEYS.all, "recentSales"] as const,
  inventoryAlerts: () => [...DASHBOARD_QUERY_KEYS.all, "inventoryAlerts"] as const,
  notifications: () => [...DASHBOARD_QUERY_KEYS.all, "notifications"] as const,
};

export const TIME_RANGES = [
  { label: "Today", value: "today" },
  { label: "7 Days", value: "7d" },
  { label: "30 Days", value: "30d" },
  { label: "This Year", value: "1y" },
];
