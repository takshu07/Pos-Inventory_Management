/**
 * Sales report — gross, net, AOV, items, returns, and the trend.
 *
 * RETURN RATE IS MEASURED IN UNITS, NOT IN CURRENCY.
 *
 * Returning one ₹5,000 jacket and one ₹200 tee is two return events. A
 * value-weighted rate would make the cheap one statistically invisible, which
 * is exactly backwards for spotting a sizing problem on a budget line.
 */

import { useState } from "react";
import {
  IndianRupee,
  Package,
  Percent,
  RefreshCcw,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";

import { Select } from "@/components/ui";
import {
  BiAreaChart,
  BiBarChart,
  ChartShell,
  KpiCard,
  KpiGrid,
  MetricPanel,
  StatRow,
  cleanFilters,
  formatBucket,
  formatCurrency,
  formatCurrencyExact,
  formatNumber,
  formatPercent,
  DEFAULT_FILTERS,
  type ReportFilterState,
} from "@/components/shared/bi";

import { ReportShell } from "../components/ReportShell";
import { useSalesReport } from "../hooks/useReports";

const GRANULARITY_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly" },
];

export default function SalesReportPage() {
  const [filters, setFilters] = useState<ReportFilterState>(DEFAULT_FILTERS);
  const [granularity, setGranularity] = useState("auto");

  const params = { ...cleanFilters(filters), granularity };
  const { data, isLoading, isError, error } = useSalesReport(params);

  const m = data?.metrics;
  const resolved = data?.period?.granularity ?? "day";

  return (
    <ReportShell
      title="Sales Report"
      description="Completed sales only. Gross sales is what customers paid — after discount and round-off, before refunds."
      reportKey="sales"
      filters={filters}
      onFiltersChange={setFilters}
      show={["employee", "category", "brand", "paymentMethod", "sku", "invoice"]}
      exportExtras={{ granularity }}
      isLoading={isLoading}
      isError={isError}
      error={error}
      filterExtras={
        <div className="w-32">
          <Select
            options={GRANULARITY_OPTIONS}
            value={granularity}
            onChange={(e) => setGranularity(e.target.value)}
            aria-label="Chart granularity"
          />
        </div>
      }
    >
      <KpiGrid columns={4}>
        <KpiCard
          label="Gross Sales"
          value={m?.grossSales ?? 0}
          format={formatCurrency}
          icon={IndianRupee}
          accent="success"
          {...(data?.comparison
            ? {
                trend: {
                  direction: data.comparison.trend,
                  value: data.comparison.revenueGrowth,
                  label: "vs previous",
                },
              }
            : {})}
        />
        <KpiCard
          label="Net Sales"
          value={m?.netSales ?? 0}
          format={formatCurrency}
          icon={IndianRupee}
          hint={`After ${formatCurrency(m?.returnValue ?? 0)} of refunds`}
        />
        <KpiCard
          label="Orders"
          value={m?.orders ?? 0}
          format={formatNumber}
          icon={ShoppingBag}
          hint={`AOV ${formatCurrencyExact(m?.averageOrderValue ?? 0)}`}
        />
        <KpiCard
          label="Gross Margin"
          value={m?.grossMarginPercent ?? 0}
          format={(n) => formatPercent(n)}
          icon={TrendingUp}
          accent="info"
          hint={`${formatCurrency(m?.grossProfit ?? 0)} gross profit`}
        />
      </KpiGrid>

      <KpiGrid columns={4}>
        <KpiCard
          label="Items Sold"
          value={m?.itemsSold ?? 0}
          format={formatNumber}
          icon={Package}
        />
        <KpiCard
          label="Returns"
          value={m?.returns ?? 0}
          format={formatNumber}
          icon={RefreshCcw}
          accent={(m?.returns ?? 0) > 0 ? "warning" : "default"}
          hint={`${formatPercent(m?.returnRatePercent ?? 0)} of units sold`}
        />
        <KpiCard
          label="Exchanges"
          value={m?.exchanges ?? 0}
          format={formatNumber}
          icon={RefreshCcw}
          hint={`${formatCurrency(m?.exchangeValue ?? 0)} of goods issued`}
        />
        <KpiCard
          label="Discounts Given"
          value={m?.discounts ?? 0}
          format={formatCurrency}
          icon={Percent}
          accent="warning"
        />
      </KpiGrid>

      <ChartShell
        title="Sales over time"
        subtitle={`${data?.period?.label ?? ""} · ${resolved} buckets`}
        isLoading={isLoading}
        isEmpty={(data?.series?.length ?? 0) === 0}
        height={320}
      >
        <BiAreaChart
          data={data?.series ?? []}
          xKey="bucket"
          xTickFormatter={(v) => formatBucket(v, resolved)}
          series={[{ key: "revenue", label: "Revenue" }]}
        />
      </ChartShell>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartShell
          title="Orders per period"
          subtitle="Volume alongside value"
          isLoading={isLoading}
          isEmpty={(data?.series?.length ?? 0) === 0}
          height={280}
          className="lg:col-span-2"
        >
          <BiBarChart
            data={data?.series ?? []}
            xKey="bucket"
            xTickFormatter={(v) => formatBucket(v, resolved)}
            valueFormat="number"
            tooltipFormat="number"
            series={[{ key: "orders", label: "Orders", color: "var(--bi-s4)" }]}
          />
        </ChartShell>

        <MetricPanel title="Metrics" description={data?.period?.label} isLoading={isLoading}>
          <div className="space-y-0.5">
            <StatRow label="Gross sales" value={formatCurrencyExact(m?.grossSales ?? 0)} />
            <StatRow
              label="Less: refunds"
              value={formatCurrencyExact(m?.returnValue ?? 0)}
              tone="negative"
            />
            <StatRow label="Net sales" value={formatCurrencyExact(m?.netSales ?? 0)} emphasis />
            <StatRow
              label="Less: cost of goods"
              value={formatCurrencyExact(m?.cogs ?? 0)}
              tone="negative"
            />
            <StatRow
              label="Gross profit"
              value={formatCurrencyExact(m?.grossProfit ?? 0)}
              emphasis
              tone="positive"
            />

            <div className="h-2" />
            <StatRow label="Orders" value={formatNumber(m?.orders ?? 0)} tone="muted" />
            <StatRow label="Items sold" value={formatNumber(m?.itemsSold ?? 0)} tone="muted" />
            <StatRow
              label="Average order value"
              value={formatCurrencyExact(m?.averageOrderValue ?? 0)}
              tone="muted"
            />
            <StatRow label="Tax collected" value={formatCurrencyExact(m?.tax ?? 0)} tone="muted" />
          </div>
        </MetricPanel>
      </div>
    </ReportShell>
  );
}
