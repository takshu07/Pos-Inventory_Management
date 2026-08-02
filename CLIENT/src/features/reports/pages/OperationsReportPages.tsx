/**
 * Inventory, Purchase, Payment and Return/Exchange reports.
 *
 * FOUR OPERATIONAL REPORTS IN ONE FILE.
 *
 * They share the ReportShell, the same filter vocabulary and the same table
 * conventions; what differs is which aggregate each renders. Keeping them
 * together makes it obvious when one starts diverging from the house style —
 * which is exactly what happens when each lives alone in its own file.
 */

import { useState } from "react";
import {
  AlertTriangle,
  Boxes,
  CreditCard,
  Layers,
  Package,
  PackageX,
  RefreshCcw,
  Snowflake,
  Truck,
  Wallet,
} from "lucide-react";

import { Badge, Card, CardContent, Select } from "@/components/ui";
import {
  BiAreaChart,
  BiBarChart,
  BiPieChart,
  ChartShell,
  KpiCard,
  KpiGrid,
  MetricPanel,
  ReportTable,

  cleanFilters,
  formatBucket,
  formatCurrency,
  formatCurrencyExact,
  formatDate,
  formatNumber,
  formatPercent,
  humanise,
  PAYMENT_METHOD_LABELS,
  DEFAULT_FILTERS,
  type ReportColumn,
  type ReportFilterState,
} from "@/components/shared/bi";
import { cn } from "@/utils/cn";

import { ReportShell } from "../components/ReportShell";
import {
  useInventoryReport,
  usePaymentReport,
  usePurchaseReport,
  useReturnReport,
} from "../hooks/useReports";

// =============================================================================
// INVENTORY REPORT
// =============================================================================

type InventoryRow = {
  variantId: string;
  productName: string;
  sku: string;
  variantLabel: string;
  categoryName: string | null;
  brandName: string | null;
  supplierName: string | null;
  currentStock: number;
  reorderLevel: number | null;
  costPrice: number;
  sellingPrice: number;
  stockValue: number;
  retailValue: number;
  unitsSold: number;
  dailyVelocity: number;
  daysOfCover: number | null;
  lastMovementAt: string | null;
  isLowStock: boolean;
  isOutOfStock: boolean;
  isOverstocked: boolean;
  isDeadStock: boolean;
}

const BUCKET_OPTIONS = [
  { value: "ALL", label: "All stock" },
  { value: "LOW", label: "Low stock" },
  { value: "OUT", label: "Out of stock" },
  { value: "OVERSTOCK", label: "Overstocked" },
  { value: "DEAD", label: "Dead stock" },
  { value: "FAST", label: "Fast moving" },
  { value: "SLOW", label: "Slow moving" },
];

const GROUP_OPTIONS = [
  { value: "category", label: "By category" },
  { value: "brand", label: "By brand" },
  { value: "supplier", label: "By supplier" },
];

