/**
 * Register history — every shift, filterable, exportable.
 *
 * SCOPED BY THE SERVER, NOT BY THIS SCREEN.
 *
 * A cashier opening this page sees only their own sessions; an owner sees
 * everyone's. That narrowing happens in the service's WHERE clause, which means
 * the pagination totals are correct for each role too — filtering after the
 * fact would show a cashier a page count that included rows they cannot see.
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { AlertTriangle, Calendar, CheckCircle2, Wallet } from "lucide-react";

import { Badge, Button, Select } from "@/components/ui";
import {
  ExportMenu,
  KpiCard,
  KpiGrid,
  PageHeader,
  ReportTable,
  DebouncedSearch,
  formatCurrency,
  formatCurrencyExact,
  formatDateTime,
  formatNumber,
  REGISTER_STATUS_LABELS,
  REGISTER_STATUS_VARIANTS,
  varianceKind,
  VARIANCE_VARIANTS,
  type ReportColumn,
} from "@/components/shared/bi";
import { cn } from "@/utils/cn";

import { useRegisterHistory, useRegisterNumbers } from "../hooks/useRegister";
import type { RegisterHistoryParams, RegisterSession } from "../types";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "OPEN", label: "Open" },
  { value: "CLOSED", label: "Closed" },
  { value: "RECONCILED", label: "Reconciled" },
];

const DISCREPANCY_OPTIONS = [
  { value: "", label: "All shifts" },
  { value: "true", label: "Did not balance" },
  { value: "false", label: "Balanced exactly" },
];

export default function RegisterHistoryPage() {
  const navigate = useNavigate();
  const { data: registerNumbers = [] } = useRegisterNumbers();

  const [params, setParams] = useState<RegisterHistoryParams>({
    page: 1,
    limit: 25,
    sortBy: "openedAt",
    sortOrder: "desc",
  });

  const { data, isLoading } = useRegisterHistory(params);

  // Changing any filter must reset to page 1 — staying on page 4 of a result
  // set that now has two pages shows an empty table and reads as a bug.
  const setFilter = (patch: Partial<RegisterHistoryParams>) =>
    setParams((prev) => ({ ...prev, ...patch, page: 1 }));

  const registerOptions = useMemo(
    () => [
      { value: "", label: "All registers" },
      ...registerNumbers.map((n) => ({ value: n, label: n })),
    ],
    [registerNumbers]
  );

  const summary = data?.summary;

  const columns: Array<ReportColumn<RegisterSession>> = [
    {
      key: "session",
      header: "Session",
      locked: true,
      width: 160,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.sessionNumber ?? row.id.slice(-8)}</p>
          <p className="truncate text-xs text-muted-foreground">{row.registerNumber}</p>
        </div>
      ),
    },
    {
      key: "employee",
      header: "Employee",
      width: 160,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate">{row.employee?.name ?? "—"}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.employee?.employeeCode ?? ""}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: 110,
      render: (row) => (
        <Badge variant={REGISTER_STATUS_VARIANTS[row.status] ?? "secondary"}>
          {REGISTER_STATUS_LABELS[row.status] ?? row.status}
        </Badge>
      ),
    },
    {
      key: "openedAt",
      header: "Opened",
      sortKey: "openedAt",
      width: 150,
      render: (row) => (
        <span className="text-xs">{formatDateTime(row.openedAt)}</span>
      ),
    },
    {
      key: "closedAt",
      header: "Closed",
      sortKey: "closedAt",
      width: 150,
      render: (row) => (
        <span className="text-xs">
          {row.closedAt ? formatDateTime(row.closedAt) : "—"}
        </span>
      ),
    },
    {
      key: "duration",
      header: "Duration",
      align: "right",
      width: 90,
      render: (row) => row.durationLabel,
    },
    {
      key: "openingCash",
      header: "Opening",
      align: "right",
      defaultHidden: true,
      render: (row) => formatCurrency(row.openingCash),
    },
    {
      key: "cashSales",
      header: "Cash Sales",
      align: "right",
      render: (row) => formatCurrency(row.cashSales),
    },
    {
      key: "upiSales",
      header: "UPI",
      align: "right",
      defaultHidden: true,
      render: (row) => formatCurrency(row.upiSales),
    },
    {
      key: "cardSales",
      header: "Card",
      align: "right",
      defaultHidden: true,
      render: (row) => formatCurrency(row.cardSales),
    },
    {
      key: "drops",
      header: "Drops",
      align: "right",
      defaultHidden: true,
      render: (row) => formatCurrency(row.cashDropTotal),
    },
    {
      key: "payouts",
      header: "Payouts",
      align: "right",
      defaultHidden: true,
      render: (row) => formatCurrency(row.cashPayoutTotal),
    },
    {
      key: "expectedCash",
      header: "Expected",
      sortKey: "expectedBalance",
      align: "right",
      render: (row) =>
        row.status === "OPEN" ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          formatCurrencyExact(row.expectedCash)
        ),
    },
    {
      key: "countedCash",
      header: "Counted",
      align: "right",
      render: (row) =>
        row.status === "OPEN" ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          formatCurrencyExact(row.countedCash)
        ),
    },
    {
      key: "difference",
      header: "Difference",
      sortKey: "difference",
      align: "right",
      width: 130,
      render: (row) => {
        if (row.status === "OPEN") return <span className="text-muted-foreground">—</span>;
        const kind = varianceKind(row.difference);
        if (kind === "BALANCED") {
          return (
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              Balanced
            </span>
          );
        }
        return (
          <Badge variant={VARIANCE_VARIANTS[kind!]}>
            {row.difference > 0 ? "+" : "−"}
            {formatCurrencyExact(Math.abs(row.difference))}
          </Badge>
        );
      },
    },
    {
      key: "reason",
      header: "Reason",
      defaultHidden: true,
      width: 220,
      render: (row) => (
        <span className="text-xs text-muted-foreground">{row.discrepancyReason ?? "—"}</span>
      ),
    },
    {
      key: "transactions",
      header: "Txns",
      align: "right",
      width: 70,
      render: (row) => formatNumber(row.transactionCount),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Register History"
        description="Every shift, with its reconciliation. Click a row to open the full shift summary."
        actions={
          <ExportMenu
            path="/register/history/export"
            filters={params as Record<string, unknown>}
          />
        }
      />

      {/* ── Summary cards ──────────────────────────────────────────────────── */}
      <KpiGrid columns={4}>
        <KpiCard
          label="Sessions"
          value={summary?.sessions ?? 0}
          format={formatNumber}
          icon={Calendar}
          hint={`${summary?.open ?? 0} open · ${summary?.closed ?? 0} closed · ${summary?.reconciled ?? 0} reconciled`}
        />
        <KpiCard
          label="Cash Sales"
          value={summary?.totalCashSales ?? 0}
          format={formatCurrency}
          icon={Wallet}
          accent="success"
          hint={`${formatNumber(summary?.totalTransactions ?? 0)} transactions`}
        />
        <KpiCard
          label="Drops & Payouts"
          value={(summary?.totalDrops ?? 0) + (summary?.totalPayouts ?? 0)}
          format={formatCurrency}
          icon={Wallet}
          accent="warning"
        />
        <KpiCard
          label="Net Variance"
          value={summary?.totalDifference ?? 0}
          format={formatCurrencyExact}
          icon={AlertTriangle}
          accent={
            (summary?.totalDifference ?? 0) === 0
              ? "success"
              : (summary?.totalDifference ?? 0) < 0
                ? "danger"
                : "info"
          }
          hint="Across every closed shift in this filter"
        />
      </KpiGrid>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <DebouncedSearch
          value={params.search ?? ""}
          onChange={(search) => setFilter({ search: search || undefined })}
          placeholder="Session, register, employee or reason…"
          className="w-full sm:w-72"
        />

        <div className="w-full sm:w-40">
          <Select
            label="Register"
            options={registerOptions}
            value={params.registerNumber ?? ""}
            onChange={(e) => setFilter({ registerNumber: e.target.value || undefined })}
          />
        </div>

        <div className="w-full sm:w-40">
          <Select
            label="Status"
            options={STATUS_OPTIONS}
            value={params.status ?? ""}
            onChange={(e) =>
              setFilter({ status: (e.target.value || undefined) as RegisterSession["status"] })
            }
          />
        </div>

        <div className="w-full sm:w-44">
          <Select
            label="Reconciliation"
            options={DISCREPANCY_OPTIONS}
            value={
              params.hasDiscrepancy === undefined ? "" : String(params.hasDiscrepancy)
            }
            onChange={(e) =>
              setFilter({
                hasDiscrepancy: e.target.value === "" ? undefined : e.target.value === "true",
              })
            }
          />
        </div>

        <div className="w-full sm:w-40">
          <label className="mb-1.5 block text-sm font-medium">From</label>
          <input
            type="date"
            value={params.startDate ?? ""}
            onChange={(e) => setFilter({ startDate: e.target.value || undefined })}
            className={cn(
              "h-9 w-full rounded-md border border-input bg-background px-3 text-sm",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          />
        </div>

        <div className="w-full sm:w-40">
          <label className="mb-1.5 block text-sm font-medium">To</label>
          <input
            type="date"
            value={params.endDate ?? ""}
            onChange={(e) => setFilter({ endDate: e.target.value || undefined })}
            className={cn(
              "h-9 w-full rounded-md border border-input bg-background px-3 text-sm",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          />
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            setParams({ page: 1, limit: 25, sortBy: "openedAt", sortOrder: "desc" })
          }
        >
          Reset
        </Button>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <ReportTable
        columns={columns}
        rows={data?.data ?? []}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        storageKey="register-history"
        total={data?.total}
        page={params.page ?? 1}
        totalPages={data?.totalPages ?? 1}
        onPageChange={(page) => setParams((prev) => ({ ...prev, page }))}
        sortBy={params.sortBy}
        sortOrder={params.sortOrder}
        onSortChange={(sortBy, sortOrder) =>
          setParams((prev) => ({
            ...prev,
            sortBy: sortBy as RegisterHistoryParams["sortBy"],
            sortOrder,
            page: 1,
          }))
        }
        onRowClick={(row) => navigate(`/register/sessions/${row.id}`)}
        emptyTitle="No shifts found"
        emptyMessage="No register sessions matched these filters. Try widening the date range."
      />
    </div>
  );
}
