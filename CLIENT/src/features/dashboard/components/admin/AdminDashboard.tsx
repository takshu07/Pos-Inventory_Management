/**
 * @file features/dashboard/components/admin/AdminDashboard.tsx
 *
 * Purpose: The command center for Owners and Managers.
 *
 * Includes:
 * - High-level financial KPIs (Revenue, Profit, Margin).
 * - Sales and trend charts.
 * - Inventory alerts and operational tables.
 */

import { useState } from "react";
import { 
  useSalesKPIs, 
  useSalesChart, 
  useRecentSales, 
  useTopProducts, 
  useInventoryAlerts 
} from "../../hooks/useDashboard";
import { StatCard } from "../widgets/StatCard";
import { SalesChartWidget } from "../widgets/SalesChartWidget";
import { RecentSalesWidget } from "../widgets/RecentSalesWidget";
import { TopProductsWidget } from "../widgets/TopProductsWidget";
import { InventoryAlertsWidget } from "../widgets/InventoryAlertsWidget";
import { QuickActionsWidget } from "../widgets/QuickActionsWidget";
import { TIME_RANGES } from "../../constants";
import { Select } from "@/components/ui/Select";
import { formatCurrency } from "@/utils/formatters";
import { Activity, IndianRupee, ShoppingBag, Tags } from "lucide-react";

export function AdminDashboard() {
  const [timeRange, setTimeRange] = useState("7d");

  // Fetch data
  const { data: kpis, isLoading: isLoadingKPIs } = useSalesKPIs({ range: timeRange });
  const { data: chartData, isLoading: isLoadingChart } = useSalesChart(timeRange);
  const { data: recentSales, isLoading: isLoadingSales } = useRecentSales();
  const { data: topProducts, isLoading: isLoadingProducts } = useTopProducts();
  const { data: inventoryAlerts, isLoading: isLoadingAlerts } = useInventoryAlerts();

  const adminActions = [
    { label: "New Product", icon: "PackagePlus", href: "/admin/products/new", color: "#3b82f6" },
    { label: "Inventory", icon: "Boxes", href: "/admin/inventory", color: "#8b5cf6" },
    { label: "Reports", icon: "BarChart3", href: "/admin/reports", color: "#10b981" },
    { label: "Settings", icon: "Settings", href: "/settings", color: "#64748b" },
  ];

  return (
    <div className="space-y-6 pb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-muted-foreground text-sm">Here's what's happening in your store today.</p>
        </div>
        <div className="w-full sm:w-40">
          <Select 
            value={timeRange} 
            onChange={(e) => setTimeRange(e.target.value)}
            options={TIME_RANGES}
          />
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Total Revenue"
          value={kpis ? formatCurrency(kpis.revenue) : "₹0"}
          icon={<IndianRupee className="h-4 w-4" />}
          trend={kpis ? { value: kpis.revenueGrowth, label: "from last period" } : undefined}
          isLoading={isLoadingKPIs}
        />
        <StatCard
          title="Total Orders"
          value={kpis ? kpis.orderCount.toLocaleString() : "0"}
          icon={<ShoppingBag className="h-4 w-4" />}
          trend={kpis && kpis.comparative ? { 
            value: Math.round(((kpis.orderCount - kpis.comparative.previousOrderCount) / kpis.comparative.previousOrderCount) * 100) || 0,
            label: "from last period" 
          } : undefined}
          isLoading={isLoadingKPIs}
        />
        <StatCard
          title="Avg. Order Value"
          value={kpis ? formatCurrency(kpis.averageOrderValue) : "₹0"}
          icon={<Activity className="h-4 w-4" />}
          isLoading={isLoadingKPIs}
        />
        <StatCard
          title="Gross Margin"
          value={kpis ? `${kpis.grossMarginPercent.toFixed(1)}%` : "0%"}
          icon={<Tags className="h-4 w-4" />}
          isLoading={isLoadingKPIs}
        />
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (Wider) */}
        <div className="lg:col-span-2 space-y-6">
          <SalesChartWidget 
            data={chartData} 
            isLoading={isLoadingChart} 
            className="min-h-[400px]" 
          />
          <RecentSalesWidget 
            sales={recentSales} 
            isLoading={isLoadingSales} 
            className="min-h-[350px]"
          />
        </div>

        {/* Right Column (Narrower) */}
        <div className="space-y-6">
          <QuickActionsWidget 
            actions={adminActions} 
          />
          <InventoryAlertsWidget 
            alerts={inventoryAlerts} 
            isLoading={isLoadingAlerts} 
            className="h-[300px]"
          />
          <TopProductsWidget 
            products={topProducts} 
            isLoading={isLoadingProducts} 
            className="h-[350px]"
          />
        </div>
      </div>
    </div>
  );
}