export function InventoryReportPage() {
  const [filters, setFilters] = useState<ReportFilterState>(DEFAULT_FILTERS);
  const [table, setTable] = useState({
    page: 1,
    limit: 25,
    bucket: "ALL",
    velocityDays: 30,
    groupBy: "category",
  });

  const params = { ...cleanFilters(filters), ...table };
  const { data, isLoading, isError, error } = useInventoryReport(params);

  const rows = (data?.data ?? []) as InventoryRow[];
  const valuation = data?.valuation as
    | {
        groupBy: string;
        rows: Array<{
          groupId: string | null;
          groupName: string;
          variantCount: number;
          units: number;
          costValue: number;
          retailValue: number;
          potentialProfit: number;
        }>;
        totals: { units: number; costValue: number; retailValue: number; potentialProfit: number };
      }
    | undefined;
  const movements = (data?.movements ?? []) as Array<{
    type: string;
    movements: number;
    unitsIn: number;
    unitsOut: number;
  }>;

  const columns: Array<ReportColumn<InventoryRow>> = [
    {
      key: "product",
      header: "Product",
      locked: true,
      width: 230,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.productName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.sku} · {row.variantLabel}
          </p>
        </div>
      ),
    },
    {
      key: "state",
      header: "State",
      width: 130,
      render: (row) =>
        row.isOutOfStock ? (
          <Badge variant="destructive">Out of stock</Badge>
        ) : row.isLowStock ? (
          <Badge variant="warning">Low stock</Badge>
        ) : row.isOverstocked ? (
          <Badge variant="info">Overstocked</Badge>
        ) : row.isDeadStock ? (
          <Badge variant="secondary">Dead stock</Badge>
        ) : (
          <Badge variant="success">Healthy</Badge>
        ),
    },
    {
      key: "categoryName",
      header: "Category",
      width: 130,
      defaultHidden: true,
      render: (row) => row.categoryName ?? "—",
    },
    {
      key: "brandName",
      header: "Brand",
      width: 120,
      defaultHidden: true,
      render: (row) => row.brandName ?? "—",
    },
    {
      key: "supplierName",
      header: "Supplier",
      width: 140,
      defaultHidden: true,
      render: (row) => row.supplierName ?? "—",
    },
    {
      key: "currentStock",
      header: "Stock",
      align: "right",
      width: 90,
      render: (row) => (
        <span className={cn(row.currentStock <= 0 && "text-red-600 dark:text-red-400")}>
          {formatNumber(row.currentStock)}
        </span>
      ),
    },
    {
      key: "reorderLevel",
      header: "Reorder At",
      align: "right",
      defaultHidden: true,
      render: (row) => (row.reorderLevel === null ? "—" : formatNumber(row.reorderLevel)),
    },
    {
      key: "unitsSold",
      header: `Sold (${table.velocityDays}d)`,
      align: "right",
      width: 110,
      render: (row) => formatNumber(row.unitsSold),
    },
    {
      key: "dailyVelocity",
      header: "Per Day",
      align: "right",
      width: 90,
      render: (row) => row.dailyVelocity.toFixed(2),
    },
    {
      key: "daysOfCover",
      header: "Days Cover",
      align: "right",
      width: 110,
      render: (row) =>
        row.daysOfCover === null ? (
          <span className="text-muted-foreground">Not selling</span>
        ) : (
          <span className={cn(row.daysOfCover < 7 && "text-amber-600 dark:text-amber-400")}>
            {row.daysOfCover.toFixed(0)}d
          </span>
        ),
    },
    {
      key: "stockValue",
      header: "Stock Value",
      align: "right",
      render: (row) => formatCurrencyExact(row.stockValue),
    },
    {
      key: "retailValue",
      header: "Retail Value",
      align: "right",
      defaultHidden: true,
      render: (row) => formatCurrencyExact(row.retailValue),
    },
    {
      key: "lastMovementAt",
      header: "Last Movement",
      defaultHidden: true,
      render: (row) => formatDate(row.lastMovementAt),
    },
  ];

  return (
    <ReportShell
      title="Inventory Report"
      description="Stock health and valuation. Velocity is measured over a rolling window, NOT over the selected period — 'is this dead stock' is a question about recent movement."
      reportKey="inventory"
      filters={filters}
      onFiltersChange={setFilters}
      show={["category", "brand", "supplier", "sku"]}
      exportExtras={table}
      isLoading={isLoading}
      isError={isError}
      error={error}
      filterExtras={
        <>
          <div className="w-40">
            <Select
              options={BUCKET_OPTIONS}
              value={table.bucket}
              onChange={(e) => setTable((p) => ({ ...p, bucket: e.target.value, page: 1 }))}
              aria-label="Stock bucket"
            />
          </div>
          <div className="w-36">
            <Select
              options={GROUP_OPTIONS}
              value={table.groupBy}
              onChange={(e) => setTable((p) => ({ ...p, groupBy: e.target.value }))}
              aria-label="Valuation grouping"
            />
          </div>
        </>
      }
    >
      <KpiGrid columns={4}>
        <KpiCard
          label="Inventory at Cost"
          value={valuation?.totals.costValue ?? 0}
          format={formatCurrency}
          icon={Boxes}
          hint={`${formatNumber(valuation?.totals.units ?? 0)} units`}
        />
        <KpiCard
          label="Retail Value"
          value={valuation?.totals.retailValue ?? 0}
          format={formatCurrency}
          icon={Wallet}
          accent="info"
        />
        <KpiCard
          label="Potential Profit"
          value={valuation?.totals.potentialProfit ?? 0}
          format={formatCurrency}
          icon={Package}
          accent="success"
          hint="If everything on hand sold at its current price"
        />
        <KpiCard
          label="Variants Shown"
          value={data?.total ?? 0}
          format={formatNumber}
          icon={table.bucket === "OUT" ? PackageX : table.bucket === "DEAD" ? Snowflake : Boxes}
          hint={BUCKET_OPTIONS.find((b) => b.value === table.bucket)?.label}
        />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartShell
          title={`Valuation ${GROUP_OPTIONS.find((g) => g.value === table.groupBy)?.label.toLowerCase() ?? ""}`}
          subtitle="Cost against retail — the gap is unrealised margin"
          isLoading={isLoading}
          isEmpty={(valuation?.rows.length ?? 0) === 0}
          height={320}
        >
          <BiBarChart
            data={(valuation?.rows ?? []).slice(0, 10)}
            xKey="groupName"
            layout="horizontal"
            series={[
              { key: "costValue", label: "At cost" },
              { key: "retailValue", label: "At retail", color: "var(--bi-s3)" },
            ]}
          />
        </ChartShell>

        <MetricPanel
          title="Stock movement"
          description="Units in and out, by movement type, in the selected period"
          isLoading={isLoading}
        >
          {movements.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No stock moved in this period.
            </p>
          ) : (
            <div className="space-y-0.5">
              {movements.map((m) => (
                <div
                  key={m.type}
                  className="flex items-baseline justify-between gap-3 border-b border-border py-2 last:border-0"
                >
                  <span className="text-sm">{humanise(m.type)}</span>
                  <span className="shrink-0 text-right text-xs">
                    {m.unitsIn > 0 && (
                      <span className="mr-2 font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                        +{formatNumber(m.unitsIn)}
                      </span>
                    )}
                    {m.unitsOut > 0 && (
                      <span className="mr-2 font-medium tabular-nums text-red-600 dark:text-red-400">
                        −{formatNumber(m.unitsOut)}
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      {formatNumber(m.movements)} moves
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </MetricPanel>
      </div>

      <ReportTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.variantId}
        isLoading={isLoading}
        storageKey="report-inventory"
        total={data?.total}
        page={table.page}
        totalPages={data?.totalPages ?? 1}
        onPageChange={(page) => setTable((prev) => ({ ...prev, page }))}
        emptyTitle="No stock in this view"
        emptyMessage="Nothing matched the selected bucket and filters."
      />
    </ReportShell>
  );
}

// =============================================================================
// PURCHASE REPORT
// =============================================================================

type SupplierPurchaseRow = {
  supplierId: string;
  businessName: string;
  purchaseCount: number;
  totalCost: number;
  paidAmount: number;
  dueAmount: number;
  unitsReceived: number;
  share: number;
}

export function PurchaseReportPage() {
  const [filters, setFilters] = useState<ReportFilterState>(DEFAULT_FILTERS);
  const params = cleanFilters(filters);
  const { data, isLoading, isError, error } = usePurchaseReport(params);

  const summary = data?.summary as
    | {
        purchaseCount: number;
        totalCost: number;
        paidAmount: number;
        dueAmount: number;
        unitsReceived: number;
        pendingDeliveries: number;
        averagePurchaseValue: number;
      }
    | undefined;

  const bySupplier = (data?.bySupplier ?? []) as SupplierPurchaseRow[];
  const byBrand = (data?.byBrand ?? []) as Array<{
    brandId: string | null;
    brandName: string;
    unitsReceived: number;
    totalCost: number;
    share: number;
  }>;
  const pending = (data?.pendingDeliveries ?? []) as Array<{
    id: string;
    purchaseNumber: string;
    supplierInvoiceNumber: string | null;
    purchaseDate: string;
    totalAmount: number;
    status: string;
    supplier: { id: string; businessName: string } | null;
    lineCount: number;
  }>;

  const comparison = data?.comparison as
    | { growth: number; trend: "up" | "down" | "flat" }
    | undefined;

  const columns: Array<ReportColumn<SupplierPurchaseRow>> = [
    {
      key: "businessName",
      header: "Supplier",
      locked: true,
      width: 220,
      render: (row) => <span className="font-medium">{row.businessName}</span>,
    },
    {
      key: "purchaseCount",
      header: "Purchases",
      align: "right",
      render: (row) => formatNumber(row.purchaseCount),
      footer: formatNumber(summary?.purchaseCount ?? 0),
    },
    {
      key: "unitsReceived",
      header: "Units",
      align: "right",
      render: (row) => formatNumber(row.unitsReceived),
      footer: formatNumber(summary?.unitsReceived ?? 0),
    },
    {
      key: "totalCost",
      header: "Total Cost",
      align: "right",
      render: (row) => formatCurrencyExact(row.totalCost),
      footer: formatCurrencyExact(summary?.totalCost ?? 0),
    },
    {
      key: "paidAmount",
      header: "Paid",
      align: "right",
      render: (row) => formatCurrencyExact(row.paidAmount),
      footer: formatCurrencyExact(summary?.paidAmount ?? 0),
    },
    {
      key: "dueAmount",
      header: "Outstanding",
      align: "right",
      render: (row) => (
        <span className={cn(row.dueAmount > 0 && "font-semibold text-amber-700 dark:text-amber-400")}>
          {formatCurrencyExact(row.dueAmount)}
        </span>
      ),
      footer: formatCurrencyExact(summary?.dueAmount ?? 0),
    },
    {
      key: "share",
      header: "Share",
      align: "right",
      width: 90,
      render: (row) => formatPercent(row.share),
    },
  ];

  return (
    <ReportShell
      title="Purchase Report"
      description="What was bought, from whom, at what cost — and what is still owed or still on its way."
      reportKey="purchases"
      filters={filters}
      onFiltersChange={setFilters}
      show={["supplier", "brand", "category"]}
      isLoading={isLoading}
      isError={isError}
      error={error}
    >
      <KpiGrid columns={4}>
        <KpiCard
          label="Total Cost"
          value={summary?.totalCost ?? 0}
          format={formatCurrency}
          icon={Truck}
          hint={`${formatNumber(summary?.purchaseCount ?? 0)} purchases · avg ${formatCurrency(summary?.averagePurchaseValue ?? 0)}`}
          {...(comparison
            ? {
                trend: {
                  direction: comparison.trend,
                  value: comparison.growth,
                  label: "vs previous",
                },
              }
            : {})}
        />
        <KpiCard
          label="Units Received"
          value={summary?.unitsReceived ?? 0}
          format={formatNumber}
          icon={Package}
        />
        <KpiCard
          label="Still Owed"
          value={summary?.dueAmount ?? 0}
          format={formatCurrency}
          icon={Wallet}
          accent={(summary?.dueAmount ?? 0) > 0 ? "warning" : "success"}
        />
        <KpiCard
          label="Pending Deliveries"
          value={summary?.pendingDeliveries ?? 0}
          format={formatNumber}
          icon={AlertTriangle}
          accent={(summary?.pendingDeliveries ?? 0) > 0 ? "warning" : "default"}
          hint="Ordered or partially received"
        />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartShell
          title="Spend by supplier"
          isLoading={isLoading}
          isEmpty={bySupplier.length === 0}
          height={320}
        >
          <BiBarChart
            data={bySupplier.slice(0, 10)}
            xKey="businessName"
            layout="horizontal"
            series={[{ key: "totalCost", label: "Total cost" }]}
          />
        </ChartShell>

        <ChartShell
          title="Spend by brand"
          isLoading={isLoading}
          isEmpty={byBrand.length === 0}
          height={320}
        >
          <BiPieChart
            data={byBrand}
            nameKey="brandName"
            valueKey="totalCost"
            variant="donut"
            centerLabel="Total cost"
            centerValue={formatCurrency(summary?.totalCost ?? 0)}
          />
        </ChartShell>
      </div>

      <ReportTable
        columns={columns}
        rows={bySupplier}
        rowKey={(row) => row.supplierId}
        isLoading={isLoading}
        storageKey="report-purchases"
        showFooter
        emptyTitle="No purchases"
        emptyMessage="Nothing was purchased in this period matching the filters."
      />

      {pending.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
              Pending deliveries ({pending.length})
            </h2>
            <ul className="divide-y divide-border">
              {pending.slice(0, 12).map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {p.purchaseNumber}
                      {p.supplierInvoiceNumber ? ` · ${p.supplierInvoiceNumber}` : ""}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {p.supplier?.businessName ?? "—"} · {formatDate(p.purchaseDate)} ·{" "}
                      {p.lineCount} line{p.lineCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-medium tabular-nums">
                      {formatCurrencyExact(p.totalAmount)}
                    </p>
                    <Badge variant="warning">{humanise(p.status)}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </ReportShell>
  );
}

// =============================================================================
// PAYMENT REPORT
// =============================================================================

type PaymentMethodRow = {
  method: string;
  amount: number;
  count: number;
  averageTicket: number;
  percentage: number;
  previousAmount: number;
  growth: number;
  trend: "up" | "down" | "flat";
}

export function PaymentReportPage() {
  const [filters, setFilters] = useState<ReportFilterState>(DEFAULT_FILTERS);
  const [granularity, setGranularity] = useState("auto");

  const params = { ...cleanFilters(filters), granularity };
  const { data, isLoading, isError, error } = usePaymentReport(params);

  const methods = (data?.methods ?? []) as PaymentMethodRow[];
  const seriesMethods = (data?.seriesMethods ?? []) as string[];
  const resolved = data?.period?.granularity ?? "day";
  const splits = data?.splitPayments as
    | { count: number; value: number; totalBills: number; percentage: number }
    | undefined;

  const columns: Array<ReportColumn<PaymentMethodRow>> = [
    {
      key: "method",
      header: "Method",
      locked: true,
      width: 150,
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
      key: "count",
      header: "Transactions",
      align: "right",
      render: (row) => formatNumber(row.count),
    },
    {
      key: "averageTicket",
      header: "Avg Ticket",
      align: "right",
      render: (row) => formatCurrencyExact(row.averageTicket),
    },
    {
      key: "percentage",
      header: "Share",
      align: "right",
      width: 90,
      render: (row) => formatPercent(row.percentage),
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
          {row.growth >= 0 ? "+" : ""}
          {row.growth.toFixed(1)}%
        </span>
      ),
    },
  ];

  return (
    <ReportShell
      title="Payment Report"
      description="Tender mix over time. A bill settled with two tenders counts in both — split bills are reported separately so nothing is double-counted."
      reportKey="payments"
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
          label="Total Collected"
          value={data?.total ?? 0}
          format={formatCurrency}
          icon={Wallet}
          accent="success"
        />
        <KpiCard
          label="Transactions"
          value={methods.reduce((n, m) => n + m.count, 0)}
          format={formatNumber}
          icon={CreditCard}
          hint={`across ${formatNumber(splits?.totalBills ?? 0)} bills`}
        />
        <KpiCard
          label="Split Bills"
          value={splits?.count ?? 0}
          format={formatNumber}
          icon={Layers}
          accent={(splits?.count ?? 0) > 0 ? "warning" : "default"}
          hint={`${formatPercent(splits?.percentage ?? 0)} of bills`}
        />
        <KpiCard
          label="Split Value"
          value={splits?.value ?? 0}
          format={formatCurrency}
          icon={Layers}
        />
      </KpiGrid>

      <ChartShell
        title="Tender mix over time"
        subtitle={`${data?.period?.label ?? ""} · stacked by method`}
        isLoading={isLoading}
        isEmpty={(data?.series?.length ?? 0) === 0}
        height={320}
      >
        <BiAreaChart
          data={data?.series ?? []}
          xKey="bucket"
          xTickFormatter={(v) => formatBucket(v, resolved)}
          stacked
          series={seriesMethods.map((m) => ({
            key: m,
            label: PAYMENT_METHOD_LABELS[m] ?? m,
          }))}
        />
      </ChartShell>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartShell
          title="Share of collections"
          isLoading={isLoading}
          isEmpty={methods.length === 0}
          height={300}
        >
          <BiPieChart
            data={methods.map((m) => ({
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
          isLoading={isLoading}
          isEmpty={methods.length === 0}
          height={300}
        >
          <BiBarChart
            data={methods.map((m) => ({
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
        rows={methods}
        rowKey={(row) => row.method}
        isLoading={isLoading}
        storageKey="report-payments"
        showFooter
        emptyTitle="No payments"
        emptyMessage="No payments were collected in this period."
      />
    </ReportShell>
  );
}

// =============================================================================
// RETURN & EXCHANGE REPORT
// =============================================================================

type ExchangeRow = {
  exchangeId: string;
  exchangeNumber: string;
  exchangeDate: string;
  reason: string;
  notes: string | null;
  returnedValue: number;
  issuedValue: number;
  priceDifference: number;
  returnedUnits: number;
  issuedUnits: number;
  customerName: string;
  customerPhone: string;
  employeeName: string;
  originalSaleNumber: string;
}

export function ReturnReportPage() {
  const [filters, setFilters] = useState<ReportFilterState>(DEFAULT_FILTERS);
  const [table, setTable] = useState({ page: 1, limit: 25 });

  const params = { ...cleanFilters(filters), ...table };
  const { data, isLoading, isError, error } = useReturnReport(params);

  const rows = (data?.data ?? []) as ExchangeRow[];
  const summary = data?.summary as
    | {
        exchanges: number;
        returnedUnits: number;
        returnedValue: number;
        issuedValue: number;
        refundValue: number;
        netValue: number;
        unitsSold: number;
        returnRatePercent: number;
      }
    | undefined;
  const reasons = (data?.reasons ?? []) as Array<{
    reason: string;
    count: number;
    value: number;
    percentage: number;
  }>;
  const topProducts = (data?.topReturnedProducts ?? []) as Array<{
    variantId: string;
    productName: string;
    sku: string;
    returnedUnits: number;
    returnedValue: number;
    exchangeCount: number;
  }>;

  // Narrowed explicitly: the paginated envelope types its sidecars as `unknown`
  // so a report can attach whatever it needs, and each page asserts the shape
  // it actually reads.
  const comparison = data?.comparison as
    | { growth: number; trend: "up" | "down" | "flat" }
    | undefined;

  const columns: Array<ReportColumn<ExchangeRow>> = [
    {
      key: "exchangeNumber",
      header: "Exchange",
      locked: true,
      width: 150,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.exchangeNumber}</p>
          <p className="truncate text-xs text-muted-foreground">
            was {row.originalSaleNumber}
          </p>
        </div>
      ),
    },
    {
      key: "exchangeDate",
      header: "Date",
      width: 120,
      render: (row) => formatDate(row.exchangeDate),
    },
    {
      key: "reason",
      header: "Reason",
      width: 170,
      render: (row) => <Badge variant="secondary">{row.reason}</Badge>,
    },
    {
      key: "customerName",
      header: "Customer",
      width: 170,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate">{row.customerName}</p>
          <p className="truncate text-xs text-muted-foreground">{row.customerPhone}</p>
        </div>
      ),
    },
    {
      key: "employeeName",
      header: "Processed By",
      width: 150,
      defaultHidden: true,
      render: (row) => row.employeeName,
    },
    {
      key: "returnedUnits",
      header: "Returned",
      align: "right",
      width: 90,
      render: (row) => formatNumber(row.returnedUnits),
    },
    {
      key: "issuedUnits",
      header: "Issued",
      align: "right",
      width: 80,
      render: (row) => formatNumber(row.issuedUnits),
    },
    {
      key: "returnedValue",
      header: "Returned Value",
      align: "right",
      render: (row) => formatCurrencyExact(row.returnedValue),
    },
    {
      key: "issuedValue",
      header: "Issued Value",
      align: "right",
      render: (row) => formatCurrencyExact(row.issuedValue),
    },
    {
      key: "priceDifference",
      header: "Difference",
      align: "right",
      width: 120,
      render: (row) => (
        <span
          className={cn(
            "font-medium",
            row.priceDifference > 0 && "text-emerald-600 dark:text-emerald-400",
            row.priceDifference < 0 && "text-red-600 dark:text-red-400"
          )}
        >
          {row.priceDifference > 0 ? "+" : row.priceDifference < 0 ? "−" : ""}
          {formatCurrencyExact(Math.abs(row.priceDifference))}
        </span>
      ),
    },
  ];

  return (
    <ReportShell
      title="Return & Exchange Report"
      description="This system records returns as exchanges. A negative price difference is a refund; a positive one is a customer upgrading."
      reportKey="returns"
      filters={filters}
      onFiltersChange={setFilters}
      show={["employee", "category", "brand"]}
      isLoading={isLoading}
      isError={isError}
      error={error}
    >
      <KpiGrid columns={4}>
        <KpiCard
          label="Exchanges"
          value={summary?.exchanges ?? 0}
          format={formatNumber}
          icon={RefreshCcw}
          {...(comparison
            ? {
                trend: {
                  direction: comparison.trend,
                  value: comparison.growth,
                  label: "vs previous",
                },
              }
            : {})}
        />
        <KpiCard
          label="Units Returned"
          value={summary?.returnedUnits ?? 0}
          format={formatNumber}
          icon={PackageX}
          accent={(summary?.returnRatePercent ?? 0) > 5 ? "warning" : "default"}
          hint={`${formatPercent(summary?.returnRatePercent ?? 0)} of ${formatNumber(summary?.unitsSold ?? 0)} units sold`}
        />
        <KpiCard
          label="Refunded"
          value={summary?.refundValue ?? 0}
          format={formatCurrency}
          icon={Wallet}
          accent={(summary?.refundValue ?? 0) > 0 ? "warning" : "default"}
          hint="Cash paid back on downgrades"
        />
        <KpiCard
          label="Net Value Movement"
          value={summary?.netValue ?? 0}
          format={formatCurrency}
          icon={Layers}
          accent={(summary?.netValue ?? 0) >= 0 ? "success" : "danger"}
          hint="Issued less returned — positive means customers upgraded"
        />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartShell
          title="Why goods come back"
          subtitle="The single most useful thing on this page"
          isLoading={isLoading}
          isEmpty={reasons.length === 0}
          height={320}
        >
          <BiBarChart
            data={reasons}
            xKey="reason"
            layout="horizontal"
            valueFormat="number"
            tooltipFormat="number"
            series={[{ key: "count", label: "Exchanges" }]}
          />
        </ChartShell>

        <MetricPanel
          title="Most returned products"
          description="A product high on this list usually has a sizing or quality problem"
          isLoading={isLoading}
        >
          {topProducts.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nothing came back in this period.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {topProducts.slice(0, 10).map((p) => (
                <li key={p.variantId} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.productName}</p>
                    <p className="truncate text-xs text-muted-foreground">{p.sku}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium tabular-nums">
                      {formatNumber(p.returnedUnits)} units
                    </p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {formatCurrency(p.returnedValue)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </MetricPanel>
      </div>

      <ReportTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.exchangeId}
        isLoading={isLoading}
        storageKey="report-returns"
        total={data?.total}
        page={table.page}
        totalPages={data?.totalPages ?? 1}
        onPageChange={(page) => setTable((prev) => ({ ...prev, page }))}
        emptyTitle="No returns or exchanges"
        emptyMessage="Nothing came back in this period matching the filters."
      />
    </ReportShell>
  );
}
