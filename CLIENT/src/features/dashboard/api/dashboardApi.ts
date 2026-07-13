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
 * Fetches the Sales KPIs.
 * For Admin/Manager, this hits the real backend analytics engine.
 */
export async function getSalesKPIs(filters: { startDate?: string; endDate?: string }): Promise<SalesKPI> {
  // Try to use the real backend endpoint.
  try {
    const params = new URLSearchParams({ reportName: "SalesDashboardKPI" });
    if (filters.startDate) params.append("startDate", filters.startDate);
    if (filters.endDate) params.append("endDate", filters.endDate);
    
    const response = await apiClient.get<any>(`/analytics/generate?${params.toString()}`);
    return response.data.data; // The interceptor gives response.data, inside which is { success, message, data }
  } catch (error) {
    // If the backend endpoint fails (e.g., unauthorized for CASHIER, or not seeded), 
    // fallback to mock data to ensure UI development can proceed.
    console.warn("Analytics endpoint failed or unavailable. Using mock data.", error);
    
    return {
      revenue: 125430,
      revenueGrowth: 12.5,
      orderCount: 142,
      averageOrderValue: 883.3,
      totalDiscount: 4500,
      totalTax: 12500,
      grossMarginPercent: 45.2,
      comparative: {
        previousRevenue: 111500,
        previousOrderCount: 125,
      }
    };
  }
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
  await new Promise((resolve) => setTimeout(resolve, 700));
  return [
    { id: "101", receiptNumber: "RCP-101", timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(), totalAmount: 4500, status: "COMPLETED", customerName: "Rahul Sharma" },
    { id: "102", receiptNumber: "RCP-102", timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(), totalAmount: 1250, status: "COMPLETED" },
    { id: "103", receiptNumber: "RCP-103", timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(), totalAmount: 8900, status: "EXCHANGED", customerName: "Priya Patel" },
    { id: "104", receiptNumber: "RCP-104", timestamp: new Date(Date.now() - 1000 * 60 * 120).toISOString(), totalAmount: 3200, status: "COMPLETED" },
    { id: "105", receiptNumber: "RCP-105", timestamp: new Date(Date.now() - 1000 * 60 * 180).toISOString(), totalAmount: 550, status: "REFUNDED", customerName: "Amit Kumar" },
  ];
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
