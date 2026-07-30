import { useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Select } from "@/components/ui";
import { formatCurrency } from "@/utils/formatters";
import { cn } from "@/utils/cn";
import { useSingleCategoryAnalytics } from "../../useCategories";
import { CategoryTrendChart } from "../CategoryCharts";
import { CategoryDetailSkeleton } from "../CategorySkeleton";

/**
 * CategoryAnalyticsTab — performance for one category (Phase 3).
 *
 * Every figure is computed server-side from committed sales, using cost
 * snapshotted at the moment of each sale — so historical margin stays correct
 * even after a product is re-priced. Nothing here is estimated client-side.
 */
export function CategoryAnalyticsTab({ categoryId }: { categoryId: string }) {
  const [period, setPeriod] = useState("30d");
  const { data, isPending, isError, error } = useSingleCategoryAnalytics(categoryId, period);

  if (isPending) return <CategoryDetailSkeleton />;

  if (isError) {
    return (
      <p className="py-8 text-center text-sm text-destructive">
        {error instanceof Error ? error.message : "Could not load analytics."}
      </p>
    );
  }

  const m = data.metrics;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          Ranked{" "}
          <span className="font-medium text-foreground">#{data.rank.byRevenue}</span> of{" "}
          {data.rank.of} by revenue
        </div>
        <div className="w-40">
          <Select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            options={[
              { value: "7d", label: "Last 7 days" },
              { value: "30d", label: "Last 30 days" },
              { value: "90d", label: "Last 90 days" },
              { value: "12m", label: "Last 12 months" },
            ]}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Revenue" value={formatCurrency(m.revenue)} delta={m.growth} />
        <Stat label="Profit" value={formatCurrency(m.profit)} />
        <Stat label="Margin" value={`${m.margin}%`} />
        <Stat label="Units sold" value={m.units.toLocaleString("en-IN")} />
        <Stat label="Avg selling price" value={formatCurrency(m.averageSellingPrice)} />
        <Stat label="Inventory value" value={formatCurrency(m.inventoryValue)} />
        <Stat
          label="Returns"
          value={`${m.returns}`}
          hint={m.units > 0 ? `${m.returnRate}% of units` : undefined}
        />
        <Stat
          label="Low stock"
          value={`${m.lowStockProducts}`}
          hint={`of ${m.productCount} products`}
        />
      </div>

      <CategoryTrendChart data={data.charts.monthly} title="Revenue & profit over time" />
    </div>
  );
}

function Stat({
  label,
  value,
  delta,
  hint,
}: {
  label: string;
  value: string;
  delta?: number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>

      {delta !== undefined && (
        // Direction is carried by an icon and a sign, not colour alone.
        <div
          className={cn(
            "mt-0.5 flex items-center gap-1 text-xs",
            delta > 0
              ? "text-emerald-600 dark:text-emerald-400"
              : delta < 0
                ? "text-destructive"
                : "text-muted-foreground"
          )}
        >
          {delta > 0 ? (
            <TrendingUp className="h-3 w-3" />
          ) : delta < 0 ? (
            <TrendingDown className="h-3 w-3" />
          ) : null}
          {delta > 0 ? "+" : ""}
          {delta}% vs previous
        </div>
      )}

      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
