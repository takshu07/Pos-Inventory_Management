/**
 * Financial dashboard — the nine headline cards, plus the period view.
 *
 * WHY TWO ROWS OF NUMBERS
 * -----------------------
 * The top row is FIXED-PERIOD: today and this month. Those answer "how are we
 * doing right now" and must not move when a reader changes the period filter,
 * or the card they were watching silently becomes a different measurement.
 *
 * The second row follows the SELECTED period and carries the comparisons.
 * Keeping the two apart is what lets an owner set the period to "last quarter"
 * without losing sight of today's takings.
 */

import { useState } from "react";
import { Link } from "react-router";
import {
  Banknote,
  Boxes,
  IndianRupee,
  Receipt,
  TrendingUp,
  Truck,
  Users,
  Wallet,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui";
import {
  BiAreaChart,
  BiPieChart,
  ChartShell,
  ExportMenu,
  FilterBar,
  KpiCard,
  KpiGrid,
  KpiGridSkeleton,
  MetricPanel,
  PageHeader,
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

import { useFinanceDashboard, useProfitLoss, useCashFlow } from "../hooks/useFinance";

export default function FinanceDashboardPage() {
  const [filters, setFilters] = useState<ReportFilterState>(DEFAULT_FILTERS);
  const params = cleanFilters(filters);

  const dashboard = useFinanceDashboard(params);
  const profitLoss = useProfitLoss({ ...params, includeBreakdown: true });
  const cashFlow = useCashFlow(params);

  const cards = dashboard.data?.cards;
  const totals = dashboard.data?.period_totals;
  const comparison = dashboard.data?.comparison;
  const granularity = profitLoss.data?.period.granularity ?? "day";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Finance"
        description="Revenue, cost and cash position. Every figure here is derived from completed sales and approved expenses."
      />

      <FilterBar
        value={filters}
        onChange={setFilters}
        isLoading={dashboard.isFetching}
        actions={<ExportMenu path="/finance/export/profit-loss" filters={params} label="Export P&L" />}
      />

      {/* ── Fixed-period row: today and this month ─────────────────────────── */}
      {dashboard.isLoading ? (
        <KpiGridSkeleton count={5} columns={5} />
      ) : (
        <KpiGrid columns={5}>
          <KpiCard
            label="Today's Revenue"
            value={cards?.todayRevenue ?? 0}
            format={formatCurrency}
            icon={IndianRupee}
            accent="success"
          />
          <KpiCard
            label="Today's Expense"
            value={cards?.todayExpense ?? 0}
            format={formatCurrency}
            icon={Receipt}
            accent="warning"
          />
          <KpiCard
            label="Today's Profit"
            value={cards?.todayProfit ?? 0}
            format={formatCurrency}
            icon={TrendingUp}
            accent={(cards?.todayProfit ?? 0) >= 0 ? "success" : "danger"}
          />
          <KpiCard
            label="Monthly Revenue"
            value={cards?.monthlyRevenue ?? 0}
            format={formatCurrency}
            icon={IndianRupee}
          />
          <KpiCard
            label="Monthly Profit"
            value={cards?.monthlyProfit ?? 0}
            format={formatCurrency}
            icon={TrendingUp}
            accent={(cards?.monthlyProfit ?? 0) >= 0 ? "success" : "danger"}
          />
        </KpiGrid>
      )}

      {/* ── Position row: what the business is holding and owes ────────────── */}
      {dashboard.isLoading ? (
        <KpiGridSkeleton count={4} />
      ) : (
        <KpiGrid columns={4}>
          <KpiCard
            label="Inventory Value"
            value={cards?.inventoryValue ?? 0}
            format={formatCurrency}
            icon={Boxes}
            hint={`${formatNumber(cards?.inventoryUnits ?? 0)} units · ${formatCurrency(cards?.inventoryRetailValue ?? 0)} at retail`}
          />
          <KpiCard
            label="Cash in Drawers"
            value={cards?.cashInDrawer ?? 0}
            format={formatCurrencyExact}
            icon={Wallet}
            accent="info"
            hint="Across every open register session"
          />
          <KpiCard
            label="Owed to Suppliers"
            value={cards?.outstandingSupplierPayments ?? 0}
            format={formatCurrency}
            icon={Truck}
            accent={(cards?.outstandingSupplierPayments ?? 0) > 0 ? "warning" : "default"}
          />
          <KpiCard
            label="Outstanding Salaries"
            value={cards?.outstandingSalaries ?? 0}
            format={formatCurrency}
            icon={Users}
            accent={(cards?.outstandingSalaries ?? 0) > 0 ? "warning" : "default"}
          />
        </KpiGrid>
      )}

      {/* ── Selected period, with comparisons ──────────────────────────────── */}
      {dashboard.isLoading ? (
        <KpiGridSkeleton count={3} columns={3} />
      ) : (
        <KpiGrid columns={3}>
          <KpiCard
            label={`Revenue — ${dashboard.data?.period.label ?? ""}`}
            value={totals?.revenue ?? 0}
            format={formatCurrency}
            icon={IndianRupee}
            accent="success"
            hint={`${formatNumber(totals?.orders ?? 0)} orders`}
            {...(comparison?.revenue
              ? {
                  trend: {
                    direction: comparison.revenue.trend,
                    value: comparison.revenue.value,
                    label: "vs previous period",
                  },
                }
              : {})}
          />
          <KpiCard
            label="Expenses"
            value={totals?.expenses ?? 0}
            format={formatCurrency}
            icon={Receipt}
            accent="warning"
            hint="Approved expenses only"
            {...(comparison?.expenses
              ? {
                  trend: {
                    direction: comparison.expenses.trend,
                    value: comparison.expenses.value,
                    label: "vs previous period",
                  },
                }
              : {})}
          />
          <KpiCard
            label="Net Profit"
            value={totals?.netProfit ?? 0}
            format={formatCurrency}
            icon={TrendingUp}
            accent={(totals?.netProfit ?? 0) >= 0 ? "success" : "danger"}
            hint={`${formatPercent(totals?.netMarginPercent ?? 0)} margin`}
            {...(comparison?.profit
              ? {
                  trend: {
                    direction: comparison.profit.trend,
                    value: comparison.profit.value,
                    label: "vs previous period",
                  },
                }
              : {})}
          />
        </KpiGrid>
      )}

      {/* ── Trend & expense mix ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartShell
          title="Revenue, cost and profit"
          subtitle={profitLoss.data?.period.label}
          isLoading={profitLoss.isLoading}
          isEmpty={(profitLoss.data?.series.length ?? 0) === 0}
          height={300}
          className="lg:col-span-2"
        >
          <BiAreaChart
            data={profitLoss.data?.series ?? []}
            xKey="bucket"
            xTickFormatter={(v) => formatBucket(v, granularity)}
            series={[
              { key: "revenue", label: "Revenue" },
              { key: "cogs", label: "Cost of goods" },
              { key: "netProfit", label: "Net profit", color: "var(--bi-s3)" },
            ]}
          />
        </ChartShell>

        <ChartShell
          title="Where the money goes"
          subtitle="Approved expenses by category"
          isLoading={profitLoss.isLoading}
          isEmpty={(profitLoss.data?.expenseBreakdown.length ?? 0) === 0}
          emptyMessage="No approved expenses in this period."
          height={300}
        >
          <BiPieChart
            data={profitLoss.data?.expenseBreakdown ?? []}
            nameKey="category"
            valueKey="amount"
            variant="donut"
            centerLabel="Total expenses"
            centerValue={formatCurrency(profitLoss.data?.statement.operatingExpenses ?? 0)}
          />
        </ChartShell>
      </div>

      {/* ── P&L summary + cash flow summary ────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MetricPanel
          title="Profit & Loss"
          description={profitLoss.data?.period.label}
          isLoading={profitLoss.isLoading}
          actions={
            <Link
              to="/admin/finance/profit-loss"
              className="text-xs font-medium text-primary hover:underline"
            >
              Full statement →
            </Link>
          }
        >
          <div className="space-y-0.5">
            <StatRow
              label="Gross sales"
              value={formatCurrencyExact(profitLoss.data?.statement.grossSales ?? 0)}
            />
            <StatRow
              label="Less: refunds"
              value={formatCurrencyExact(profitLoss.data?.statement.refunds ?? 0)}
              tone="negative"
            />
            <StatRow
              label="Net sales"
              value={formatCurrencyExact(profitLoss.data?.statement.netSales ?? 0)}
              emphasis
            />
            <StatRow
              label="Less: cost of goods sold"
              value={formatCurrencyExact(profitLoss.data?.statement.cogs ?? 0)}
              tone="negative"
            />
            <StatRow
              label={`Gross profit (${formatPercent(profitLoss.data?.statement.grossMarginPercent ?? 0)})`}
              value={formatCurrencyExact(profitLoss.data?.statement.grossProfit ?? 0)}
              emphasis
            />
            <StatRow
              label="Less: operating expenses"
              value={formatCurrencyExact(profitLoss.data?.statement.operatingExpenses ?? 0)}
              tone="negative"
            />
            <StatRow
              label={`Net profit (${formatPercent(profitLoss.data?.statement.netMarginPercent ?? 0)})`}
              value={formatCurrencyExact(profitLoss.data?.statement.netProfit ?? 0)}
              emphasis
              tone={(profitLoss.data?.statement.netProfit ?? 0) >= 0 ? "positive" : "negative"}
            />
          </div>
        </MetricPanel>

        <MetricPanel
          title="Cash Flow"
          description={cashFlow.data?.period.label}
          isLoading={cashFlow.isLoading}
          actions={
            <Link
              to="/admin/finance/cash-flow"
              className="text-xs font-medium text-primary hover:underline"
            >
              Full statement →
            </Link>
          }
        >
          <div className="space-y-0.5">
            <StatRow
              label="Opening balance"
              value={formatCurrencyExact(cashFlow.data?.summary.openingBalance ?? 0)}
            />
            <StatRow
              label="Money in"
              value={formatCurrencyExact(cashFlow.data?.summary.moneyIn ?? 0)}
              tone="positive"
            />
            <StatRow
              label="Money out"
              value={formatCurrencyExact(cashFlow.data?.summary.moneyOut ?? 0)}
              tone="negative"
            />
            <StatRow
              label="Net flow"
              value={formatCurrencyExact(cashFlow.data?.summary.netFlow ?? 0)}
              emphasis
              tone={(cashFlow.data?.summary.netFlow ?? 0) >= 0 ? "positive" : "negative"}
            />
            <StatRow
              label="Closing balance"
              value={formatCurrencyExact(cashFlow.data?.summary.closingBalance ?? 0)}
              emphasis
            />
          </div>

          <Card className="mt-4 bg-muted/40 p-3">
            <CardContent className="p-0">
              <p className="text-xs text-muted-foreground">
                Cash flow is measured from the drawer ledger — every rupee that physically
                entered or left a till. It deliberately differs from profit: a supplier payment
                is cash out but not a cost, because the goods were already counted in COGS when
                they sold.
              </p>
            </CardContent>
          </Card>
        </MetricPanel>
      </div>

      {/* ── Quick links ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <QuickLink to="/admin/finance/expenses" icon={Receipt} label="Expenses" />
        <QuickLink to="/admin/finance/payables" icon={Truck} label="Supplier Payments" />
        <QuickLink to="/admin/finance/salaries" icon={Users} label="Salaries" />
        <QuickLink to="/admin/finance/revenue" icon={Banknote} label="Revenue" />
      </div>
    </div>
  );
}

function QuickLink({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: typeof Receipt;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="rounded-lg bg-muted p-1.5 text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      {label}
    </Link>
  );
}
