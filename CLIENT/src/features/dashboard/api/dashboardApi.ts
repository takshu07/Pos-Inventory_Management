/**
 * @file features/dashboard/api/dashboardApi.ts
 *
 * Purpose: API client layer for the Dashboard module.
 *
 * Responsibilities:
 * - Fetching analytical and operational data.
 * - Providing mock implementations where backend analytics aren't fully implemented yet,
 *   allowing the frontend to be built independently.
 *
 * Still mock (clearly labelled below): sales chart trends, top products, and
 * inventory alerts — these await aggregate endpoints.
 * No longer mock: recent sales, today's operational stats, and **notifications**,
 * which now read the real Notifications API so this widget and the Notification
 * Center cannot disagree.
 */

import { apiClient } from "@/lib/api/axios";
// Both from specific modules rather than the feature barrel: the barrel also
// exports NotificationsPage, and a value import of it here would statically
// pull the lazy notifications chunk into the dashboard's.
import { fetchNotifications } from "@/features/notifications/api/notificationsApi";
import type { NotificationItem, NotificationSeverity } from "@/features/notifications/types";
import { type SalesKPI, type ChartDataPoint, type TopProduct, type RecentSale, type InventoryAlert, type DashboardNotification } from "../types";

/**
 * How many notifications the dashboard widget shows.
 *
 * The widget is a fixed-height panel with no pager — it is a glance, not the
 * Notification Center. Fetching more than fits would cost bandwidth to render
 * nothing; the "see everything" affordance is the `/notifications` route.
 */
const DASHBOARD_NOTIFICATION_LIMIT = 8;

/**
 * Server severity → the widget's visual tone.
 *
 * The two vocabularies are NOT the same and must not be assumed interchangeable:
 * the server's most urgent level is `CRITICAL`, while the widget's is `ERROR`.
 * A structural cast would compile and then silently drop critical alerts into an
 * unstyled default. Severity is derived server-side from `Notification.type`
 * (SERVER/src/constants/notificationTaxonomy.ts) — never re-derived here.
 */
const SEVERITY_TO_WIDGET_TYPE: Record<NotificationSeverity, DashboardNotification["type"]> = {
  INFO: "INFO",
  SUCCESS: "SUCCESS",
  WARNING: "WARNING",
  CRITICAL: "ERROR",
};

/** Adapts a server notification to the widget's shape (`createdAt` → `timestamp`). */
function toDashboardNotification(row: NotificationItem): DashboardNotification {
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    timestamp: row.createdAt,
    type: SEVERITY_TO_WIDGET_TYPE[row.severity] ?? "INFO",
    isRead: row.isRead,
  };
}

/**
 * Fetches the Sales KPIs from the analytics engine.
 *
 * This endpoint (/analytics/generate) is OWNER-only — it powers the owner's
 * enterprise analytics dashboard. It deliberately does NOT fall back to mock
 * data on failure: a 403 (e.g. a manager) or an error must surface as a real
 * error so the UI shows an honest empty state, never fabricated revenue/margin
 * numbers. Only the OWNER dashboard calls this.
 */
export async function getSalesKPIs(filters: { startDate?: string; endDate?: string }): Promise<SalesKPI> {
  const params = new URLSearchParams({ reportName: "SalesDashboardKPI" });
  if (filters.startDate) params.append("startDate", filters.startDate);
  if (filters.endDate) params.append("endDate", filters.endDate);

  // Interceptor unwraps to response.data = { success, message, data }.
  const response = await apiClient.get<any>(`/analytics/generate?${params.toString()}`);
  return response.data.data;
}

/**
 * Operational "today" summary for the MANAGER/CASHIER dashboard.
 *
 * Sourced from GET /sales (accessible to all roles) filtered to today — NOT the
 * owner-only analytics engine. Returns an exact transaction count (the paginated
 * `total`, independent of page size) and the summed revenue of today's sales.
 * A store's daily volume is small, so a single high-limit page covers it; if a
 * day ever exceeds the limit, the count stays exact and revenue reflects the
 * fetched page (never a fabricated number).
 */
export interface OperationalTodayStats {
  orderCount: number;
  revenue: number;
}

export async function getOperationalTodayStats(): Promise<OperationalTodayStats> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const response = await apiClient.get<any>("/sales", {
    params: { startDate: startOfDay.toISOString(), limit: 200, page: 1 },
  });

  // Interceptor unwraps to response.data = { total, data: Sale[] }.
  const payload = response.data ?? {};
  const rows: any[] = payload.data ?? [];
  const revenue = rows.reduce((sum, sale) => sum + Number(sale.grandTotal ?? 0), 0);

  return {
    orderCount: Number(payload.total ?? rows.length),
    revenue,
  };
}

