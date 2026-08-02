/**
 * Category and Brand reports.
 *
 * THEY SHARE A FILE BECAUSE THEY ARE THE SAME REPORT ON A DIFFERENT DIMENSION.
 *
 * Both group sales by one catalog axis and show revenue, units, margin and
 * share. Building them separately would mean two places to fix the same
 * "margin column renders negatives wrong" bug. The one real difference — brands
 * also carry current stock held — is a couple of extra columns, not a second
 * page.
 */

import { useState } from "react";
import { Award, Boxes, Package, Tag, TrendingUp } from "lucide-react";

import {
  BiBarChart,
  BiPieChart,
  ChartShell,
  KpiCard,
  KpiGrid,
  ReportTable,
  cleanFilters,
  formatCurrency,
  formatCurrencyExact,
  formatNumber,
  formatPercent,
  formatSignedPercent,
  DEFAULT_FILTERS,
  type ReportColumn,
  type ReportFilterState,
} from "@/components/shared/bi";
import { cn } from "@/utils/cn";

import { ReportShell } from "../components/ReportShell";
import { useBrandReport, useCategoryReport } from "../hooks/useReports";

// =============================================================================
// SHARED CELL RENDERERS
// =============================================================================

function MarginCell({ value }: { value: number }) {
  return (
    <span
      className={cn(
        value < 0
          ? "text-red-600 dark:text-red-400"
          : value < 15
            ? "text-amber-600 dark:text-amber-400"
            : ""
      )}
    >
      {formatPercent(value)}
    </span>
  );
}

function GrowthCell({ value, trend }: { value: number; trend: "up" | "down" | "flat" }) {
  return (
    <span
      className={cn(
        "font-medium",
        trend === "up" && "text-emerald-600 dark:text-emerald-400",
        trend === "down" && "text-red-600 dark:text-red-400",
        trend === "flat" && "text-muted-foreground"
      )}
    >
      {formatSignedPercent(value)}
    </span>
  );
}

function ShareCell({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-10 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full bg-primary"
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </span>
      {formatPercent(value)}
    </span>
  );
}

// =============================================================================
// CATEGORY REPORT
// =============================================================================

type CategoryRow = {
  categoryId: string;
  categoryName: string;
  unitsSold: number;
  revenue: number;
  cost: number;
  grossProfit: number;
  marginPercent: number;
  productCount: number;
  orders: number;
  share: number;
  growth: number;
  trend: "up" | "down" | "flat";
}

export function CategoryReportPage() {
  const [filters, setFilters] = useState<ReportFilterState>(DEFAULT_FILTERS);
  const params = cleanFilters(filters);
  const { data, isLoading, isError, error } = useCategoryReport(params);

  const rows = (data?.data ?? []) as CategoryRow[];
  const summary = data?.summary as
    | { categories: number; revenue: number; grossProfit: number; unitsSold: number }
    | undefined;

  const columns: Array<ReportColumn<CategoryRow>> = [
    {
      key: "categoryName",
      header: "Category",
      locked: true,
      width: 200,
      render: (row) => <span className="font-medium">{row.categoryName}</span>,
    },
    {
      key: "unitsSold",
      header: "Units",
      align: "right",
      render: (row) => formatNumber(row.unitsSold),
      footer: formatNumber(summary?.unitsSold ?? 0),
    },
    {
      key: "orders",
      header: "Orders",
      align: "right",
      defaultHidden: true,
      render: (row) => formatNumber(row.orders),
    },
    {
      key: "revenue",
      header: "Revenue",
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
      align: "right",
      render: (row) => formatCurrencyExact(row.grossProfit),
      footer: formatCurrencyExact(summary?.grossProfit ?? 0),
    },
    {
      key: "marginPercent",
      header: "Margin",
      align: "right",
      width: 100,
      render: (row) => <MarginCell value={row.marginPercent} />,
    },
    {
      key: "share",
      header: "Share",
      align: "right",
      width: 130,
      render: (row) => <ShareCell value={row.share} />,
    },
    {
      key: "growth",
      header: "Growth",
      align: "right",
      width: 100,
      render: (row) => <GrowthCell value={row.growth} trend={row.trend} />,
    },
    {
      key: "productCount",
      header: "Products",
      align: "right",
      defaultHidden: true,
      render: (row) => formatNumber(row.productCount),
    },
  ];

  return (
    <ReportShell
      title="Category Report"
      description="Revenue, units and margin by catalog category, with share of total and period-over-period growth."
      reportKey="categories"
      filters={filters}
      onFiltersChange={setFilters}
      show={["employee", "brand", "supplier", "paymentMethod"]}
      isLoading={isLoading}
      isError={isError}
      error={error}
    >
      <KpiGrid columns={4}>
        <KpiCard
          label="Categories Selling"
          value={summary?.categories ?? 0}
          format={formatNumber}
          icon={Tag}
        />
        <KpiCard
          label="Revenue"
          value={summary?.revenue ?? 0}
          format={formatCurrency}
          icon={TrendingUp}
          accent="success"
        />
        <KpiCard
          label="Gross Profit"
          value={summary?.grossProfit ?? 0}
          format={formatCurrency}
          icon={TrendingUp}
          accent="info"
        />
        <KpiCard
          label="Units Sold"
          value={summary?.unitsSold ?? 0}
          format={formatNumber}
          icon={Package}
        />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartShell
          title="Revenue by category"
          isLoading={isLoading}
          isEmpty={rows.length === 0}
          height={320}
        >
          <BiBarChart
            data={rows.slice(0, 10)}
            xKey="categoryName"
            layout="horizontal"
            series={[{ key: "revenue", label: "Revenue" }]}
          />
        </ChartShell>

        <ChartShell
          title="Share of revenue"
          subtitle="Largest first"
          isLoading={isLoading}
          isEmpty={rows.length === 0}
          height={320}
        >
          <BiPieChart
            data={rows}
            nameKey="categoryName"
            valueKey="revenue"
            variant="donut"
            centerLabel="Total revenue"
            centerValue={formatCurrency(summary?.revenue ?? 0)}
          />
        </ChartShell>
      </div>

      <ReportTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.categoryId}
        isLoading={isLoading}
        storageKey="report-categories"
        showFooter
        emptyTitle="No category sales"
        emptyMessage="Nothing sold in this period matched the filters."
      />
    </ReportShell>
  );
}

