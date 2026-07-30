import { useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, TrendingDown, TrendingUp } from "lucide-react";
import { Card, Select } from "@/components/ui";
import { ErrorState } from "@/components/ui/StateViews";
import { formatCurrency } from "@/utils/formatters";
import { cn } from "@/utils/cn";
import {
  CategoryDetailSkeleton,
  useCategoryAnalytics,
  type CategoryPerformance,
} from "@/shared/category";
// Imported directly, not via the barrel: this keeps Recharts in the chunks that
// actually draw charts instead of in every category screen's bundle.
import {
  CategoryRankBarChart,
  CategoryTrendChart,
} from "@/shared/category/components/CategoryCharts";

/**
 * OwnerCategoryAnalyticsPage — store-wide category performance (OWNER only).
 *
 * Every figure comes from the server's analytics service, computed from
 * committed sales using the cost snapshotted at the time of each sale — so
 * historical margin stays correct after a re-price. Nothing is recomputed
 * client-side; this page only arranges what the endpoint returns.
 *
 * It is deliberately a separate route rather than a tab on the list screen: the
 * analytics query is expensive (5-minute staleTime) and shouldn't run every
 * time an owner opens the category list to rename something.
 */
export default function OwnerCategoryAnalyticsPage() {
  const [period, setPeriod] = useState("30d");
  const { data, isPending, isError, error, refetch } = useCategoryAnalytics(period, 10);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            to="/admin/categories"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="mr-1 h-3.5 w-3.5" />
            Categories
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Category Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data
              ? `${data.period.label} — ${data.totals.categoriesWithSales} categor${data.totals.categoriesWithSales === 1 ? "y" : "ies"} with sales.`
              : "Revenue, profit and movement across the catalog."}
          </p>
        </div>

        <div className="w-44">
          <Select
            aria-label="Reporting period"
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

      {isError ? (
        <ErrorState
          title="Could not load analytics"
          message={error instanceof Error ? error.message : "Something went wrong."}
          onRetry={() => void refetch()}
        />
      ) : isPending ? (
        <CategoryDetailSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Revenue" value={formatCurrency(data.totals.revenue)} />
            <Stat label="Profit" value={formatCurrency(data.totals.profit)} />
            <Stat label="Margin" value={`${data.totals.margin}%`} />
            <Stat label="Units sold" value={data.totals.units.toLocaleString("en-IN")} />
            <Stat label="Orders" value={data.totals.orders.toLocaleString("en-IN")} />
            <Stat label="Discount given" value={formatCurrency(data.totals.discount)} />
            <Stat
              label="Inventory value"
              value={formatCurrency(data.totals.inventoryValue)}
              hint={`${formatCurrency(data.totals.retailValue)} at retail`}
            />
            <Stat label="Returns" value={data.totals.returns.toLocaleString("en-IN")} />
          </div>

          <CategoryTrendChart data={data.charts.monthly} title="Revenue & profit over time" />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <CategoryRankBarChart
              data={data.charts.revenueByCategory}
              title="Revenue by category"
              subtitle="Top performers for the selected period"
            />
            <CategoryRankBarChart
              data={data.charts.unitsByCategory}
              title="Units sold by category"
              valueType="number"
            />
            <CategoryRankBarChart
              data={data.charts.marginByCategory}
              title="Margin by category"
              subtitle="Where each rupee of revenue is worth most"
              valueType="percent"
            />
            <CategoryRankBarChart
              data={data.charts.inventoryByCategory}
              title="Inventory value by category"
              subtitle="Capital currently tied up in stock"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <RankList
              title="Top by revenue"
              rows={data.widgets.topByRevenue}
              value={(r) => formatCurrency(r.revenue)}
            />
            <RankList
              title="Top by profit"
              rows={data.widgets.topByProfit}
              value={(r) => formatCurrency(r.profit)}
            />
            <RankList
              title="Best margin"
              rows={data.widgets.topByMargin}
              value={(r) => `${r.margin}%`}
            />
            <RankList
              title="Fastest growing"
              rows={data.widgets.fastestGrowing}
              value={(r) => formatCurrency(r.revenue)}
              delta={(r) => r.growth}
            />
            <RankList
              title="Declining"
              rows={data.widgets.declining}
              value={(r) => formatCurrency(r.revenue)}
              delta={(r) => r.growth}
              empty="No category is losing ground."
            />
            <RankList
              title="Most discounted"
              rows={data.widgets.discounted}
              value={(r) => formatCurrency(r.discount)}
              empty="No discounts applied in this period."
            />
            <RankList
              title="Most sold"
              rows={data.widgets.mostSold}
              value={(r) => `${r.units.toLocaleString("en-IN")} units`}
            />
            <RankList
              title="Least sold"
              rows={data.widgets.leastSold}
              value={(r) => `${r.units.toLocaleString("en-IN")} units`}
            />
            <RankList
              title="No sales"
              rows={data.widgets.noSales}
              value={(r) => `${r.productCount} product${r.productCount === 1 ? "" : "s"}`}
              empty="Every category sold something."
            />
            <RankList
              title="Low stock"
              rows={data.widgets.lowStock}
              value={(r) =>
                `${r.lowStockProducts} of ${r.productCount} low`
              }
              empty="No categories are running low."
            />
            <RankList
              title="Highest inventory value"
              rows={data.widgets.highestInventoryValue}
              value={(r) => formatCurrency(r.inventoryValue)}
            />
            <RankList
              title="Lowest revenue"
              rows={data.widgets.lowestByRevenue}
              value={(r) => formatCurrency(r.revenue)}
            />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

/**
 * A ranked widget. Each row links into the category list filtered to that
 * category's name, so a finding on this page is one click from the records
 * behind it.
 */
function RankList({
  title,
  rows,
  value,
  delta,
  empty = "No data for this period.",
}: {
  title: string;
  rows: CategoryPerformance[];
  value: (row: CategoryPerformance) => string;
  delta?: (row: CategoryPerformance) => number;
  empty?: string;
}) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold">{title}</h2>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {rows.map((row, i) => {
            const change = delta?.(row);
            return (
              <li key={row.categoryId} className="flex items-center gap-2 text-sm">
                <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <Link
                  to={`/admin/categories?search=${encodeURIComponent(row.categoryName)}`}
                  className="min-w-0 flex-1 truncate hover:underline"
                  title={row.categoryName}
                >
                  {row.categoryName}
                </Link>
                {change != null && change !== 0 && (
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-0.5 text-xs tabular-nums",
                      change > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-destructive"
                    )}
                  >
                    {change > 0 ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    {Math.abs(change)}%
                  </span>
                )}
                <span className="shrink-0 font-medium tabular-nums">{value(row)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
