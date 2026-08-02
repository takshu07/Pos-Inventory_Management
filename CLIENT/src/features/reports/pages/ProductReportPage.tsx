/**
 * Product report — best sellers, worst sellers, margin, returns.
 *
 * THE SIX "TOP/LEAST" LISTS THE SPEC ASKS FOR ARE ONE QUERY, NOT SIX.
 *
 * Top selling, least selling, highest profit, lowest profit, most returned and
 * most exchanged are the same rows sorted six ways. Exposing sort + direction
 * IS all six lists, and it lets a reader ask questions none of the six fixed
 * lists would have answered ("what has high volume but thin margin?").
 * The quick-view buttons below just set the sort for them.
 */

import { useState } from "react";
import { Package, Percent, TrendingUp } from "lucide-react";

import { Button, Card, CardContent } from "@/components/ui";
import {
  BiBarChart,
  ChartShell,
  KpiCard,
  KpiGrid,
  ReportTable,
  cleanFilters,
  formatCurrency,
  formatCurrencyExact,
  formatNumber,
  formatPercent,
  DEFAULT_FILTERS,
  type ReportColumn,
  type ReportFilterState,
} from "@/components/shared/bi";
import { cn } from "@/utils/cn";

import { ReportShell } from "../components/ReportShell";
import { useProductReport } from "../hooks/useReports";

type SortKey = "revenue" | "units" | "profit" | "margin" | "returns" | "exchanges";

/** The spec's six lists, expressed as sort presets. */
const PRESETS: Array<{ label: string; sortBy: SortKey; sortOrder: "asc" | "desc" }> = [
  { label: "Top selling", sortBy: "units", sortOrder: "desc" },
  { label: "Least selling", sortBy: "units", sortOrder: "asc" },
  { label: "Highest profit", sortBy: "profit", sortOrder: "desc" },
  { label: "Lowest profit", sortBy: "profit", sortOrder: "asc" },
  { label: "Most returned", sortBy: "returns", sortOrder: "desc" },
  { label: "Most exchanged", sortBy: "exchanges", sortOrder: "desc" },
];

type ProductRow = {
  variantId: string;
  productName: string;
  sku: string;
  variantLabel: string;
  categoryName: string | null;
  brandName: string | null;
  unitsSold: number;
  revenue: number;
  cost: number;
  grossProfit: number;
  marginPercent: number;
  currentStock: number;
  returnedUnits: number;
  exchangedUnits: number;
  orders: number;
  returnRatePercent: number;
}

