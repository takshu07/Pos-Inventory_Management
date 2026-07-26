/**
 * @file features/dashboard/api/dashboardApi.ts
 *
 * Purpose: API client layer for the Dashboard module.
 *
 * Responsibilities:
 * - Fetching analytical and operational data.
 * - Providing mock implementations where backend analytics aren't fully implemented yet,
 *   allowing the frontend to be built independently.
 */

import { apiClient } from "@/lib/api/axios";
import { type SalesKPI, type ChartDataPoint, type TopProduct, type RecentSale, type InventoryAlert, type DashboardNotification } from "../types";

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
 * MOCK: Fetch system notifications.
 */
export async function getNotifications(): Promise<DashboardNotification[]> {
  await new Promise((resolve) => setTimeout(resolve, 400));
  return [
    { id: "n1", title: "Large Sale Alert", message: "Sale RCP-103 exceeded ₹5,000", timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(), type: "SUCCESS", isRead: false },
    { id: "n2", title: "Inventory Critical", message: "Black Leather Jacket (L) is out of stock.", timestamp: new Date(Date.now() - 1000 * 60 * 120).toISOString(), type: "ERROR", isRead: false },
    { id: "n3", title: "System Update", message: "POS version 1.2 is scheduled for deployment tonight.", timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), type: "INFO", isRead: true },
  ];
}
