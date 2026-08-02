/**
 * Profit report.
 *
 * SHARES ITS DEFINITIONS WITH THE FINANCE P&L, ON PURPOSE.
 *
 * The server computes both through the same `calculateProfitLoss` function, so
 * the two screens cannot report different net profits for the same month.
 * What differs is framing: the Finance page presents a formal statement for an
 * accountant; this one is analytical, leading with the trend and the margin
 * movement a manager acts on.
 */

import { useState } from "react";
import { AlertTriangle, Percent, TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent, Select } from "@/components/ui";
import {
  BiAreaChart,
  BiBarChart,
  BiPieChart,
  ChartShell,
  KpiCard,
  KpiGrid,
  MetricPanel,
  StatRow,
  cleanFilters,
  formatBucket,
  formatCurrency,
  formatCurrencyExact,
  formatPercent,
  DEFAULT_FILTERS,
  type ReportFilterState,
} from "@/components/shared/bi";
import { cn } from "@/utils/cn";

import { ReportShell } from "../components/ReportShell";
import { useProfitReport } from "../hooks/useReports";

export default function ProfitReportPage() {
  const [filters, setFilters] = useState<ReportFilterState>(DEFAULT_FILTERS);
  const [granularity, setGranularity] = useState("auto");

  const params = { ...cleanFilters(filters), granularity, includeBreakdown: true };
  const { data, isLoading, isError, error } = useProfitReport(params);

  const s = data?.statement;
  const prev = data?.previous;
  const resolved = data?.period?.granularity ?? "day";
  const isLoss = (s?.netProfit ?? 0) < 0;

  const breakdown = (data?.expenseBreakdown ?? []) as Array<{
    categoryId: string;
    category: string;
    isRecurring: boolean;
    amount: number;
    count: number;
    percentage: number;
  }>;

  return (
    <ReportShell
      title="Profit Report"
      description="Revenue less cost of goods sold and operating expenses. These are the same definitions the Finance P&L uses — the two screens can never disagree."
      reportKey="profit"
      filters={filters}
      onFiltersChange={setFilters}
      show={["employee", "category", "brand", "paymentMethod"]}
      exportExtras={{ granularity }}
      isLoading={isLoading}
      isError={isError}
      error={error}
      filterExtras={
        <div className="w-32">
          <Select
            options={[
              { value: "auto", label: "Auto" },
              { value: "day", label: "Daily" },
              { value: "week", label: "Weekly" },
              { value: "month", label: "Monthly" },
            ]}
            value={granularity}
            onChange={(e) => setGranularity(e.target.value)}
            aria-label="Chart granularity"
          />
        </div>
      }
    >
      <KpiGrid columns={4}>
        <KpiCard
          label="Net Sales"
          value={s?.netSales ?? 0}
          format={formatCurrency}
          icon={TrendingUp}
          {...(data?.comparison
            ? {
                trend: {
                  direction: data.comparison.revenueGrowth >= 0 ? ("up" as const) : ("down" as const),
                  value: data.comparison.revenueGrowth,
                  label: "vs previous",
                },
              }
            : {})}
        />
        <KpiCard
          label="Gross Profit"
          value={s?.grossProfit ?? 0}
          format={formatCurrency}
          icon={TrendingUp}
          accent="info"
          hint={`${formatPercent(s?.grossMarginPercent ?? 0)} margin`}
        />
        <KpiCard
          label="Operating Expenses"
          value={s?.operatingExpenses ?? 0}
          format={formatCurrency}
          icon={TrendingDown}
          accent="warning"
        />
        <KpiCard
          label="Net Profit"
          value={s?.netProfit ?? 0}
          format={formatCurrency}
          icon={isLoss ? AlertTriangle : Percent}
          accent={isLoss ? "danger" : "success"}
          hint={`${formatPercent(s?.netMarginPercent ?? 0)} margin`}
          {...(data?.comparison
            ? {
                trend: {
                  direction: data.comparison.trend,
                  value: data.comparison.profitGrowth,
                  label: "vs previous",
                },
              }
            : {})}
        />
      </KpiGrid>

      {/* ── Margin movement, stated plainly ────────────────────────────────── */}
      {data && !isLoading && (
        <Card
          className={cn(
            (data.comparison.marginChange ?? 0) >= 0
              ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/25"
              : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/25"
          )}
        >
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
            <p className="text-sm">
              Net margin moved from{" "}
              <strong>{formatPercent(prev?.netMarginPercent ?? 0)}</strong> to{" "}
              <strong>{formatPercent(s?.netMarginPercent ?? 0)}</strong> —{" "}
              <strong>
                {(data.comparison.marginChange ?? 0) >= 0 ? "+" : ""}
                {(data.comparison.marginChange ?? 0).toFixed(2)} percentage points
              </strong>{" "}
              against the previous period.
            </p>
            <p className="text-xs text-muted-foreground">
              Previous net profit {formatCurrency(prev?.netProfit ?? 0)}
            </p>
          </CardContent>
        </Card>
      )}

      <ChartShell
        title="Profit over time"
        subtitle={`${data?.period?.label ?? ""} · revenue, cost, expenses and the profit that falls out`}
        isLoading={isLoading}
        isEmpty={(data?.series?.length ?? 0) === 0}
        height={340}
      >
        <BiAreaChart
          data={data?.series ?? []}
          xKey="bucket"
          xTickFormatter={(v) => formatBucket(v, resolved)}
          series={[
            { key: "revenue", label: "Revenue" },
            { key: "cogs", label: "Cost of goods" },
            { key: "expenses", label: "Operating expenses" },
            { key: "netProfit", label: "Net profit", color: "var(--bi-s3)" },
          ]}
        />
      </ChartShell>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <MetricPanel
          title="Statement"
          description={data?.period?.label}
          isLoading={isLoading}
        >
          <div className="space-y-0.5">
            <StatRow label="Gross sales" value={formatCurrencyExact(s?.grossSales ?? 0)} />
            <StatRow
              label="Less: refunds"
              value={formatCurrencyExact(s?.refunds ?? 0)}
              tone="negative"
            />
            <StatRow label="Net sales" value={formatCurrencyExact(s?.netSales ?? 0)} emphasis />
            <StatRow
              label="Less: cost of goods"
              value={formatCurrencyExact(s?.cogs ?? 0)}
              tone="negative"
            />
            <StatRow
              label="Gross profit"
              value={formatCurrencyExact(s?.grossProfit ?? 0)}
              emphasis
              tone="positive"
            />
            <StatRow
              label="Less: operating expenses"
              value={formatCurrencyExact(s?.operatingExpenses ?? 0)}
              tone="negative"
            />
            <StatRow
              label="Net profit"
              value={formatCurrencyExact(s?.netProfit ?? 0)}
              emphasis
              tone={isLoss ? "negative" : "positive"}
            />
          </div>
        </MetricPanel>

        <ChartShell
          title="Where the margin goes"
          subtitle="Cost of goods and expenses against net sales"
          isLoading={isLoading}
          isEmpty={!s || s.netSales === 0}
          height={300}
        >
          <BiPieChart
            data={[
              { label: "Cost of goods", value: s?.cogs ?? 0 },
              { label: "Operating expenses", value: s?.operatingExpenses ?? 0 },
              { label: "Net profit", value: Math.max(0, s?.netProfit ?? 0) },
            ]}
            nameKey="label"
            valueKey="value"
            variant="donut"
            centerLabel="Net sales"
            centerValue={formatCurrency(s?.netSales ?? 0)}
          />
        </ChartShell>

        <ChartShell
          title="Expenses by category"
          subtitle="Largest first"
          isLoading={isLoading}
          isEmpty={breakdown.length === 0}
          emptyMessage="No approved expenses in this period."
          height={300}
        >
          <BiBarChart
            data={breakdown.slice(0, 8)}
            xKey="category"
            layout="horizontal"
            series={[{ key: "amount", label: "Amount", color: "var(--bi-s2)" }]}
          />
        </ChartShell>
      </div>

      <ChartShell
        title="Gross vs net profit"
        subtitle="The gap between the two lines is what overheads cost you"
        isLoading={isLoading}
        isEmpty={(data?.series?.length ?? 0) === 0}
        height={300}
      >
        <BiBarChart
          data={data?.series ?? []}
          xKey="bucket"
          xTickFormatter={(v) => formatBucket(v, resolved)}
          series={[
            { key: "grossProfit", label: "Gross profit" },
            { key: "netProfit", label: "Net profit", color: "var(--bi-s3)" },
          ]}
        />
      </ChartShell>
    </ReportShell>
  );
}
