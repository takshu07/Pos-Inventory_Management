/**
 * Payment analytics — how customers actually pay.
 *
 * SPLIT PAYMENTS ARE COUNTED SEPARATELY, NOT AS A SIXTH METHOD.
 *
 * A bill settled with ₹500 cash and ₹700 card contributes to BOTH the cash and
 * card columns; it is not a "split" tender. Listing "Split" alongside Cash and
 * UPI would double-count the value. So it appears as its own metric — a
 * property of the BILL, not of any payment on it.
 */

import { useState } from "react";
import { CreditCard, IndianRupee, Layers, Smartphone } from "lucide-react";

import { Card, CardContent } from "@/components/ui";
import {
  BiBarChart,
  BiPieChart,
  ChartShell,
  ExportMenu,
  FilterBar,
  KpiCard,
  KpiGrid,
  PageHeader,
  PAYMENT_METHOD_LABELS,
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

import { usePaymentAnalytics } from "../hooks/useFinance";
import type { PaymentAnalytics } from "../types";

type MethodRow = PaymentAnalytics["methods"][number];

export default function PaymentAnalyticsPage() {
  const [filters, setFilters] = useState<ReportFilterState>(DEFAULT_FILTERS);
  const params = cleanFilters(filters);

  const { data, isLoading, isFetching } = usePaymentAnalytics(params);

  const byMethod = (method: string) => data?.methods.find((m) => m.method === method);

  const columns: Array<ReportColumn<MethodRow>> = [
    {
      key: "method",
      header: "Method",
      locked: true,
      width: 140,
      render: (row) => (
        <span className="font-medium">{PAYMENT_METHOD_LABELS[row.method] ?? row.method}</span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (row) => formatCurrencyExact(row.amount),
      footer: formatCurrencyExact(data?.total ?? 0),
    },
    {
      key: "percentage",
      header: "Share",
      align: "right",
      width: 110,
      render: (row) => (
        <span className="inline-flex items-center gap-2">
          {/* An inline bar makes share readable without a second chart. */}
          <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${Math.min(100, row.percentage)}%` }}
            />
          </span>
          {formatPercent(row.percentage)}
        </span>
      ),
    },
    {
      key: "count",
      header: "Transactions",
      align: "right",
      render: (row) => formatNumber(row.count),
      footer: formatNumber(data?.transactionCount ?? 0),
    },
    {
      key: "averageTicket",
      header: "Avg Ticket",
      align: "right",
      render: (row) => formatCurrencyExact(row.averageTicket),
    },
    {
      key: "previousAmount",
      header: "Previous",
      align: "right",
      defaultHidden: true,
      render: (row) => formatCurrencyExact(row.previousAmount),
    },
    {
      key: "growth",
      header: "Growth",
      align: "right",
      width: 110,
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
    <div className="space-y-5">
      <PageHeader
        title="Payment Analytics"
        description="Tender mix, average ticket by method, and how the mix is shifting."
        actions={<ExportMenu path="/reports/export/payments" filters={params} />}
      />

      <FilterBar
        value={filters}
        onChange={setFilters}
        show={["employee"]}
        isLoading={isFetching}
      />

      <KpiGrid columns={4}>
        <KpiCard
          label="Cash"
          value={byMethod("CASH")?.amount ?? 0}
          format={formatCurrency}
          icon={IndianRupee}
          accent="success"
          hint={`${formatPercent(byMethod("CASH")?.percentage ?? 0)} of collections`}
          {...(byMethod("CASH")
            ? {
                trend: {
                  direction: byMethod("CASH")!.trend,
                  value: byMethod("CASH")!.growth,
                },
              }
            : {})}
        />
        <KpiCard
          label="UPI"
          value={byMethod("UPI")?.amount ?? 0}
          format={formatCurrency}
          icon={Smartphone}
          accent="info"
          hint={`${formatPercent(byMethod("UPI")?.percentage ?? 0)} of collections`}
          {...(byMethod("UPI")
            ? { trend: { direction: byMethod("UPI")!.trend, value: byMethod("UPI")!.growth } }
            : {})}
        />
        <KpiCard
          label="Card"
          value={byMethod("CARD")?.amount ?? 0}
          format={formatCurrency}
          icon={CreditCard}
          hint={`${formatPercent(byMethod("CARD")?.percentage ?? 0)} of collections`}
          {...(byMethod("CARD")
            ? { trend: { direction: byMethod("CARD")!.trend, value: byMethod("CARD")!.growth } }
            : {})}
        />
        <KpiCard
          label="Split Bills"
          value={data?.splitPaymentCount ?? 0}
          format={formatNumber}
          icon={Layers}
          accent="warning"
          hint={`${formatPercent(data?.splitPaymentPercentage ?? 0)} of ${formatNumber(data?.orderCount ?? 0)} bills`}
        />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartShell
          title="Tender mix"
          subtitle={`${data?.period.label ?? ""} · share of ${formatCurrency(data?.total ?? 0)} collected`}
          isLoading={isLoading}
          isEmpty={(data?.methods.length ?? 0) === 0}
          height={300}
        >
          <BiPieChart
            data={(data?.methods ?? []).map((m) => ({
              ...m,
              label: PAYMENT_METHOD_LABELS[m.method] ?? m.method,
            }))}
            nameKey="label"
            valueKey="amount"
            variant="donut"
            centerLabel="Collected"
            centerValue={formatCurrency(data?.total ?? 0)}
          />
        </ChartShell>

        <ChartShell
          title="Average ticket by method"
          subtitle="What a typical bill looks like on each tender"
          isLoading={isLoading}
          isEmpty={(data?.methods.length ?? 0) === 0}
          height={300}
        >
          <BiBarChart
            data={(data?.methods ?? []).map((m) => ({
              ...m,
              label: PAYMENT_METHOD_LABELS[m.method] ?? m.method,
            }))}
            xKey="label"
            layout="horizontal"
            series={[{ key: "averageTicket", label: "Average ticket", color: "var(--bi-s4)" }]}
          />
        </ChartShell>
      </div>

      <ReportTable
        columns={columns}
        rows={data?.methods ?? []}
        rowKey={(row) => row.method}
        isLoading={isLoading}
        storageKey="finance-payment-methods"
        showFooter
        emptyTitle="No payments"
        emptyMessage="No payments were collected in this period."
      />

      <Card className="bg-muted/40">
        <CardContent className="py-3">
          <p className="text-xs text-muted-foreground">
            A bill settled with two tenders contributes to <strong>both</strong> method rows —
            that is why the transaction count can exceed the bill count. "Split bills" counts
            those bills once, as a property of the bill rather than of any payment on it.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
