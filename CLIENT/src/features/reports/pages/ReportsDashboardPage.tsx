/**
 * The Business Intelligence centre — the landing screen for all reports.
 *
 * DELIBERATELY NOT THE FINANCE DASHBOARD.
 *
 * That one answers "how is the money"; this one answers "how is the business".
 * They overlap (both show revenue) but diverge fast: this page cares about
 * units, customers, returns and inventory movement, none of which belong on a
 * financial summary. Merging them would produce a screen that serves neither.
 */

import { useState } from "react";
import { Link } from "react-router";
import {
  Award,
  BarChart3,
  Boxes,
  CreditCard,
  IndianRupee,
  Layers,
  Package,
  RefreshCcw,
  ShoppingBag,
  Tag,
  TrendingUp,
  Truck,
  Users,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui";
import {
  BiAreaChart,
  BiBarChart,
  ChartShell,
  FilterBar,
  KpiCard,
  KpiGrid,
  KpiGridSkeleton,
  PageHeader,
  SectionHeader,
  cleanFilters,
  formatBucket,
  formatCurrency,
  formatNumber,
  DEFAULT_FILTERS,
  type ReportFilterState,
} from "@/components/shared/bi";

import { useReportDashboard, useSalesReport, useCategoryReport } from "../hooks/useReports";
import { GlobalSearchBar } from "../components/GlobalSearchBar";

/**
 * Every report is still one click from here — that is this page's whole job,
 * and it is why consolidating the sidebar costs nothing in reach.
 *
 * These point straight at the owning tab rather than the pre-consolidation
 * paths. Those old paths still redirect here correctly, but linking through a
 * redirect would cost an extra navigation on every click.
 */
const REPORT_LINKS = [
  { to: "/admin/reports/sales?tab=sales", label: "Sales", icon: ShoppingBag, hint: "Gross, net, AOV, trend" },
  { to: "/admin/reports/inventory?tab=products", label: "Products", icon: Package, hint: "Best and worst sellers" },
  { to: "/admin/reports/inventory?tab=categories", label: "Categories", icon: Tag, hint: "Revenue and margin by category" },
  { to: "/admin/reports/inventory?tab=brands", label: "Brands", icon: Award, hint: "Revenue, margin and stock held" },
  { to: "/admin/reports/customers", label: "Customers", icon: Users, hint: "New, returning, lifetime value" },
  { to: "/admin/reports/employees", label: "Employees", icon: Users, hint: "Leaderboard and discounting" },
  { to: "/admin/reports/inventory?tab=stock", label: "Inventory", icon: Boxes, hint: "Stock health and valuation" },
  { to: "/admin/reports/inventory?tab=purchases", label: "Purchases", icon: Truck, hint: "Cost, suppliers, pending" },
  { to: "/admin/reports/sales?tab=payments", label: "Payments", icon: CreditCard, hint: "Tender mix and trend" },
  { to: "/admin/reports/sales?tab=returns", label: "Returns & Exchanges", icon: RefreshCcw, hint: "Reasons and repeat offenders" },
  { to: "/admin/reports/finance?tab=profit", label: "Profit", icon: TrendingUp, hint: "Revenue, COGS, expenses, margin" },
];

export default function ReportsDashboardPage() {
  const [filters, setFilters] = useState<ReportFilterState>(DEFAULT_FILTERS);
  const params = cleanFilters(filters);

  const dashboard = useReportDashboard(params);
  const sales = useSalesReport(params);
  const categories = useCategoryReport(params);

  const cards = dashboard.data?.cards;
  const comparison = dashboard.data?.comparison;
  const granularity = sales.data?.period?.granularity ?? "day";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description="The business intelligence centre. Every report shares one filter set and exports to CSV, Excel or print."
        actions={<GlobalSearchBar />}
      />

      <FilterBar
        value={filters}
        onChange={setFilters}
        isLoading={dashboard.isFetching}
      />

      {/* ── Headline ───────────────────────────────────────────────────────── */}
      {dashboard.isLoading ? (
        <KpiGridSkeleton count={5} columns={5} />
      ) : (
        <KpiGrid columns={5}>
          <KpiCard
            label="Today's Sales"
            value={cards?.todaySales ?? 0}
            format={formatCurrency}
            icon={IndianRupee}
            accent="success"
            hint={`${formatNumber(cards?.todayOrders ?? 0)} orders`}
          />
          <KpiCard
            label="Monthly Sales"
            value={cards?.monthlySales ?? 0}
            format={formatCurrency}
            icon={BarChart3}
            hint={`${formatNumber(cards?.monthlyOrders ?? 0)} orders`}
          />
          <KpiCard
            label="Revenue"
            value={cards?.revenue ?? 0}
            format={formatCurrency}
            icon={IndianRupee}
            accent="info"
            {...(comparison?.revenue
              ? {
                  trend: {
                    direction: comparison.revenue.trend,
                    value: comparison.revenue.value,
                    label: "vs previous",
                  },
                }
              : {})}
          />
          <KpiCard
            label="Gross Profit"
            value={cards?.grossProfit ?? 0}
            format={formatCurrency}
            icon={TrendingUp}
            accent={(cards?.grossProfit ?? 0) >= 0 ? "success" : "danger"}
            {...(comparison?.profit
              ? {
                  trend: {
                    direction: comparison.profit.trend,
                    value: comparison.profit.value,
                    label: "vs previous",
                  },
                }
              : {})}
          />
          <KpiCard
            label="Orders"
            value={cards?.orders ?? 0}
            format={formatNumber}
            icon={ShoppingBag}
            hint={`${formatNumber(cards?.unitsSold ?? 0)} units sold`}
            {...(comparison?.orders
              ? {
                  trend: {
                    direction: comparison.orders.trend,
                    value: comparison.orders.value,
                    label: "vs previous",
                  },
                }
              : {})}
          />
        </KpiGrid>
      )}

      {dashboard.isLoading ? (
        <KpiGridSkeleton count={4} />
      ) : (
        <KpiGrid columns={4}>
          <KpiCard
            label="Returns"
            value={cards?.returns ?? 0}
            format={formatNumber}
            icon={RefreshCcw}
            accent={(cards?.returns ?? 0) > 0 ? "warning" : "default"}
            hint={`${formatCurrency(cards?.returnValue ?? 0)} of goods came back`}
            {...(comparison?.returns
              ? {
                  trend: {
                    direction: comparison.returns.trend,
                    value: comparison.returns.value,
                    label: "vs previous",
                  },
                }
              : {})}
          />
          <KpiCard
            label="Exchanges"
            value={cards?.exchanges ?? 0}
            format={formatNumber}
            icon={Layers}
          />
          <KpiCard
            label="Inventory Value"
            value={cards?.inventoryValue ?? 0}
            format={formatCurrency}
            icon={Boxes}
            hint={`${formatNumber(cards?.inventoryUnits ?? 0)} units at cost`}
          />
          <KpiCard
            label="Customers"
            value={cards?.customers ?? 0}
            format={formatNumber}
            icon={Users}
            hint={`${formatNumber(cards?.newCustomers ?? 0)} new · ${formatNumber(cards?.returningCustomers ?? 0)} returning`}
          />
        </KpiGrid>
      )}

      {/* ── Trend & category mix ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartShell
          title="Sales trend"
          subtitle={sales.data?.period?.label}
          isLoading={sales.isLoading}
          isEmpty={(sales.data?.series?.length ?? 0) === 0}
          height={300}
          className="lg:col-span-2"
        >
          <BiAreaChart
            data={sales.data?.series ?? []}
            xKey="bucket"
            xTickFormatter={(v) => formatBucket(v, granularity)}
            series={[{ key: "revenue", label: "Revenue" }]}
          />
        </ChartShell>

        <ChartShell
          title="Revenue by category"
          subtitle="Largest first"
          isLoading={categories.isLoading}
          isEmpty={(categories.data?.data?.length ?? 0) === 0}
          height={300}
        >
          <BiBarChart
            data={(categories.data?.data ?? []).slice(0, 8)}
            xKey="categoryName"
            layout="horizontal"
            series={[{ key: "revenue", label: "Revenue" }]}
          />
        </ChartShell>
      </div>

      {/* ── Report index ───────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="py-4">
          <SectionHeader
            title="All reports"
            description="Every report supports the same filters and exports"
            className="mb-3"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {REPORT_LINKS.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="mt-0.5 rounded-md bg-muted p-1.5 text-muted-foreground">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{link.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {link.hint}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
