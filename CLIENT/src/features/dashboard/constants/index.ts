/**
 * @file features/dashboard/constants/index.ts
 *
 * Purpose: Defines constants used across the dashboard module.
 */

// From the hook module, not the feature barrel — the barrel also exports
// NotificationsPage, and importing it here would statically pull the lazy
// notifications chunk into the dashboard's. Keys only; no components.
import { notificationKeys } from "@/features/notifications/hooks/useNotifications";

export const DASHBOARD_QUERY_KEYS = {
  all: ["dashboard"] as const,
  kpis: (filters: Record<string, any>) => [...DASHBOARD_QUERY_KEYS.all, "kpis", filters] as const,
  charts: (filters: Record<string, any>) => [...DASHBOARD_QUERY_KEYS.all, "charts", filters] as const,
  topProducts: () => [...DASHBOARD_QUERY_KEYS.all, "topProducts"] as const,
  recentSales: () => [...DASHBOARD_QUERY_KEYS.all, "recentSales"] as const,
  operationalToday: () => [...DASHBOARD_QUERY_KEYS.all, "operationalToday"] as const,
  inventoryAlerts: () => [...DASHBOARD_QUERY_KEYS.all, "inventoryAlerts"] as const,

  /**
   * ⚠ Deliberately rooted in the NOTIFICATIONS key tree, not `dashboard`.
   *
   * The widget reads the real Notifications API, and the Notifications screen
   * invalidates `notificationKeys.all` after every read/mark mutation. Keying
   * this under `dashboard` would leave the widget serving notifications the
   * user just cleared elsewhere until its own 60s poll caught up — the same
   * "two screens disagree" bug that retiring the mock data was meant to end.
   *
   * The trailing segment keeps it a distinct entry: the widget's query (a short
   * recent slice) is not the screen's (paged and filtered), so they must not
   * share a cache entry — only an invalidation root.
   */
  notifications: () => [...notificationKeys.all, "dashboardWidget"] as const,
};

export const TIME_RANGES = [
  { label: "Today", value: "today" },
  { label: "7 Days", value: "7d" },
  { label: "30 Days", value: "30d" },
  { label: "This Year", value: "1y" },
];
