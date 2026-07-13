/**
 * @file features/dashboard/components/widgets/SalesChartWidget.tsx
 *
 * Purpose: Renders the revenue and order volume trends.
 *
 * Notes:
 * - Uses Recharts for responsive SVG rendering.
 * - Displays dual metrics (Revenue as area, Orders as line).
 */

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { ChartDataPoint, WidgetProps } from "../../types";
import { cn } from "@/utils/cn";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Line,
} from "recharts";
import { formatCurrency } from "@/utils/formatters";

interface SalesChartWidgetProps extends WidgetProps {
  data: ChartDataPoint[] | undefined;
  title?: string;
}

export function SalesChartWidget({ data, isLoading, title = "Revenue Trend", className }: SalesChartWidgetProps) {
  return (
    <Card className={cn("h-full flex flex-col", className)}>
      <CardHeader className="pb-4">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-[300px]">
        {isLoading ? (
          <div className="w-full h-full flex flex-col gap-4 items-end">
            <Skeleton className="h-4/5 w-full rounded-md" />
            <div className="flex w-full justify-between mt-2">
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-3 w-10" />
            </div>
          </div>
        ) : data && data.length > 0 ? (
          <div className="h-full w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis 
                  dataKey="date" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                  dy={10}
                />
                <YAxis 
                  yAxisId="left"
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(value) => `₹${value / 1000}k`}
                  width={60}
                />
                <YAxis 
                  yAxisId="right"
                  orientation="right"
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                  width={40}
                  hide // Hidden to keep it clean, but keeps scaling correct for the Line
                />
                <Tooltip 
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-card border border-border p-3 rounded-lg shadow-lg">
                          <p className="text-sm font-medium mb-2">{label}</p>
                          <div className="flex flex-col gap-1 text-xs">
                            <span className="flex items-center text-primary font-medium">
                              <div className="w-2 h-2 rounded-full bg-primary mr-2" />
                              Revenue: {formatCurrency(payload[0].value as number)}
                            </span>
                            <span className="flex items-center text-emerald-500 font-medium">
                              <div className="w-2 h-2 rounded-full bg-emerald-500 mr-2" />
                              Orders: {payload[1].value}
                            </span>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Area 
                  yAxisId="left"
                  type="monotone" 
                  dataKey="revenue" 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorRevenue)" 
                />
                <Line 
                  yAxisId="right"
                  type="monotone" 
                  dataKey="orders" 
                  stroke="hsl(var(--emerald-500))" 
                  strokeWidth={2} 
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-full w-full flex items-center justify-center text-muted-foreground text-sm">
            No chart data available.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
