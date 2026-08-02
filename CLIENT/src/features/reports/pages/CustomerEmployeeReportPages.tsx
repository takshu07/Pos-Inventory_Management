/**
 * Customer and Employee reports.
 *
 * BOTH ANSWER "WHO", SO THEY SHARE THE SAME SHAPE — but they diverge on the
 * one thing that matters:
 *
 *   • The CUSTOMER report leads with SEGMENTS (new / returning / inactive),
 *     because the actionable question is "who has stopped coming".
 *   • The EMPLOYEE report leads with a LEADERBOARD, because the actionable
 *     question is "who is selling and who is discounting to do it".
 *
 * Discount rate is on the employee report deliberately. Revenue alone rewards
 * whoever gives the deepest discounts; showing both together is what makes the
 * leaderboard honest.
 */

import { useState } from "react";
import {
  Award,
  Percent,
  RefreshCcw,
  ShoppingBag,
  TrendingUp,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";

import { Badge, Card, CardContent } from "@/components/ui";
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
  formatDate,
  formatNumber,
  formatPercent,
  formatSignedPercent,
  DEFAULT_FILTERS,
  type ReportColumn,
  type ReportFilterState,
} from "@/components/shared/bi";
import { cn } from "@/utils/cn";

import { ReportShell } from "../components/ReportShell";
import { useCustomerReport, useEmployeeReport } from "../hooks/useReports";

// =============================================================================
// CUSTOMER REPORT
// =============================================================================

type CustomerRow = {
  customerId: string;
  name: string;
  phone: string;
  customerCode: string;
  isWalkIn: boolean;
  orderCount: number;
  periodSpend: number;
  lifetimeSpend: number;
  averageOrderValue: number;
  firstPurchase: string | null;
  lastPurchase: string | null;
  daysSinceLastPurchase: number | null;
  tenureDays: number | null;
  visitsPerMonth: number;
  rewardPoints: number;
  storeCredit: number;
  segment: "NEW" | "RETURNING";
}

