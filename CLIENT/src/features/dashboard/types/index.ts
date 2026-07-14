/**
 * @file features/dashboard/types/index.ts
 *
 * Purpose: Defines all types and interfaces for the Dashboard feature.
 *
 * Responsibilities:
 * - Define the shape of backend analytics responses.
 * - Define props for reusable widget components.
 */

export interface SalesKPI {
  revenue: number;
  revenueGrowth: number;
  orderCount: number;
  averageOrderValue: number;
  totalDiscount: number;
  totalTax: number;
  grossMarginPercent: number;
  comparative?: {
    previousRevenue: number;
    previousOrderCount: number;
  };
  paymentBreakdown?: Record<string, number>;
}

export interface ChartDataPoint {
  date: string;
  revenue: number;
  orders: number;
}

export interface TopProduct {
  id: string;
  name: string;
  sku: string;
  soldQuantity: number;
  revenue: number;
  imageUrl?: string;
}

export interface RecentSale {
  id: string;
  receiptNumber: string;
  timestamp: string;
  totalAmount: number;
  status: "COMPLETED" | "REFUNDED" | "EXCHANGED";
  customerName?: string;
}

export interface InventoryAlert {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  currentStock: number;
  reorderLevel: number;
  status: "LOW_STOCK" | "OUT_OF_STOCK";
}

export interface DashboardNotification {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  type: "INFO" | "WARNING" | "SUCCESS" | "ERROR";
  isRead: boolean;
}

export interface QuickAction {
  label: string;
  icon: string; // Lucide icon name or similar identifier
  href: string;
  color?: string;
}

export interface WidgetProps {
  className?: string;
  isLoading?: boolean;
  isError?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}
