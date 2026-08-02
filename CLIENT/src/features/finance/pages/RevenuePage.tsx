/**
 * Revenue — daily / weekly / monthly / yearly, with the payment-method mix.
 *
 * GRANULARITY IS A USER CONTROL, NOT A DERIVED CONSTANT.
 *
 * The server picks a sensible default from the window length (a day-granular
 * chart over three years is 1,095 unreadable points), but an owner comparing
 * two specific weeks wants day buckets regardless. So `auto` is the default and
 * the override is one click away.
 */

import { useState } from "react";
import { IndianRupee, Receipt, RefreshCcw, ShoppingBag } from "lucide-react";

import { Select } from "@/components/ui";
import {
  BiAreaChart,
  BiBarChart,
  BiPieChart,
  ChartShell,
  ExportMenu,
  FilterBar,
  KpiCard,
  KpiGrid,
  MetricPanel,
  PageHeader,
  StatRow,
  cleanFilters,
  formatBucket,
  formatCurrency,
  formatCurrencyExact,
  formatNumber,
  formatPercent,
  PAYMENT_METHOD_LABELS,
  DEFAULT_FILTERS,
  type ReportFilterState,
} from "@/components/shared/bi";

import { useRevenue } from "../hooks/useFinance";

const GRANULARITY_OPTIONS = [
  { value: "auto", label: "Automatic" },
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly" },
];