export function CustomerReportPage() {
  const [filters, setFilters] = useState<ReportFilterState>(DEFAULT_FILTERS);
  const [table, setTable] = useState<{
    page: number;
    limit: number;
    sortBy: "spend" | "orders" | "recent";
    sortOrder: "asc" | "desc";
    inactiveDays: number;
  }>({ page: 1, limit: 25, sortBy: "spend", sortOrder: "desc", inactiveDays: 90 });

  const params = { ...cleanFilters(filters), ...table };
  const { data, isLoading, isError, error } = useCustomerReport(params);

  const rows = (data?.data ?? []) as CustomerRow[];
  const segments = data?.segments as
    | {
        newCustomers: number;
        returningCustomers: number;
        inactiveCustomers: number;
        totalCustomers: number;
        inactiveDays: number;
      }
    | undefined;

  const columns: Array<ReportColumn<CustomerRow>> = [
    {
      key: "name",
      header: "Customer",
      locked: true,
      width: 200,
      render: (row) => (
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate font-medium">
            {row.name}
            {row.isWalkIn && <Badge variant="outline">Walk-in</Badge>}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {row.customerCode} · {row.phone}
          </p>
        </div>
      ),
    },
    {
      key: "segment",
      header: "Segment",
      width: 110,
      render: (row) => (
        <Badge variant={row.segment === "NEW" ? "success" : "info"}>
          {row.segment === "NEW" ? "New" : "Returning"}
        </Badge>
      ),
    },
    {
      key: "orderCount",
      header: "Orders",
      sortKey: "orders",
      align: "right",
      render: (row) => formatNumber(row.orderCount),
    },
    {
      key: "periodSpend",
      header: "Period Spend",
      sortKey: "spend",
      align: "right",
      render: (row) => formatCurrencyExact(row.periodSpend),
    },
    {
      key: "lifetimeSpend",
      header: "Lifetime Spend",
      align: "right",
      render: (row) => (
        <span className="font-medium">{formatCurrencyExact(row.lifetimeSpend)}</span>
      ),
    },
    {
      key: "averageOrderValue",
      header: "Avg Order",
      align: "right",
      render: (row) => formatCurrencyExact(row.averageOrderValue),
    },
    {
      key: "visitsPerMonth",
      header: "Visits / Month",
      align: "right",
      width: 120,
      render: (row) => row.visitsPerMonth.toFixed(2),
    },
    {
      key: "lastPurchase",
      header: "Last Purchase",
      sortKey: "recent",
      width: 150,
      render: (row) => (
        <div>
          <p className="text-xs">{formatDate(row.lastPurchase)}</p>
          {row.daysSinceLastPurchase !== null && (
            <p
              className={cn(
                "text-xs",
                row.daysSinceLastPurchase > (segments?.inactiveDays ?? 90)
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground"
              )}
            >
              {row.daysSinceLastPurchase}d ago
            </p>
          )}
        </div>
      ),
    },
    {
      key: "firstPurchase",
      header: "First Purchase",
      defaultHidden: true,
      render: (row) => formatDate(row.firstPurchase),
    },
    {
      key: "rewardPoints",
      header: "Points",
      align: "right",
      defaultHidden: true,
      render: (row) => formatNumber(row.rewardPoints),
    },
    {
      key: "storeCredit",
      header: "Store Credit",
      align: "right",
      defaultHidden: true,
      render: (row) => formatCurrencyExact(row.storeCredit),
    },
  ];

  const segmentChart = [
    { label: "New", value: segments?.newCustomers ?? 0 },
    { label: "Returning", value: segments?.returningCustomers ?? 0 },
    { label: "Inactive", value: segments?.inactiveCustomers ?? 0 },
  ];

  return (
    <ReportShell
      title="Customer Report"
      description="Who is buying, how often, and who has stopped. New vs returning is measured against a customer's first-ever purchase, not against the selected period."
      reportKey="customers"
      filters={filters}
      onFiltersChange={setFilters}
      show={["employee", "category", "brand", "paymentMethod"]}
      exportExtras={{ sortBy: table.sortBy, sortOrder: table.sortOrder, inactiveDays: table.inactiveDays }}
      isLoading={isLoading}
      isError={isError}
      error={error}
    >
      <KpiGrid columns={4}>
        <KpiCard
          label="New Customers"
          value={segments?.newCustomers ?? 0}
          format={formatNumber}
          icon={UserPlus}
          accent="success"
          hint="First-ever purchase fell in this period"
        />
        <KpiCard
          label="Returning"
          value={segments?.returningCustomers ?? 0}
          format={formatNumber}
          icon={Users}
          accent="info"
          hint="Bought before this period and again in it"
        />
        <KpiCard
          label="Inactive"
          value={segments?.inactiveCustomers ?? 0}
          format={formatNumber}
          icon={UserMinus}
          accent={(segments?.inactiveCustomers ?? 0) > 0 ? "warning" : "default"}
          hint={`No purchase in ${segments?.inactiveDays ?? 90} days`}
        />
        <KpiCard
          label="Total Customers"
          value={segments?.totalCustomers ?? 0}
          format={formatNumber}
          icon={Users}
          hint="Everyone who has ever bought"
        />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartShell
          title="Top customers by lifetime value"
          subtitle="On the current page"
          isLoading={isLoading}
          isEmpty={rows.length === 0}
          height={320}
          className="lg:col-span-2"
        >
          <BiBarChart
            data={rows.slice(0, 10)}
            xKey="name"
            layout="horizontal"
            series={[{ key: "lifetimeSpend", label: "Lifetime spend" }]}
          />
        </ChartShell>

        <ChartShell
          title="Customer mix"
          isLoading={isLoading}
          isEmpty={segmentChart.every((s) => s.value === 0)}
          height={320}
        >
          <BiPieChart
            data={segmentChart}
            nameKey="label"
            valueKey="value"
            variant="donut"
            valueFormat="number"
            centerLabel="Customers"
            centerValue={formatNumber(segments?.totalCustomers ?? 0)}
          />
        </ChartShell>
      </div>

      <ReportTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.customerId}
        isLoading={isLoading}
        storageKey="report-customers"
        total={data?.total}
        page={table.page}
        totalPages={data?.totalPages ?? 1}
        onPageChange={(page) => setTable((prev) => ({ ...prev, page }))}
        sortBy={table.sortBy}
        sortOrder={table.sortOrder}
        onSortChange={(sortBy, sortOrder) =>
          setTable((prev) => ({
            ...prev,
            sortBy: sortBy as typeof prev.sortBy,
            sortOrder,
            page: 1,
          }))
        }
        emptyTitle="No customers"
        emptyMessage="Nobody bought anything in this period matching the filters."
      />
    </ReportShell>
  );
}

