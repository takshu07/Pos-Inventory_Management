/**
 * @file features/dashboard/components/widgets/InventoryAlertsWidget.tsx
 *
 * Purpose: Displays products that are low or out of stock.
 */

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { InventoryAlert, WidgetProps } from "../../types";
import { cn } from "@/utils/cn";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { Link } from "react-router";

interface InventoryAlertsWidgetProps extends WidgetProps {
  alerts: InventoryAlert[] | undefined;
}

export function InventoryAlertsWidget({ alerts, isLoading, className }: InventoryAlertsWidgetProps) {
  return (
    <Card className={cn("h-full flex flex-col border-destructive/20", className)}>
      <CardHeader className="pb-3 flex flex-row items-center justify-between bg-destructive/5 rounded-t-xl">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <CardTitle className="text-sm font-medium text-destructive">Inventory Alerts</CardTitle>
        </div>
        <Link 
          to="/inventory" 
          className="text-xs font-medium text-destructive hover:underline inline-flex items-center"
        >
          View all
          <ArrowUpRight className="ml-1 h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto pt-4">
        <div className="space-y-4">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="flex justify-between">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <Skeleton className="h-3 w-1/3" />
              </div>
            ))
          ) : alerts && alerts.length > 0 ? (
            alerts.map((alert) => (
              <div key={alert.id} className="flex items-start justify-between gap-2 border-b border-border/50 pb-3 last:border-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate" title={alert.productName}>
                    {alert.productName}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {alert.sku} • Stock: <span className="font-semibold text-foreground">{alert.currentStock}</span> (Reorder: {alert.reorderLevel})
                  </p>
                </div>
                <Badge
                  variant={alert.status === "OUT_OF_STOCK" ? "destructive" : "warning"}
                  className="text-[10px] shrink-0"
                >
                  {alert.status === "OUT_OF_STOCK" ? "Out of Stock" : "Low Stock"}
                </Badge>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
              <div className="h-8 w-8 rounded-full bg-emerald-500/10 flex items-center justify-center mb-2">
                <div className="h-3 w-3 rounded-full bg-emerald-500" />
              </div>
              <p className="text-sm">Stock levels are healthy.</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