// =============================================================================
// BRAND REPORT
// =============================================================================

type BrandRow = {
  brandId: string;
  brandName: string;
  unitsSold: number;
  revenue: number;
  cost: number;
  grossProfit: number;
  marginPercent: number;
  currentStock: number;
  stockValue: number;
  productCount: number;
  share: number;
  growth: number;
  trend: "up" | "down" | "flat";
}

export function BrandReportPage() {
  const [filters, setFilters] = useState<ReportFilterState>(DEFAULT_FILTERS);
  const params = cleanFilters(filters);
  const { data, isLoading, isError, error } = useBrandReport(params);

  const rows = (data?.data ?? []) as BrandRow[];
  const summary = data?.summary as
    | { brands: number; revenue: number; grossProfit: number; stockValue: number }
    | undefined;

  const columns: Array<ReportColumn<BrandRow>> = [
    {
      key: "brandName",
      header: "Brand",
      locked: true,
      width: 200,
      render: (row) => <span className="font-medium">{row.brandName}</span>,
    },
    {
      key: "unitsSold",
      header: "Units Sold",
      align: "right",
      render: (row) => formatNumber(row.unitsSold),
    },
    {
      key: "revenue",
      header: "Revenue",
      align: "right",
      render: (row) => formatCurrencyExact(row.revenue),
      footer: formatCurrencyExact(summary?.revenue ?? 0),
    },
    {
      key: "grossProfit",
      header: "Gross Profit",
      align: "right",
      render: (row) => formatCurrencyExact(row.grossProfit),
      footer: formatCurrencyExact(summary?.grossProfit ?? 0),
    },
    {
      key: "marginPercent",
      header: "Margin",
      align: "right",
      width: 100,
      render: (row) => <MarginCell value={row.marginPercent} />,
    },
    {
      key: "currentStock",
      header: "Stock Held",
      align: "right",
      render: (row) => formatNumber(row.currentStock),
    },
    {
      key: "stockValue",
      header: "Stock Value",
      align: "right",
      render: (row) => formatCurrencyExact(row.stockValue),
      footer: formatCurrencyExact(summary?.stockValue ?? 0),
    },
    {
      key: "share",
      header: "Share",
      align: "right",
      width: 130,
      render: (row) => <ShareCell value={row.share} />,
    },
    {
      key: "growth",
      header: "Growth",
      align: "right",
      width: 100,
      render: (row) => <GrowthCell value={row.growth} trend={row.trend} />,
    },
    {
      key: "productCount",
      header: "Products",
      align: "right",
      defaultHidden: true,
      render: (row) => formatNumber(row.productCount),
    },
  ];

  return (
    <ReportShell
      title="Brand Report"
      description="Revenue and margin by brand, alongside the stock currently held in that brand — the two numbers a buying decision needs together."
      reportKey="brands"
      filters={filters}
      onFiltersChange={setFilters}
      show={["employee", "category", "supplier", "paymentMethod"]}
      isLoading={isLoading}
      isError={isError}
      error={error}
    >
      <KpiGrid columns={4}>
        <KpiCard
          label="Brands Selling"
          value={summary?.brands ?? 0}
          format={formatNumber}
          icon={Award}
        />
        <KpiCard
          label="Revenue"
          value={summary?.revenue ?? 0}
          format={formatCurrency}
          icon={TrendingUp}
          accent="success"
        />
        <KpiCard
          label="Gross Profit"
          value={summary?.grossProfit ?? 0}
          format={formatCurrency}
          icon={TrendingUp}
          accent="info"
        />
        <KpiCard
          label="Stock Held at Cost"
          value={summary?.stockValue ?? 0}
          format={formatCurrency}
          icon={Boxes}
          hint="Across every brand that sold"
        />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartShell
          title="Revenue by brand"
          isLoading={isLoading}
          isEmpty={rows.length === 0}
          height={320}
        >
          <BiBarChart
            data={rows.slice(0, 10)}
            xKey="brandName"
            layout="horizontal"
            series={[{ key: "revenue", label: "Revenue" }]}
          />
        </ChartShell>

        <ChartShell
          title="Revenue against stock held"
          subtitle="A brand with high stock and low revenue is capital sitting still"
          isLoading={isLoading}
          isEmpty={rows.length === 0}
          height={320}
        >
          <BiBarChart
            data={rows.slice(0, 8)}
            xKey="brandName"
            series={[
              { key: "revenue", label: "Revenue" },
              { key: "stockValue", label: "Stock at cost", color: "var(--bi-s2)" },
            ]}
          />
        </ChartShell>
      </div>

      <ReportTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.brandId}
        isLoading={isLoading}
        storageKey="report-brands"
        showFooter
        emptyTitle="No brand sales"
        emptyMessage="Nothing sold in this period matched the filters."
      />
    </ReportShell>
  );
}
