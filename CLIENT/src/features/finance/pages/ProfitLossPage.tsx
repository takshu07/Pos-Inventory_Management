/**
 * Profit & Loss statement.
 *
 * LAID OUT AS A STATEMENT, NOT A DASHBOARD.
 *
 * A P&L is read top to bottom: each line subtracts from the one above until a
 * bottom line falls out. Presenting it as a grid of cards would destroy that
 * reading — the whole point is the arithmetic being visible. So the primary
 * surface is a single column of labelled rows with rules under the subtotals,
 * exactly as an accountant would set it.
 *
 * The chart and the previous-period column are secondary: they answer "is this
 * better than last time", which is a different question from "what is it".
 */

import { useState } from "react";
import { AlertTriangle, TrendingDown, TrendingUp } from "lucide-react";

import { Badge, Card, CardContent } from "@/components/ui";
import {
  BiAreaChart,
  BiBarChart,
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
  formatPercent,
  formatSignedPercent,
  DEFAULT_FILTERS,
  type ReportFilterState,
} from "@/components/shared/bi";
import { cn } from "@/utils/cn";

import { useProfitLoss } from "../hooks/useFinance";

export default function ProfitLossPage() {
  const [filters, setFilters] = useState<ReportFilterState>(DEFAULT_FILTERS);
  const params = cleanFilters(filters);

  const { data, isLoading, isFetching } = useProfitLoss({ ...params, includeBreakdown: true });

  const s = data?.statement;
  const prev = data?.previous;
  const granularity = data?.period.granularity ?? "day";
  const isLoss = (s?.netProfit ?? 0) < 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Profit & Loss"
        description="Net sales less cost of goods sold and operating expenses. Salaries appear once, inside operating expenses — supplier payments are not subtracted again, because that stock is already counted in COGS."
        actions={<ExportMenu path="/finance/export/profit-loss" filters={params} />}
      />

      <FilterBar value={filters} onChange={setFilters} isLoading={isFetching} />

      {/* ── Headline ───────────────────────────────────────────────────────── */}
      <KpiGrid columns={4}>
        <KpiCard
          label="Net Sales"
          value={s?.netSales ?? 0}
          format={formatCurrency}
          icon={TrendingUp}
          hint={`Gross ${formatCurrency(s?.grossSales ?? 0)} less refunds`}
          {...(data
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
          icon={isLoss ? AlertTriangle : TrendingUp}
          accent={isLoss ? "danger" : "success"}
          hint={`${formatPercent(s?.netMarginPercent ?? 0)} margin`}
          {...(data
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

      {isLoss && !isLoading && (
        <Card className="border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30">
          <CardContent className="flex items-start gap-2.5 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
            <p className="text-sm text-red-900 dark:text-red-200">
              <strong>This period made a loss.</strong> Operating expenses of{" "}
              {formatCurrency(s?.operatingExpenses ?? 0)} exceeded a gross profit of{" "}
              {formatCurrency(s?.grossProfit ?? 0)}. The expense breakdown below shows where.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* ── The statement ────────────────────────────────────────────────── */}
        <MetricPanel
          title="Statement"
          description={data?.period.label}
          isLoading={isLoading}
          className="lg:col-span-2"
        >
          <div className="space-y-0.5">
            <StatRow label="Gross sales" value={formatCurrencyExact(s?.grossSales ?? 0)} />
            <StatRow
              label="Less: refunds"
              value={formatCurrencyExact(s?.refunds ?? 0)}
              tone="negative"
            />
            <StatRow label="NET SALES" value={formatCurrencyExact(s?.netSales ?? 0)} emphasis />

            <div className="h-2" />

            <StatRow
              label="Less: cost of goods sold"
              value={formatCurrencyExact(s?.cogs ?? 0)}
              tone="negative"
            />
            <StatRow
              label="GROSS PROFIT"
              value={formatCurrencyExact(s?.grossProfit ?? 0)}
              emphasis
              tone="positive"
            />
            <StatRow
              label="Gross margin"
              value={formatPercent(s?.grossMarginPercent ?? 0)}
              tone="muted"
            />

            <div className="h-2" />

            <StatRow
              label="Less: operating expenses"
              value={formatCurrencyExact(s?.operatingExpenses ?? 0)}
              tone="negative"
            />
            <StatRow
              label="NET PROFIT"
              value={formatCurrencyExact(s?.netProfit ?? 0)}
              emphasis
              tone={isLoss ? "negative" : "positive"}
            />
            <StatRow
              label="Net margin"
              value={formatPercent(s?.netMarginPercent ?? 0)}
              tone="muted"
            />

            <div className="h-3" />

            {/* Memo lines: informative, but NOT part of the arithmetic above.
                Discounts are already inside grandTotal and tax is collected on
                behalf of the government — subtracting either would be wrong. */}
            <p className="pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Memo — not deducted above
            </p>
            <StatRow
              label="Discounts given"
              value={formatCurrencyExact(s?.discounts ?? 0)}
              tone="muted"
            />
            <StatRow label="Tax collected" value={formatCurrencyExact(s?.tax ?? 0)} tone="muted" />
          </div>
        </MetricPanel>

        {/* ── Comparison ───────────────────────────────────────────────────── */}
        <MetricPanel
          title="Against the previous period"
          description="Same length, immediately before"
          isLoading={isLoading}
          className="lg:col-span-3"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 text-left font-medium">Line</th>
                  <th className="pb-2 text-right font-medium">This period</th>
                  <th className="pb-2 text-right font-medium">Previous</th>
                  <th className="pb-2 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <ComparisonRow label="Net sales" current={s?.netSales} previous={prev?.netSales} />
                <ComparisonRow label="Cost of goods" current={s?.cogs} previous={prev?.cogs} invert />
                <ComparisonRow
                  label="Gross profit"
                  current={s?.grossProfit}
                  previous={prev?.grossProfit}
                />
                <ComparisonRow
                  label="Operating expenses"
                  current={s?.operatingExpenses}
                  previous={prev?.operatingExpenses}
                  invert
                />
                <ComparisonRow
                  label="Net profit"
                  current={s?.netProfit}
                  previous={prev?.netProfit}
                  emphasis
                />
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border">
                  <td className="pt-2.5 text-sm font-semibold">Net margin</td>
                  <td className="pt-2.5 text-right tabular-nums">
                    {formatPercent(s?.netMarginPercent ?? 0)}
                  </td>
                  <td className="pt-2.5 text-right tabular-nums text-muted-foreground">
                    {formatPercent(prev?.netMarginPercent ?? 0)}
                  </td>
                  <td
                    className={cn(
                      "pt-2.5 text-right font-medium tabular-nums",
                      (data?.comparison.marginChange ?? 0) >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    )}
                  >
                    {(data?.comparison.marginChange ?? 0) >= 0 ? "+" : ""}
                    {(data?.comparison.marginChange ?? 0).toFixed(2)} pts
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </MetricPanel>
      </div>

      {/* ── Trend ──────────────────────────────────────────────────────────── */}
      <ChartShell
        title="Profit over time"
        subtitle={`${data?.period.label ?? ""} · revenue, cost, expenses and the profit that falls out`}
        isLoading={isLoading}
        isEmpty={(data?.series.length ?? 0) === 0}
        height={320}
      >
        <BiAreaChart
          data={data?.series ?? []}
          xKey="bucket"
          xTickFormatter={(v) => formatBucket(v, granularity)}
          series={[
            { key: "revenue", label: "Revenue" },
            { key: "cogs", label: "Cost of goods" },
            { key: "expenses", label: "Operating expenses" },
            { key: "netProfit", label: "Net profit", color: "var(--bi-s3)" },
          ]}
        />
      </ChartShell>

      {/* ── Expense breakdown ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartShell
          title="Operating expenses by category"
          subtitle="Largest first"
          isLoading={isLoading}
          isEmpty={(data?.expenseBreakdown.length ?? 0) === 0}
          emptyMessage="No approved expenses in this period."
          height={320}
        >
          <BiBarChart
            data={data?.expenseBreakdown ?? []}
            xKey="category"
            layout="horizontal"
            series={[{ key: "amount", label: "Amount" }]}
          />
        </ChartShell>

        <MetricPanel
          title="Expense detail"
          description="Recurring overheads are marked — they are the floor your margin has to clear"
          isLoading={isLoading}
        >
          {(data?.expenseBreakdown.length ?? 0) === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No approved expenses in this period.
            </p>
          ) : (
            <div className="space-y-0.5">
              {data!.expenseBreakdown.map((b) => (
                <div
                  key={b.categoryId}
                  className="flex items-baseline justify-between gap-3 border-b border-border py-2 last:border-0"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm">{b.category}</span>
                    {b.isRecurring && <Badge variant="outline">Recurring</Badge>}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="text-sm font-medium tabular-nums">
                      {formatCurrencyExact(b.amount)}
                    </span>
                    <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                      {formatPercent(b.percentage)}
                    </span>
                  </span>
                </div>
              ))}
              <StatRow
                label="Total operating expenses"
                value={formatCurrencyExact(s?.operatingExpenses ?? 0)}
                emphasis
              />
            </div>
          )}
        </MetricPanel>
      </div>
    </div>
  );
}

// =============================================================================
// COMPARISON ROW
// =============================================================================

function ComparisonRow({
  label,
  current,
  previous,
  invert = false,
  emphasis = false,
}: {
  label: string;
  current: number | undefined;
  previous: number | undefined;
  /** Set on cost lines, where an increase is bad news. */
  invert?: boolean;
  emphasis?: boolean;
}) {
  const now = current ?? 0;
  const then = previous ?? 0;
  const change = then === 0 ? (now === 0 ? 0 : 100) : ((now - then) / Math.abs(then)) * 100;

  const good = invert ? change < 0 : change > 0;
  const neutral = Math.abs(change) < 0.005;

  return (
    <tr>
      <td className={cn("py-2 text-sm", emphasis && "font-semibold")}>{label}</td>
      <td className={cn("py-2 text-right tabular-nums", emphasis && "font-semibold")}>
        {formatCurrencyExact(now)}
      </td>
      <td className="py-2 text-right tabular-nums text-muted-foreground">
        {formatCurrencyExact(then)}
      </td>
      <td
        className={cn(
          "py-2 text-right font-medium tabular-nums",
          neutral
            ? "text-muted-foreground"
            : good
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400"
        )}
      >
        {formatSignedPercent(change)}
      </td>
    </tr>
  );
}
