/**
 * @file features/dashboard/components/employee/EmployeeDashboard.tsx
 *
 * Purpose: The daily operational view for Cashiers.
 *
 * Notes:
 * - Excludes sensitive financial data (gross margin, profit, etc).
 * - Focuses on daily execution: today's sales, active shifts, register status.
 */

import { 
  useSalesKPIs, 
  useRecentSales,
  useNotifications 
} from "../../hooks/useDashboard";
import { StatCard } from "../widgets/StatCard";
import { RecentSalesWidget } from "../widgets/RecentSalesWidget";
import { QuickActionsWidget } from "../widgets/QuickActionsWidget";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatCurrency, formatTimeAgo } from "@/utils/formatters";
import { IndianRupee, ShoppingBag, Bell, CircleCheck } from "lucide-react";
import { cn } from "@/utils/cn";

export function EmployeeDashboard() {
  // Employees only care about "Today"
  const { data: kpis, isLoading: isLoadingKPIs } = useSalesKPIs({ range: "today" });
  const { data: recentSales, isLoading: isLoadingSales } = useRecentSales();
  const { data: notifications, isLoading: isLoadingNotifs } = useNotifications();

  const employeeActions = [
    { label: "New Sale", icon: "ShoppingCart", href: "/pos", color: "#3b82f6" },
    // "Check Inventory" (Product Lookup) removed — that screen is restricted to
    // Manager/Owner, so a cashier clicking it would only hit /unauthorized.
    { label: "Customers", icon: "Users", href: "/customers", color: "#10b981" },
  ];

  return (
    <div className="space-y-6 pb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Today's Shift</h1>
        <p className="text-muted-foreground text-sm">Have a great day at work!</p>
      </div>

      {/* Primary Actions (Prominent for POS) */}
      <QuickActionsWidget actions={employeeActions} />

      {/* KPI Row (Filtered for Cashiers) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard
          title="Your Sales Today"
          value={kpis ? formatCurrency(kpis.revenue) : "₹0"}
          icon={<IndianRupee className="h-4 w-4" />}
          isLoading={isLoadingKPIs}
        />
        <StatCard
          title="Transactions Today"
          value={kpis ? kpis.orderCount.toLocaleString() : "0"}
          icon={<ShoppingBag className="h-4 w-4" />}
          isLoading={isLoadingKPIs}
        />
      </div>

      {/* Main Split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Transactions */}
        <div className="lg:col-span-2">
          <RecentSalesWidget 
            sales={recentSales} 
            isLoading={isLoadingSales} 
            className="h-[400px]"
          />
        </div>

        {/* Notifications & Status */}
        <div className="space-y-6">
          <Card className="h-[400px] flex flex-col">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-primary" />
                <CardTitle className="text-sm font-medium">Notifications</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto">
              {isLoadingNotifs ? (
                <div className="space-y-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  ))}
                </div>
              ) : notifications && notifications.length > 0 ? (
                <div className="space-y-4">
                  {notifications.map((notif) => (
                    <div key={notif.id} className="relative pl-4 border-l-2 border-border/50">
                      <div className={cn(
                        "absolute -left-[5px] top-1.5 h-2 w-2 rounded-full",
                        !notif.isRead ? "bg-primary" : "bg-transparent"
                      )} />
                      <p className="text-sm font-medium text-foreground">{notif.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{notif.message}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">{formatTimeAgo(new Date(notif.timestamp))}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
                  <CircleCheck className="h-8 w-8 mb-2 opacity-20" />
                  <p className="text-sm">You're all caught up!</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