// =============================================================================
// EMPLOYEE REPORT
// =============================================================================

type EmployeeRow = {
  rank: number;
  employeeId: string;
  name: string;
  employeeCode: string;
  role: string;
  orders: number;
  revenue: number;
  averageBill: number;
  unitsSold: number;
  discountsGiven: number;
  discountRatePercent: number;
  exchanges: number;
  exchangeValue: number;
  refundValue: number;
  share: number;
  previousRevenue: number;
  growth: number;
  trend: "up" | "down" | "flat";
}

export function EmployeeReportPage() {
  const [filters, setFilters] = useState<ReportFilterState>(DEFAULT_FILTERS);
  const params = cleanFilters(filters);
  const { data, isLoading, isError, error } = useEmployeeReport(params);

  const rows = (data?.data ?? []) as EmployeeRow[];
  const leaderboard = (data?.leaderboard ?? []) as EmployeeRow[];
  const summary = data?.summary as
    | {
        employees: number;
        activeSellers: number;
        revenue: number;
        orders: number;
        discountsGiven: number;
      }
    | undefined;

  const columns: Array<ReportColumn<EmployeeRow>> = [
    {
      key: "rank",
      header: "#",
      locked: true,
      width: 56,
      align: "right",
      render: (row) => (
        <span
          className={cn(
            "font-semibold tabular-nums",
            row.rank <= 3 && row.revenue > 0 && "text-amber-600 dark:text-amber-400"
          )}
        >
          {row.rank}
        </span>
      ),
    },
    {
      key: "name",
      header: "Employee",
      width: 190,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.employeeCode} · {row.role}
          </p>
        </div>
      ),
    },
    {
      key: "orders",
      header: "Orders",
      align: "right",
      render: (row) => formatNumber(row.orders),
      footer: formatNumber(summary?.orders ?? 0),
    },
    {
      key: "revenue",
      header: "Revenue",
      align: "right",
      render: (row) => formatCurrencyExact(row.revenue),
      footer: formatCurrencyExact(summary?.revenue ?? 0),
    },
    {
      key: "averageBill",
      header: "Avg Bill",
      align: "right",
      render: (row) => formatCurrencyExact(row.averageBill),
    },
    {
      key: "unitsSold",
      header: "Units",
      align: "right",
      defaultHidden: true,
      render: (row) => formatNumber(row.unitsSold),
    },
    {
      key: "discountsGiven",
      header: "Discounts",
      align: "right",
      render: (row) => (
        <span className={cn(row.discountRatePercent > 15 && "text-amber-600 dark:text-amber-400")}>
          {formatCurrencyExact(row.discountsGiven)}
        </span>
      ),
      footer: formatCurrencyExact(summary?.discountsGiven ?? 0),
    },
    {
      key: "discountRatePercent",
      header: "Discount %",
      align: "right",
      width: 110,
      render: (row) => (
        <span
          className={cn(
            row.discountRatePercent > 20
              ? "text-red-600 dark:text-red-400"
              : row.discountRatePercent > 10
                ? "text-amber-600 dark:text-amber-400"
                : ""
          )}
        >
          {formatPercent(row.discountRatePercent)}
        </span>
      ),
    },
    {
      key: "exchanges",
      header: "Exchanges",
      align: "right",
      defaultHidden: true,
      render: (row) => formatNumber(row.exchanges),
    },
    {
      key: "refundValue",
      header: "Refunds",
      align: "right",
      defaultHidden: true,
      render: (row) => formatCurrencyExact(row.refundValue),
    },
    {
      key: "share",
      header: "Share",
      align: "right",
      width: 90,
      render: (row) => formatPercent(row.share),
    },
    {
      key: "growth",
      header: "Growth",
      align: "right",
      width: 100,
      render: (row) => (
        <span
          className={cn(
            "font-medium",
            row.trend === "up" && "text-emerald-600 dark:text-emerald-400",
            row.trend === "down" && "text-red-600 dark:text-red-400",
            row.trend === "flat" && "text-muted-foreground"
          )}
        >
          {formatSignedPercent(row.growth)}
        </span>
      ),
    },
  ];

  return (
    <ReportShell
      title="Employee Report"
      description="Sales performance by employee. Discount rate sits alongside revenue deliberately — revenue alone rewards whoever discounts hardest."
      reportKey="employees"
      filters={filters}
      onFiltersChange={setFilters}
      show={["employee", "category", "brand", "paymentMethod"]}
      isLoading={isLoading}
      isError={isError}
      error={error}
    >
      <KpiGrid columns={4}>
        <KpiCard
          label="Active Sellers"
          value={summary?.activeSellers ?? 0}
          format={formatNumber}
          icon={Users}
          hint={`of ${formatNumber(summary?.employees ?? 0)} active employees`}
        />
        <KpiCard
          label="Revenue"
          value={summary?.revenue ?? 0}
          format={formatCurrency}
          icon={TrendingUp}
          accent="success"
        />
        <KpiCard
          label="Orders"
          value={summary?.orders ?? 0}
          format={formatNumber}
          icon={ShoppingBag}
        />
        <KpiCard
          label="Discounts Given"
          value={summary?.discountsGiven ?? 0}
          format={formatCurrency}
          icon={Percent}
          accent={(summary?.discountsGiven ?? 0) > 0 ? "warning" : "default"}
        />
      </KpiGrid>

      {/* ── Leaderboard ────────────────────────────────────────────────────── */}
      {leaderboard.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="mb-3 flex items-center gap-1.5">
              <Award className="h-4 w-4 text-amber-600" aria-hidden />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Leaderboard
              </h2>
            </div>
            <ol className="space-y-1.5">
              {leaderboard.slice(0, 5).map((row) => (
                <li key={row.employeeId} className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      row.rank === 1
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {row.rank}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.name}</span>
                  <span className="h-2 w-24 overflow-hidden rounded-full bg-muted sm:w-40">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${Math.min(100, row.share)}%` }}
                    />
                  </span>
                  <span className="w-24 shrink-0 text-right text-sm font-medium tabular-nums">
                    {formatCurrency(row.revenue)}
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartShell
          title="Revenue by employee"
          isLoading={isLoading}
          isEmpty={rows.length === 0}
          height={320}
        >
          <BiBarChart
            data={rows.slice(0, 10)}
            xKey="name"
            layout="horizontal"
            series={[{ key: "revenue", label: "Revenue" }]}
          />
        </ChartShell>

        <ChartShell
          title="Revenue against discounting"
          subtitle="A tall revenue bar with a tall discount bar is volume bought, not sold"
          isLoading={isLoading}
          isEmpty={rows.length === 0}
          height={320}
        >
          <BiBarChart
            data={rows.slice(0, 8)}
            xKey="name"
            series={[
              { key: "revenue", label: "Revenue" },
              { key: "discountsGiven", label: "Discounts", color: "var(--bi-s2)" },
            ]}
          />
        </ChartShell>
      </div>

      <ReportTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.employeeId}
        isLoading={isLoading}
        storageKey="report-employees"
        showFooter
        emptyTitle="No employee sales"
        emptyMessage="Nobody made a sale in this period matching the filters."
      />

      <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <RefreshCcw className="h-3 w-3" aria-hidden />
        Exchanges and refunds are attributed to whoever processed them, not to whoever made the
        original sale.
      </p>
    </ReportShell>
  );
}
