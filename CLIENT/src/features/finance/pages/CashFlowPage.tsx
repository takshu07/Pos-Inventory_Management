/**
 * Cash Flow statement.
 *
 * THE HEADLINE AND THE BREAKDOWN MEASURE DIFFERENT THINGS, DELIBERATELY.
 *
 * The summary (money in / money out / net) comes from the DRAWER LEDGER — every
 * rupee that physically moved. The labelled breakdown below it is explanatory
 * and OVERLAPS on purpose: a cash payout is both "Cash Payouts" and part of
 * "Operating Expenses". Summing the breakdown would double-count, which is why
 * the totals are never taken from it. The page says so on the screen rather
 * than leaving a reader to discover the discrepancy and distrust both numbers.
 */

import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Info, Wallet } from "lucide-react";

import { Card, CardContent } from "@/components/ui";
import {
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
  DEFAULT_FILTERS,
  type ReportFilterState,
} from "@/components/shared/bi";
import { cn } from "@/utils/cn";

import { useCashFlow } from "../hooks/useFinance";

export default function CashFlowPage() {
  const [filters, setFilters] = useState<ReportFilterState>(DEFAULT_FILTERS);
  const params = cleanFilters(filters);

  const { data, isLoading, isFetching } = useCashFlow(params);
  const granularity = data?.period.granularity ?? "day";
  const summary = data?.summary;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cash Flow"
        description="Money in and out of the tills. Different from profit: a supplier payment is cash leaving, but its cost was already counted when the stock sold."
        actions={<ExportMenu path="/finance/export/cash-flow" filters={params} />}
      />

      <FilterBar value={filters} onChange={setFilters} isLoading={isFetching} />

      <KpiGrid columns={4}>
        <KpiCard
          label="Opening Balance"
          value={summary?.openingBalance ?? 0}
          format={formatCurrency}
          icon={Wallet}
          hint="Reconstructed from current cash less net movement"
        />
        <KpiCard
          label="Money In"
          value={summary?.moneyIn ?? 0}
          format={formatCurrency}
          icon={ArrowUpRight}
          accent="success"
        />
        <KpiCard
          label="Money Out"
          value={summary?.moneyOut ?? 0}
          format={formatCurrency}
          icon={ArrowDownRight}
          accent="warning"
        />
        <KpiCard
          label="Closing Balance"
          value={summary?.closingBalance ?? 0}
          format={formatCurrency}
          icon={Wallet}
          accent={(summary?.netFlow ?? 0) >= 0 ? "success" : "danger"}
          hint={`Net flow ${formatCurrencyExact(summary?.netFlow ?? 0)}`}
        />
      </KpiGrid>

      {/* ── Running flow ───────────────────────────────────────────────────── */}
      <ChartShell
        title="Cash movement over time"
        subtitle={data?.period.label}
        isLoading={isLoading}
        isEmpty={(data?.series.length ?? 0) === 0}
        height={320}
      >
        <BiBarChart
          data={data?.series ?? []}
          xKey="bucket"
          xTickFormatter={(v) => formatBucket(v, granularity)}
          series={[
            { key: "moneyIn", label: "Money in", color: "var(--bi-s3)" },
            { key: "moneyOut", label: "Money out", color: "var(--bi-s2)" },
          ]}
        />
      </ChartShell>

      {/* ── Breakdown ──────────────────────────────────────────────────────── */}
      <Card className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/25">
        <CardContent className="flex items-start gap-2.5 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden />
          <p className="text-sm text-blue-900 dark:text-blue-200">
            The lines below <strong>overlap on purpose</strong>. A cash payout appears both as
            "Cash Payouts" and inside "Operating Expenses"; a refund is both a refund and part of
            drawer cash out. They explain <em>why</em> money moved — the totals above come from
            the drawer ledger, which counts each movement exactly once.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MetricPanel
          title="Money in"
          description="Where cash came from"
          isLoading={isLoading}
        >
          <div className="space-y-0.5">
            {(data?.breakdown.inflows ?? []).map((line) => (
              <StatRow
                key={line.label}
                label={line.label}
                value={formatCurrencyExact(line.amount)}
                tone={line.amount > 0 ? "positive" : "muted"}
              />
            ))}
            <StatRow
              label="Total received (ledger)"
              value={formatCurrencyExact(summary?.moneyIn ?? 0)}
              emphasis
              tone="positive"
            />
          </div>
        </MetricPanel>

        <MetricPanel
          title="Money out"
          description="Where cash went"
          isLoading={isLoading}
        >
          <div className="space-y-0.5">
            {(data?.breakdown.outflows ?? []).map((line) => (
              <StatRow
                key={line.label}
                label={line.label}
                value={formatCurrencyExact(line.amount)}
                tone={line.amount > 0 ? "negative" : "muted"}
              />
            ))}
            <StatRow
              label="Total paid out (ledger)"
              value={formatCurrencyExact(summary?.moneyOut ?? 0)}
              emphasis
              tone="negative"
            />
          </div>
        </MetricPanel>
      </div>

      {/* ── Reconciliation strip ───────────────────────────────────────────── */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Cash in open drawers right now
            </p>
            <p className="text-xl font-semibold tabular-nums">
              {formatCurrencyExact(summary?.cashInDrawersNow ?? 0)}
            </p>
          </div>

          <div className="flex items-center gap-6 text-sm">
            <Reconcile label="Opening" value={summary?.openingBalance ?? 0} />
            <span className="text-muted-foreground">+</span>
            <Reconcile label="In" value={summary?.moneyIn ?? 0} tone="positive" />
            <span className="text-muted-foreground">−</span>
            <Reconcile label="Out" value={summary?.moneyOut ?? 0} tone="negative" />
            <span className="text-muted-foreground">=</span>
            <Reconcile label="Closing" value={summary?.closingBalance ?? 0} emphasis />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Reconcile({
  label,
  value,
  tone,
  emphasis,
}: {
  label: string;
  value: number;
  tone?: "positive" | "negative";
  emphasis?: boolean;
}) {
  return (
    <div className="text-right">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "tabular-nums",
          emphasis ? "text-base font-semibold" : "text-sm font-medium",
          tone === "positive" && "text-emerald-600 dark:text-emerald-400",
          tone === "negative" && "text-red-600 dark:text-red-400"
        )}
      >
        {formatCurrencyExact(value)}
      </p>
    </div>
  );
}