export default function ProductReportPage() {
  const [filters, setFilters] = useState<ReportFilterState>(DEFAULT_FILTERS);
  const [table, setTable] = useState<{
    page: number;
    limit: number;
    sortBy: SortKey;
    sortOrder: "asc" | "desc";
  }>({ page: 1, limit: 25, sortBy: "revenue", sortOrder: "desc" });

  const params = { ...cleanFilters(filters), ...table };
  const { data, isLoading, isError, error } = useProductReport(params);

  const rows = (data?.data ?? []) as ProductRow[];
  const summary = data?.summary as
    | { products: number; unitsSold: number; revenue: number; grossProfit: number }
    | undefined;

  const columns: Array<ReportColumn<ProductRow>> = [
    {
      key: "product",
      header: "Product",
      locked: true,
      width: 240,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.productName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.sku} · {row.variantLabel}
          </p>
        </div>
      ),
    },
    {
      key: "categoryName",
      header: "Category",
      width: 140,
      render: (row) => row.categoryName ?? "—",
    },
    {
      key: "brandName",
      header: "Brand",
      width: 130,
      defaultHidden: true,
      render: (row) => row.brandName ?? "—",
    },
    {
      key: "unitsSold",
      header: "Units Sold",
      sortKey: "units",
      align: "right",
      render: (row) => formatNumber(row.unitsSold),
      footer: formatNumber(summary?.unitsSold ?? 0),
    },
    {
      key: "revenue",
      header: "Revenue",
      sortKey: "revenue",
      align: "right",
      render: (row) => formatCurrencyExact(row.revenue),
      footer: formatCurrencyExact(summary?.revenue ?? 0),
    },
    {
      key: "cost",
      header: "Cost",
      align: "right",
      defaultHidden: true,
      render: (row) => formatCurrencyExact(row.cost),
    },
    {
      key: "grossProfit",
      header: "Gross Profit",
      sortKey: "profit",
      align: "right",
      render: (row) => (
        <span
          className={cn(
            row.grossProfit < 0 && "text-red-600 dark:text-red-400"
          )}
        >
          {formatCurrencyExact(row.grossProfit)}
        </span>
      ),
      footer: formatCurrencyExact(summary?.grossProfit ?? 0),
    },
    {
      key: "marginPercent",
      header: "Margin",
      sortKey: "margin",
      align: "right",
      width: 100,
      render: (row) => (
        <span
          className={cn(
            row.marginPercent < 0
              ? "text-red-600 dark:text-red-400"
              : row.marginPercent < 15
                ? "text-amber-600 dark:text-amber-400"
                : ""
          )}
        >
          {formatPercent(row.marginPercent)}
        </span>
      ),
    },
    {
      key: "currentStock",
      header: "Stock",
      align: "right",
      width: 90,
      render: (row) => formatNumber(row.currentStock),
    },
    {
      key: "returnedUnits",
      header: "Returned",
      sortKey: "returns",
      align: "right",
      width: 110,
      render: (row) =>
        row.returnedUnits > 0 ? (
          <span className="text-amber-700 dark:text-amber-400">
            {formatNumber(row.returnedUnits)} ({formatPercent(row.returnRatePercent, 0)})
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "exchangedUnits",
      header: "Exchanged",
      sortKey: "exchanges",
      align: "right",
      width: 100,
      defaultHidden: true,
      render: (row) => (row.exchangedUnits > 0 ? formatNumber(row.exchangedUnits) : "—"),
    },
    {
      key: "orders",
      header: "Orders",
      align: "right",
      width: 90,
      defaultHidden: true,
      render: (row) => formatNumber(row.orders),
    },
  ];

  const activePreset = PRESETS.find(
    (p) => p.sortBy === table.sortBy && p.sortOrder === table.sortOrder
  );

  return (
    <ReportShell
      title="Product Report"
      description="Every variant sold in the period, with its margin and how often it comes back."
      reportKey="products"
      filters={filters}
      onFiltersChange={setFilters}
      show={["employee", "category", "brand", "supplier", "sku"]}
      exportExtras={{ sortBy: table.sortBy, sortOrder: table.sortOrder }}
      isLoading={isLoading}
      isError={isError}
      error={error}
    >
      <KpiGrid columns={4}>
        <KpiCard
          label="Products Sold"
          value={summary?.products ?? 0}
          format={formatNumber}
          icon={Package}
          hint="Distinct variants with at least one sale"
        />
        <KpiCard
          label="Units Sold"
          value={summary?.unitsSold ?? 0}
          format={formatNumber}
          icon={Package}
          hint="On this page"
        />
        <KpiCard
          label="Revenue"
          value={summary?.revenue ?? 0}
          format={formatCurrency}
          icon={TrendingUp}
          accent="success"
          hint="On this page"
        />
        <KpiCard
          label="Gross Profit"
          value={summary?.grossProfit ?? 0}
          format={formatCurrency}
          icon={Percent}
          accent="info"
          hint="On this page"
        />
      </KpiGrid>

      {/* ── The six lists, as presets ──────────────────────────────────────── */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 py-3">
          <span className="mr-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Quick views
          </span>
          {PRESETS.map((preset) => {
            const active =
              activePreset?.label === preset.label;
            return (
              <Button
                key={preset.label}
                size="sm"
                variant={active ? "default" : "outline"}
                onClick={() =>
                  setTable((prev) => ({
                    ...prev,
                    sortBy: preset.sortBy,
                    sortOrder: preset.sortOrder,
                    page: 1,
                  }))
                }
              >
                {preset.label}
              </Button>
            );
          })}
        </CardContent>
      </Card>

      <ChartShell
        title={activePreset ? activePreset.label : "Products"}
        subtitle="Top 12 on the current sort"
        isLoading={isLoading}
        isEmpty={rows.length === 0}
        height={320}
      >
        <BiBarChart
          data={rows.slice(0, 12).map((r) => ({
            ...r,
            label: `${r.productName} · ${r.variantLabel}`,
          }))}
          xKey="label"
          layout="horizontal"
          valueFormat={
            table.sortBy === "units" || table.sortBy === "returns" || table.sortBy === "exchanges"
              ? "number"
              : "compact"
          }
          tooltipFormat={
            table.sortBy === "units" || table.sortBy === "returns" || table.sortBy === "exchanges"
              ? "number"
              : "currency"
          }
          series={[
            {
              key:
                table.sortBy === "units"
                  ? "unitsSold"
                  : table.sortBy === "profit"
                    ? "grossProfit"
                    : table.sortBy === "margin"
                      ? "marginPercent"
                      : table.sortBy === "returns"
                        ? "returnedUnits"
                        : table.sortBy === "exchanges"
                          ? "exchangedUnits"
                          : "revenue",
              label: activePreset?.label ?? "Revenue",
            },
          ]}
        />
      </ChartShell>

      <ReportTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.variantId}
        isLoading={isLoading}
        storageKey="report-products"
        showFooter
        total={data?.total}
        page={table.page}
        totalPages={data?.totalPages ?? 1}
        onPageChange={(page) => setTable((prev) => ({ ...prev, page }))}
        sortBy={table.sortBy}
        sortOrder={table.sortOrder}
        onSortChange={(sortBy, sortOrder) =>
          setTable((prev) => ({ ...prev, sortBy: sortBy as SortKey, sortOrder, page: 1 }))
        }
        emptyTitle="No products sold"
        emptyMessage="Nothing sold in this period matched the filters."
      />
    </ReportShell>
  );
}
