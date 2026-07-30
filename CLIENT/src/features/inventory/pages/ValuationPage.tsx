/**
 * Inventory Valuation — OWNER only.
 *
 * The endpoint does not exist on the manager tree and the service refuses a
 * non-owner outright, so this page is never reachable without permission. The
 * valuation method is stated on screen because "what is my stock worth" has
 * more than one defensible answer, and a number without its method is not
 * auditable.
 */

import { useState } from "react";
import { Boxes, IndianRupee, Layers, TrendingUp } from "lucide-react";

import {
  Badge, Card, ErrorState, Select, Skeleton,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui";
import { KpiCard, KpiCardSkeleton } from "../components/InventoryAtoms";
import { ChartCard, AgingChart } from "../components/InventoryCharts";
import { InventoryExportMenu } from "../components/InventoryExportMenu";
import { useAging, useValuation } from "../hooks/useInventory";
import { formatCurrency, formatNumber, formatPercent } from "../utils/format";

const GROUP_OPTIONS = [
  { value: "category", label: "By category" },
  { value: "brand", label: "By brand" },
  { value: "supplier", label: "By supplier" },
];

export default function ValuationPage() {
  const [groupBy, setGroupBy] = useState<"category" | "brand" | "supplier">("category");

  const { data, isLoading, isError, refetch } = useValuation({ groupBy });
  const aging = useAging();

  if (isError) {
    return (
      <div className="p-6">
        <ErrorState message="Failed to load the valuation." onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventory Valuation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What your stock cost, what it could fetch, and where the money sits.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Select
            className="w-auto min-w-[10rem]"
            options={GROUP_OPTIONS}
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}
            aria-label="Group breakdown by"
          />
          <InventoryExportMenu report="valuation" filters={{ groupBy }} />
        </div>
      </div>

      {isLoading || !data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <KpiCardSkeleton key={i} />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <KpiCard icon={Boxes} label="SKUs" value={formatNumber(data.totals.skuCount)} />
            <KpiCard icon={Layers} label="Units" value={formatNumber(data.totals.quantity)} />
            <KpiCard
              icon={IndianRupee}
              label="Stock value"
              value={formatCurrency(data.totals.stockValue)}
              hint="at cost"
            />
            <KpiCard
              icon={IndianRupee}
              label="Retail value"
              value={formatCurrency(data.totals.retailValue)}
              hint="if it all sold"
            />
            <KpiCard
              icon={TrendingUp}
              label="Potential profit"
              value={formatCurrency(data.totals.potentialProfit)}
              accent="text-emerald-600 dark:text-emerald-400"
              hint={`${formatPercent(data.totals.marginPercentage)} margin`}
            />
            <KpiCard
              icon={IndianRupee}
              label="Average cost"
              value={formatCurrency(data.totals.averageCost)}
              hint="per unit"
            />
          </div>

          {/* Stating the method is what makes the number auditable. */}
          <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
            <p className="text-xs text-muted-foreground">
              Valued using the <span className="font-medium text-foreground">average cost</span>{" "}
              method — each item's cost is the moving average of what you have paid for it.
            </p>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">ABC:</span>
              <Badge variant="success">A · {data.abc.A}</Badge>
              <Badge variant="info">B · {data.abc.B}</Badge>
              <Badge variant="secondary">C · {data.abc.C}</Badge>
            </div>
          </Card>

          {/* ── Breakdown ────────────────────────────────────────────────── */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[12rem]">
                    {groupBy === "category" ? "Category" : groupBy === "brand" ? "Brand" : "Supplier"}
                  </TableHead>
                  <TableHead className="text-right">SKUs</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Stock Value</TableHead>
                  <TableHead className="text-right">Retail Value</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead className="min-w-[8rem]">Share</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {data.breakdown.map((g) => (
                  <TableRow key={g.id ?? g.name}>
                    <TableCell className="font-medium capitalize">{g.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(g.skuCount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(g.quantity)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatCurrency(g.stockValue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(g.retailValue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(g.potentialProfit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPercent(g.marginPercentage)}
                    </TableCell>
                    <TableCell>
                      {/* An inline bar makes concentration visible without a
                          separate chart — one glance shows if 80% of capital
                          sits in one category. */}
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.min(100, g.sharePercentage)}%` }}
                          />
                        </div>
                        <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                          {g.sharePercentage.toFixed(0)}%
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* ── Aging + top items ────────────────────────────────────────── */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Inventory aging"
              description="Measured from each item's last sale, not from when it arrived."
            >
              {aging.isLoading || !aging.data ? (
                <Skeleton className="h-[180px] w-full" />
              ) : (
                <AgingChart data={aging.data.buckets} showValue />
              )}
            </ChartCard>

            <ChartCard
              title="Top items by value"
              description="Where your capital is concentrated."
            >
              <div className="flex flex-col gap-1.5">
                {data.topByValue.slice(0, 8).map((item) => (
                  <div
                    key={item.variantId}
                    className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5 last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs">{item.productName}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        <span className="font-mono">{item.sku}</span> ·{" "}
                        {formatNumber(item.quantity)} units
                      </div>
                    </div>
                    <Badge
                      variant={
                        item.abcClass === "A"
                          ? "success"
                          : item.abcClass === "B"
                            ? "info"
                            : "secondary"
                      }
                    >
                      {item.abcClass}
                    </Badge>
                    <span className="w-24 shrink-0 text-right text-xs font-medium tabular-nums">
                      {formatCurrency(item.stockValue)}
                    </span>
                  </div>
                ))}
              </div>
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