/**
 * MOCK: Fetch chart data for revenue and sales trends.
 */
export async function getSalesChartData(range: string): Promise<ChartDataPoint[]> {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 800));
  
  // Return dummy trend data
  const data: ChartDataPoint[] = [];
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 12; // default to 12 months for 1y
  
  for (let i = days; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    data.push({
      date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      revenue: Math.floor(Math.random() * 50000) + 10000,
      orders: Math.floor(Math.random() * 50) + 10,
    });
  }
  
  return data;
}

/**
 * MOCK: Fetch top selling products.
 */
export async function getTopProducts(): Promise<TopProduct[]> {
  await new Promise((resolve) => setTimeout(resolve, 600));
  return [
    { id: "1", name: "Classic White T-Shirt", sku: "TS-WHT-01", soldQuantity: 120, revenue: 119880 },
    { id: "2", name: "Slim Fit Blue Jeans", sku: "JN-BLU-02", soldQuantity: 85, revenue: 212415 },
    { id: "3", name: "Black Leather Jacket", sku: "JK-BLK-03", soldQuantity: 12, revenue: 180000 },
    { id: "4", name: "Cotton Summer Dress", sku: "DR-SUM-04", soldQuantity: 64, revenue: 95936 },
    { id: "5", name: "Running Sneakers", sku: "SN-RUN-05", soldQuantity: 45, revenue: 134955 },
  ];
}

/**
 * MOCK: Fetch recent sales transactions.
 */
export async function getRecentSales(): Promise<RecentSale[]> {
  try {
    const response = await apiClient.get<any>("/sales", {
      params: { limit: 5 },
    });
    
    // Because of the axios interceptor, response is { success, message, data: { total, data: Sale[] } }
    const sales = response.data?.data || [];
    
    return sales.map((sale: any) => ({
      id: sale.id,
      receiptNumber: sale.saleNumber,
      timestamp: sale.saleDate,
      totalAmount: Number(sale.grandTotal),
      status: sale.status,
      customerName: sale.customer?.name
    }));
  } catch (error) {
    console.warn("Failed to fetch recent sales. Using mock data.", error);
    return [
      { id: "101", receiptNumber: "RCP-101", timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(), totalAmount: 4500, status: "COMPLETED", customerName: "Rahul Sharma" },
      { id: "102", receiptNumber: "RCP-102", timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(), totalAmount: 1250, status: "COMPLETED" },
    ];
  }
}

/**
 * MOCK: Fetch inventory alerts (low stock / out of stock).
 */
export async function getInventoryAlerts(): Promise<InventoryAlert[]> {
  await new Promise((resolve) => setTimeout(resolve, 500));
  return [
    { id: "1", productId: "p1", productName: "Classic White T-Shirt (M)", sku: "TS-WHT-01-M", currentStock: 2, reorderLevel: 10, status: "LOW_STOCK" },
    { id: "2", productId: "p2", productName: "Black Leather Jacket (L)", sku: "JK-BLK-03-L", currentStock: 0, reorderLevel: 5, status: "OUT_OF_STOCK" },
    { id: "3", productId: "p3", productName: "Slim Fit Blue Jeans (32)", sku: "JN-BLU-02-32", currentStock: 4, reorderLevel: 15, status: "LOW_STOCK" },
  ];
}

/**
 * Real notifications for the dashboard widget.
 *
 * ⚠ SINGLE SOURCE OF TRUTH. This used to return three hardcoded rows, so the
 * dashboard and the Notification Center told the user different things — the
 * dashboard cheerfully reported a "System Update" that did not exist while a
 * real out-of-stock alert sat unseen on the other screen. Both now read the
 * same server data through the same feature module.
 *
 * It reads `/notifications/feed` (the paginated, filtered endpoint) rather than
 * the bare unread-only path, because the widget wants the most recent activity
 * — including things already read — not just the unread backlog. Both endpoints
 * return 200, so pointing this at the wrong one would degrade silently; the
 * routing is pinned by `features/notifications/__tests__/notificationsApi.test.ts`.
 *
 * Audience scoping is enforced server-side on every row this returns, so a
 * cashier's dashboard cannot surface an owner's security alerts.
 */
export async function getNotifications(): Promise<DashboardNotification[]> {
  const { data } = await fetchNotifications({
    page: 1,
    limit: DASHBOARD_NOTIFICATION_LIMIT,
    sortBy: "createdAt",
    sortOrder: "desc",
  });

  return data.map(toDashboardNotification);
}