export default function RevenuePage() {
  const [filters, setFilters] = useState<ReportFilterState>(DEFAULT_FILTERS);
  const [granularity, setGranularity] = useState("auto");

  const params = { ...cleanFilters(filters), granularity };
  const { data, isLoading, isFetching } = useRevenue(params);

  const resolvedGranularity = data?.period.granularity ?? "day";
  const totals = data?.totals;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Revenue"
        description="Completed sales only. Gross revenue is what customers actually paid — after discounts and round-off, before refunds."
        actions={<ExportMenu path="/finance/export/revenue" filters={params} />}
      />

      <FilterBar
        value={filters}
        onChange={setFilters}
        isLoading={isFetching}
        actions={
          <div className="w-40">
            <Select
              options={GRANULARITY_OPTIONS}
              value={granularity}
              onChange={(e) => setGranularity(e.target.value)}
              aria-label="Chart granularity"
            />
          </div>
        }
      />

      <KpiGrid columns={4}>
        <KpiCard
          label="Gross Revenue"
          value={totals?.grossRevenue ?? 0}
          format={formatCurrency}
          icon={IndianRupee}
          accent="success"
          {...(data
            ? {
                trend: {
                  direction: data.comparison.trend,
                  value: data.comparison.growth,
                  label: "vs previous period",
                },
              }
            : {})}
        />
        <KpiCard
          label="Net Revenue"
          value={totals?.netRevenue ?? 0}
          format={formatCurrency}
          icon={IndianRupee}
          hint={`After ${formatCurrency(totals?.refunds ?? 0)} of refunds`}
        />
        <KpiCard
          label="Orders"
          value={totals?.orders ?? 0}
          format={formatNumber}
          icon={ShoppingBag}
          hint={`Previously ${formatNumber(data?.comparison.previousOrders ?? 0)}`}
        />
        <KpiCard
          label="Average Order Value"
          value={totals?.averageOrderValue ?? 0}
          format={formatCurrencyExact}
          icon={Receipt}
          accent="info"
        />
      </KpiGrid>

      {/* ── Revenue trend ──────────────────────────────────────────────────── */}
      <ChartShell
        title="Revenue trend"
        subtitle={`${data?.period.label ?? ""} · ${resolvedGranularity} buckets`}
        isLoading={isLoading}
        isEmpty={(data?.series.length ?? 0) === 0}
        height={320}
      >
        <BiAreaChart
          data={data?.series ?? []}
          xKey="bucket"
          xTickFormatter={(v) => formatBucket(v, resolvedGranularity)}
          series={[{ key: "revenue", label: "Revenue" }]}
        />
      </ChartShell>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* ── Payment mix ──────────────────────────────────────────────────── */}
        <ChartShell
          title="Payment method mix"
          subtitle="Share of revenue by tender"
          isLoading={isLoading}
          isEmpty={(data?.paymentBreakdown.length ?? 0) === 0}
          height={300}
          className="lg:col-span-2"
        >
          <BiPieChart
            data={(data?.paymentBreakdown ?? []).map((p) => ({
              ...p,
              label: PAYMENT_METHOD_LABELS[p.method] ?? p.method,
            }))}
            nameKey="label"
            valueKey="amount"
            variant="donut"
            centerLabel="Total collected"
            centerValue={formatCurrency(
              (data?.paymentBreakdown ?? []).reduce((n, p) => n + p.amount, 0)
            )}
          />
        </ChartShell>

        {/* ── Composition ──────────────────────────────────────────────────── */}
        <MetricPanel
          title="Revenue composition"
          description={data?.period.label}
          isLoading={isLoading}
        >
          <div className="space-y-0.5">
            <StatRow label="Subtotal" value={formatCurrencyExact(totals?.subtotal ?? 0)} />
            <StatRow
              label="Less: discounts"
              value={formatCurrencyExact(totals?.discounts ?? 0)}
              tone="negative"
            />
            <StatRow label="Plus: tax" value={formatCurrencyExact(totals?.tax ?? 0)} />
            <StatRow
              label="Gross revenue"
              value={formatCurrencyExact(totals?.grossRevenue ?? 0)}
              emphasis
            />
            <StatRow
              label="Less: refunds"
              value={formatCurrencyExact(totals?.refunds ?? 0)}
              tone="negative"
            />
            <StatRow
              label="Net revenue"
              value={formatCurrencyExact(totals?.netRevenue ?? 0)}
              emphasis
              tone="positive"
            />

            <div className="h-3" />
            <StatRow
              label="Exchanges issued"
              value={formatCurrencyExact(totals?.exchangeValue ?? 0)}
              tone="muted"
            />
            <StatRow
              label="Exchange count"
              value={formatNumber(totals?.exchangeCount ?? 0)}
              tone="muted"
            />
          </div>
        </MetricPanel>
      </div>

      {/* ── Orders alongside revenue ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartShell
          title="Orders per period"
          subtitle="Volume, not value"
          isLoading={isLoading}
          isEmpty={(data?.series.length ?? 0) === 0}
          height={280}
        >
          <BiBarChart
            data={data?.series ?? []}
            xKey="bucket"
            xTickFormatter={(v) => formatBucket(v, resolvedGranularity)}
            valueFormat="number"
            tooltipFormat="number"
            series={[{ key: "orders", label: "Orders", color: "var(--bi-s4)" }]}
          />
        </ChartShell>

        <MetricPanel
          title="By payment method"
          description="Amount, transaction count and share"
          isLoading={isLoading}
        >
          {(data?.paymentBreakdown.length ?? 0) === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No payments recorded in this period.
            </p>
          ) : (
            <div className="space-y-0.5">
              {data!.paymentBreakdown.map((p) => (
                <div
                  key={p.method}
                  className="flex items-baseline justify-between gap-3 border-b border-border py-2 last:border-0"
                >
                  <span className="text-sm">{PAYMENT_METHOD_LABELS[p.method] ?? p.method}</span>
                  <span className="shrink-0 text-right">
                    <span className="text-sm font-medium tabular-nums">
                      {formatCurrencyExact(p.amount)}
                    </span>
                    <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                      {formatNumber(p.count)} txns · {formatPercent(p.percentage)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </MetricPanel>
      </div>

      {(data?.totals.refunds ?? 0) > 0 && (
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <RefreshCcw className="h-3 w-3" aria-hidden />
          Refunds are negative price differences on completed exchanges — this system records
          returns as exchanges rather than as standalone refunds.
        </p>
      )}
    </div>
  );
}
