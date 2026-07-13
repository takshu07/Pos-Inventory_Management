/**
 * @file features/dashboard/components/widgets/StatCard.tsx
 *
 * Purpose: Reusable KPI stat card (Revenue, Orders, etc).
 * 
 * Responsibilities:
 * - Render a single metric with a label, icon, and optional comparative trend.
 * - Owns its loading skeleton state.
 */

import { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/utils/cn";
import { WidgetProps } from "../../types";

interface StatCardProps extends WidgetProps {
  title: string;
  value: string;
  icon: ReactNode;
  trend?: {
    value: number; // percentage
    label: string;
  };
}

export function StatCard({ title, value, icon, trend, isLoading, className }: StatCardProps) {
  if (isLoading) {
    return (
      <Card className={cn("overflow-hidden", className)}>
        <CardContent className="p-6">
          <div className="flex items-center justify-between space-y-0 pb-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-8 rounded-md" />
          </div>
          <Skeleton className="h-8 w-32 mt-2" />
          <Skeleton className="h-3 w-40 mt-3" />
        </CardContent>
      </Card>
    );
  }

  const isPositiveTrend = trend && trend.value > 0;
  const isNegativeTrend = trend && trend.value < 0;
  
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between pb-2">
          <h3 className="tracking-tight text-sm font-medium text-muted-foreground">{title}</h3>
          <div className="h-8 w-8 flex items-center justify-center rounded-md bg-primary/10 text-primary">
            {icon}
          </div>
        </div>
        <div className="text-2xl font-bold">{value}</div>
        
        {trend && (
          <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
            <span
              className={cn(
                "flex items-center font-medium",
                isPositiveTrend && "text-emerald-600 dark:text-emerald-400",
                isNegativeTrend && "text-red-600 dark:text-red-400",
                !isPositiveTrend && !isNegativeTrend && "text-muted-foreground"
              )}
            >
              {isPositiveTrend && <TrendingUp className="mr-1 h-3 w-3" />}
              {isNegativeTrend && <TrendingDown className="mr-1 h-3 w-3" />}
              {!isPositiveTrend && !isNegativeTrend && <Minus className="mr-1 h-3 w-3" />}
              {Math.abs(trend.value)}%
            </span>
            <span>{trend.label}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
