/**
 * Low Stock / Out of Stock / Reorder Centre.
 *
 * ONE component, three configurations. They ask the same question at different
 * urgencies — "what do I need to buy?" — and share every column, the same
 * reorder maths and the same purchase-order action. Three separate
 * implementations would be three chances for the recommended quantity on one
 * screen to disagree with another, which is exactly the kind of drift that
 * makes people stop trusting the number.
 *
 * The recommended quantity comes from the server's engine, never recomputed
 * here.
 */

import { useState } from "react";
import { AlertTriangle, PackageX, ShoppingCart, TrendingDown } from "lucide-react";

import {
  Card, EmptyState, ErrorState, Pagination, Select,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui";
import { cn } from "@/utils/cn";
import {
  InventoryTableSkeleton,
  KpiCard,
  ProductCell,
  StockStatusBadge,
} from "../components/InventoryAtoms";
import { InventoryExportMenu } from "../components/InventoryExportMenu";
import { useLowStock, useOutOfStock, useReorder } from "../hooks/useInventory";
import {
  coverAccent,
  formatCurrency,
  formatDays,
  formatNumber,
  formatRelative,
  formatVariantName,
} from "../utils/format";

export type ReplenishVariant = "low-stock" | "out-of-stock" | "reorder";

const COPY: Record<
  ReplenishVariant,
  { title: string; subtitle: string; empty: string; emptyHint: string }
> = {
  "low-stock": {
    title: "Low Stock",
    subtitle: "Items at or below their reorder level — order these before they run out.",
    empty: "Nothing is running low",
    emptyHint: "Every item is comfortably above its reorder level.",
  },
  "out-of-stock": {
    title: "Out of Stock",
    subtitle: "Items you cannot sell right now. Each one is a customer turned away.",
    empty: "Nothing is out of stock",
    emptyHint: "Every active item has stock available.",
  },
  reorder: {
    title: "Reorder Centre",
    subtitle:
      "Recommended purchase quantities, based on how fast each item sells and how long the supplier takes.",
    empty: "Nothing needs reordering",
    emptyHint: "Every item has enough cover for its lead time plus safety stock.",
  },
};

const WINDOW_OPTIONS = [
  { value: "30", label: "30-day sales rate" },
  { value: "60", label: "60-day sales rate" },
  { value: "90", label: "90-day sales rate" },
];

export function ReplenishmentPage({ variant }: { variant: ReplenishVariant }) {
  const copy = COPY[variant];

  const [page, setPage] = useState(1);
  const [windowDays, setWindowDays] = useState(30);
  const [dueOnly, setDueOnly] = useState(true);

  // Only the query for THIS variant is enabled — the other two stay inert
  // rather than firing requests whose results are never read.
  const lowStock = useLowStock({ page, limit: 25 }, variant === "low-stock");
  const outOfStock = useOutOfStock({ page, limit: 25 }, variant === "out-of-stock");
  const reorder = useReorder(
    { page, limit: 25, windowDays, dueOnly },
    variant === "reorder"
  );

  const query =
    variant === "reorder" ? reorder : variant === "out-of-stock" ? outOfStock : lowStock;

  const rows = (query.data?.data ?? []) as any[];
  const total = query.data?.total ?? 0;
  const totalPages = query.data?.totalPages ?? 1;

  // Totals across the loaded page. Labelled as such — claiming they cover the
  // whole catalogue would be a lie once paging kicks in.
  const pageOrderUnits = rows.reduce((sum, r) => sum + (r.recommendedQuantity ?? 0), 0);
  const pageOrderCost = rows.reduce((sum, r) => sum + (r.estimatedCost ?? 0), 0);
  const showCost = rows.some((r) => r.estimatedCost !== undefined);

  const Icon =
    variant === "out-of-stock" ? PackageX : variant === "reorder" ? ShoppingCart : AlertTriangle;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{copy.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{copy.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {variant === "reorder" && (
            <>
              <Select
                className="w-auto min-w-[11rem]"
                options={WINDOW_OPTIONS}
                value={String(windowDays)}
                onChange={(e) => {
                  setWindowDays(Number(e.target.value));
                  setPage(1);
                }}
                aria-label="Sales rate window"
              />
              <Select
                className="w-auto min-w-[10rem]"
                options={[
                  { value: "true", label: "Due now only" },
                  { value: "false", label: "Show everything" },
                ]}
                value={String(dueOnly)}
                onChange={(e) => {
                  setDueOnly(e.target.value === "true");
                  setPage(1);
                }}
                aria-label="Filter by reorder need"
              />
            </>
          )}

          <InventoryExportMenu
            report={variant === "reorder" ? "low-stock" : variant}
            filters={variant === "reorder" ? { windowDays } : {}}
            disabled={rows.length === 0}
          />
        </div>
      </div>

      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard icon={Icon} label="Items listed" value={formatNumber(total)} />
          <KpiCard
            icon={ShoppingCart}
            label="Units to order"
            value={formatNumber(pageOrderUnits)}
            hint="this page"
          />
          {showCost && (
            <KpiCard
              icon={ShoppingCart}
              label="Estimated spend"
              value={formatCurrency(pageOrderCost)}
              hint="this page"
            />
          )}
          <KpiCard
            icon={TrendingDown}
            label="Most urgent"
            value={
              rows[0]?.daysRemaining != null ? formatDays(rows[0].daysRemaining) : "—"
            }
            hint="days of cover"
          />
        </div>
      )}

      {query.isError ? (
        <ErrorState message={`Failed to load ${copy.title.toLowerCase()}.`} onRetry={() => query.refetch()} />
      ) : !query.isLoading && rows.length === 0 ? (
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
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Reorder At</TableHead>
                <TableHead className="text-right">Daily Sales</TableHead>
                <TableHead className="text-right">Cover</TableHead>
                <TableHead className="text-right">Order</TableHead>
                {showCost && <TableHead className="text-right">Est. Cost</TableHead>}
                <TableHead>
                  {variant === "out-of-stock" ? "Out Since" : "Status"}
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {query.isLoading ? (
                <InventoryTableSkeleton columns={showCost ? 9 : 8} />
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

                    <TableCell className="max-w-[10rem] truncate text-xs text-muted-foreground">
                      {r.supplierName ?? "—"}
                    </TableCell>

                    <TableCell
                      className={cn(
                        "text-right font-medium tabular-nums",
                        r.available <= 0 && "text-destructive"
                      )}
                    >
                      {formatNumber(r.available)}
                    </TableCell>

                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatNumber(r.reorderLevel ?? r.reorderPoint)}
                    </TableCell>

                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r.averageDailySales > 0 ? r.averageDailySales.toFixed(1) : "—"}
                    </TableCell>

                    <TableCell className="text-right tabular-nums">
                      {/* NULL cover means nothing is selling — that is a
                          clearance problem, not an urgent reorder. */}
                      <span className={coverAccent(r.daysRemaining)}>
                        {formatDays(r.daysRemaining)}
                      </span>
                    </TableCell>

                    <TableCell className="text-right font-medium tabular-nums">
                      {r.recommendedQuantity > 0 ? (
                        formatNumber(r.recommendedQuantity)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    {showCost && (
                      <TableCell className="text-right tabular-nums">
                        {r.estimatedCost > 0 ? formatCurrency(r.estimatedCost) : "—"}
                      </TableCell>
                    )}

                    <TableCell className="whitespace-nowrap text-xs">
                      {variant === "out-of-stock" ? (
                        r.daysOutOfStock != null ? (
                          <span className="text-destructive">
                            {r.daysOutOfStock} day{r.daysOutOfStock === 1 ? "" : "s"}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Never sold</span>
                        )
                      ) : r.status ? (
                        <StockStatusBadge status={r.status} />
                      ) : (
                        <span className="text-muted-foreground">
                          {r.shouldReorder ? "Due" : "OK"}
                        </span>
                      )}
                      {r.lastSaleAt && (
                        <div className="text-[11px] text-muted-foreground">
                          sold {formatRelative(r.lastSaleAt)}
                        </div>
                      )}
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

      {variant === "reorder" && rows.length > 0 && (
        <Card className="p-3">
          <p className="text-[11px] text-muted-foreground">
            Recommended quantities cover expected demand over the supplier's lead time plus a
            safety buffer, using the observed sales rate. They are a heuristic, not a
            forecast — a seasonal spike will not be anticipated.
          </p>
        </Card>
      )}
    </div>
  );
}

export default ReplenishmentPage;
