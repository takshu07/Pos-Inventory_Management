/**
 * Dead / Slow / Fast moving stock.
 *
 * ONE component, three buckets — the same table answering "what should I
 * discount?" and "what should I never run out of?". Implementing them
 * separately would give three chances for "dead stock" to mean something
 * different here than it does on the badge in the stock table.
 *
 * Dead stock is judged on TIME SINCE LAST SALE, not units sold: an item that
 * sold fifty units and then nothing for four months is dead despite a healthy
 * total, and that is exactly the case a units-based rule misses.
 */

import { useState } from "react";
import { Flame, Snowflake, TrendingDown } from "lucide-react";

import {
  Card, EmptyState, ErrorState, Pagination, Select,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui";
import { Badge } from "@/components/ui";
import {
  InventoryTableSkeleton,
  KpiCard,
  ProductCell,
} from "../components/InventoryAtoms";
import { InventoryExportMenu } from "../components/InventoryExportMenu";
import { useVelocity } from "../hooks/useInventory";
import {
  formatCurrency,
  formatDays,
  formatNumber,
  formatRelative,
  formatVariantName,
} from "../utils/format";

export type VelocityBucket = "DEAD_STOCK" | "SLOW_MOVING" | "FAST_MOVING";

const COPY: Record<
  VelocityBucket,
  { title: string; subtitle: string; empty: string; emptyHint: string; icon: React.ElementType }
> = {
  DEAD_STOCK: {
    title: "Dead Stock",
    subtitle:
      "Stock that has not sold in 90 days or more. Capital sitting on a shelf — discount it, promote it, or clear it.",
    empty: "No dead stock",
    emptyHint: "Everything you hold has sold within the last 90 days.",
    icon: Snowflake,
  },
  SLOW_MOVING: {
    title: "Slow Moving",
    subtitle: "Selling, but barely. Worth a nudge before it becomes dead stock.",
    empty: "Nothing is moving slowly",
    emptyHint: "Every item is selling at a healthy rate.",
    icon: TrendingDown,
  },
  FAST_MOVING: {
    title: "Fast Moving",
    subtitle: "Your best sellers. These are the items you cannot afford to run out of.",
    empty: "No fast movers yet",
    emptyHint: "Once sales build up, your strongest performers will appear here.",
    icon: Flame,
  },
};

const WINDOW_OPTIONS = [
  { value: "30", label: "30-day window" },
  { value: "90", label: "90-day window" },
  { value: "180", label: "180-day window" },
];

const REPORT_KEY: Record<VelocityBucket, "dead-stock" | "slow-moving" | "fast-moving"> = {
  DEAD_STOCK: "dead-stock",
  SLOW_MOVING: "slow-moving",
  FAST_MOVING: "fast-moving",
};

export function VelocityPage({ bucket }: { bucket: VelocityBucket }) {
  const copy = COPY[bucket];
  const Icon = copy.icon;

  const [page, setPage] = useState(1);
  const [windowDays, setWindowDays] = useState(90);

  const { data, isLoading, isError, refetch } = useVelocity({
    page,
    limit: 25,
    bucket,
    windowDays,
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const showCost = rows.some((r) => r.stockValue !== undefined);

  // Page totals, labelled as such.
  const pageRetail = rows.reduce((sum, r) => sum + r.retailValue, 0);
  const pageUnits = rows.reduce((sum, r) => sum + r.currentStock, 0);

  const isStagnant = bucket !== "FAST_MOVING";

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{copy.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{copy.subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <Select
            className="w-auto min-w-[10rem]"
            options={WINDOW_OPTIONS}
            value={String(windowDays)}
            onChange={(e) => {
              setWindowDays(Number(e.target.value));
              setPage(1);
            }}
            aria-label="Analysis window"
          />
          <InventoryExportMenu
            report={REPORT_KEY[bucket]}
            filters={{ windowDays }}
            disabled={rows.length === 0}
          />
        </div>
      </div>

      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard icon={Icon} label="Items" value={formatNumber(total)} />
          <KpiCard icon={Icon} label="Units held" value={formatNumber(pageUnits)} hint="this page" />
          <KpiCard
            icon={Icon}
            label="Retail value"
            value={formatCurrency(pageRetail)}
            hint="this page"
            accent={isStagnant ? "text-destructive" : undefined}
          />
          {showCost && (
            <KpiCard
              icon={Icon}
              label="Capital tied up"
              value={formatCurrency(rows.reduce((s, r) => s + (r.stockValue ?? 0), 0))}
              hint="this page, at cost"
              accent={isStagnant ? "text-destructive" : undefined}
            />
          )}
        </div>
      )}

      {isError ? (
        <ErrorState message={`Failed to load ${copy.title.toLowerCase()}.`} onRetry={() => refetch()} />
      ) : !isLoading && rows.length === 0 ? (
        <EmptyState
          icon={<Icon className="h-8 w-8 text-muted-foreground" />}
          title={copy.empty}
          description={copy.emptyHint}
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[16rem]">Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">On Hand</TableHead>
                <TableHead className="text-right">Units Sold</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">
                  {isStagnant ? "Days Idle" : "Days to Clear"}
                </TableHead>
                <TableHead className="text-right">Value</TableHead>
                {isStagnant && <TableHead className="text-right">Suggested</TableHead>}
                <TableHead>Last Sale</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {isLoading ? (
                <InventoryTableSkeleton columns={isStagnant ? 9 : 8} />
              ) : (
                rows.map((r) => (
                  <TableRow key={r.variantId}>
                    <TableCell>
                      <ProductCell
                        imageUrl={r.imageUrl}
                        productName={r.productName}
                        variantName={formatVariantName(r.variantName)}
                        sku={r.sku}
                      />
                    </TableCell>

                    <TableCell className="whitespace-nowrap text-xs">
                      {r.categoryName ?? <span className="text-muted-foreground">—</span>}
                      {r.brandName && (
                        <div className="text-[11px] text-muted-foreground">{r.brandName}</div>
                      )}
                    </TableCell>

                    <TableCell className="text-right font-medium tabular-nums">
                      {formatNumber(r.currentStock)}
                    </TableCell>

                    <TableCell className="text-right tabular-nums">
                      {formatNumber(r.unitsSold)}
                    </TableCell>

                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(r.revenue)}
                    </TableCell>

                    <TableCell className="text-right tabular-nums">
                      {isStagnant ? (
                        r.daysSinceLastSale != null ? (
                          <span className="text-destructive">{r.daysSinceLastSale}</span>
                        ) : (
                          <Badge variant="error">Never sold</Badge>
                        )
                      ) : (
                        formatDays(r.daysToSell)
                      )}
                    </TableCell>

                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(r.stockValue ?? r.retailValue)}
                    </TableCell>

                    {isStagnant && (
                      <TableCell className="text-right">
                        {r.suggestedDiscount > 0 ? (
                          <Badge variant="warning">{r.suggestedDiscount}% off</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}

                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {r.lastSaleAt ? formatRelative(r.lastSaleAt) : "Never"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {total > 0 && (
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      )}

      {isStagnant && rows.length > 0 && (
        <Card className="p-3">
          <p className="text-[11px] text-muted-foreground">
            Suggested discounts deepen with age and cap at 50%. Beyond that the decision is
            whether to write the stock off, which is a judgement call rather than a formula.
          </p>
        </Card>
      )}
    </div>
  );
}

export default VelocityPage;
