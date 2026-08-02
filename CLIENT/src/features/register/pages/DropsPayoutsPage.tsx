/**
 * Cash drops and payouts — the two ways money leaves a drawer.
 *
 * ONE PAGE, TWO TABS, ONE REASON
 * ------------------------------
 * A drop and a payout look identical from the drawer's point of view (cash
 * out) and are completely different in the accounts (a drop is a transfer; a
 * payout is an expense that hits the P&L). Putting them side by side is how a
 * reader internalises that distinction. Separating them into two nav entries
 * would let someone reconcile one and forget the other.
 */

import { useState } from "react";
import { ArrowDownToLine, Receipt, Wallet } from "lucide-react";

import { Badge, Button, Card, Select } from "@/components/ui";
import {
  DebouncedSearch,
  ExportMenu,
  KpiCard,
  KpiGrid,
  PageHeader,
  ReportTable,
  formatCurrency,
  formatCurrencyExact,
  formatDateTime,
  formatNumber,
  PAYOUT_CATEGORY_LABELS,
  type ReportColumn,
} from "@/components/shared/bi";
import { cn } from "@/utils/cn";

import { useCashDrops, useCashPayouts } from "../hooks/useRegister";
import type { CashDrop, CashPayout, DropListParams, PayoutListParams } from "../types";

type Tab = "drops" | "payouts";

const CATEGORY_OPTIONS = [
  { value: "", label: "All categories" },
  ...Object.entries(PAYOUT_CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
];

export default function DropsPayoutsPage() {
  const [tab, setTab] = useState<Tab>("drops");

  const [dropParams, setDropParams] = useState<DropListParams>({ page: 1, limit: 25 });
  const [payoutParams, setPayoutParams] = useState<PayoutListParams>({ page: 1, limit: 25 });

  const drops = useCashDrops(dropParams);
  const payouts = useCashPayouts(payoutParams);

  const dropColumns: Array<ReportColumn<CashDrop>> = [
    {
      key: "dropNumber",
      header: "Drop No.",
      locked: true,
      width: 150,
      render: (row) => <span className="font-medium">{row.dropNumber}</span>,
    },
    {
      key: "createdAt",
      header: "Date",
      width: 150,
      render: (row) => <span className="text-xs">{formatDateTime(row.createdAt)}</span>,
    },
    {
      key: "register",
      header: "Register",
      width: 110,
      render: (row) => row.register?.registerNumber ?? "—",
    },
    {
      key: "employee",
      header: "By",
      width: 140,
      render: (row) => row.employee?.name ?? "—",
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      width: 120,
      render: (row) => formatCurrencyExact(row.amount),
    },
    {
      key: "reason",
      header: "Reason",
      render: (row) => <span className="text-sm">{row.reason}</span>,
    },
    {
      key: "destination",
      header: "Destination",
      defaultHidden: true,
      render: (row) => row.destination ?? "—",
    },
    {
      key: "referenceNumber",
      header: "Reference",
      defaultHidden: true,
      render: (row) => row.referenceNumber ?? "—",
    },
    {
      key: "witnessedBy",
      header: "Witness",
      defaultHidden: true,
      render: (row) => row.witnessedBy?.name ?? "—",
    },
  ];

  const payoutColumns: Array<ReportColumn<CashPayout>> = [
    {
      key: "payoutNumber",
      header: "Payout No.",
      locked: true,
      width: 150,
      render: (row) => <span className="font-medium">{row.payoutNumber}</span>,
    },
    {
      key: "createdAt",
      header: "Date",
      width: 150,
      render: (row) => <span className="text-xs">{formatDateTime(row.createdAt)}</span>,
    },
    {
      key: "category",
      header: "Category",
      width: 150,
      render: (row) => (
        <Badge variant="secondary">
          {PAYOUT_CATEGORY_LABELS[row.category] ?? row.category}
        </Badge>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      width: 120,
      render: (row) => formatCurrencyExact(row.amount),
    },
    {
      key: "reason",
      header: "Reason",
      render: (row) => <span className="text-sm">{row.reason}</span>,
    },
    {
      key: "payeeName",
      header: "Paid To",
      render: (row) => row.payeeName ?? "—",
    },
    {
      key: "register",
      header: "Register",
      defaultHidden: true,
      render: (row) => row.register?.registerNumber ?? "—",
    },
    {
      key: "employee",
      header: "Recorded By",
      defaultHidden: true,
      render: (row) => row.employee?.name ?? "—",
    },
  ];

  const isDrops = tab === "drops";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Drops & Payouts"
        description="Cash drops move money to the safe. Payouts are expenses paid from the drawer and appear in the P&L."
        actions={
          <ExportMenu
            path={isDrops ? "/register/drops/export" : "/register/payouts/export"}
            filters={(isDrops ? dropParams : payoutParams) as Record<string, unknown>}
          />
        }
      />

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1">
        {(
          [
            { key: "drops" as const, label: "Cash Drops", icon: ArrowDownToLine },
            { key: "payouts" as const, label: "Cash Payouts", icon: Receipt },
          ]
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              tab === key
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {isDrops ? (
        <>
          <KpiGrid columns={2}>
            <KpiCard
              label="Total Dropped"
              value={drops.data?.summary.totalAmount ?? 0}
              format={formatCurrency}
              icon={ArrowDownToLine}
              hint="Cash moved from drawers to the safe or bank"
            />
            <KpiCard
              label="Drops Recorded"
              value={drops.data?.summary.count ?? 0}
              format={formatNumber}
              icon={Wallet}
            />
          </KpiGrid>

          <FilterRow
            search={dropParams.search ?? ""}
            onSearch={(search) =>
              setDropParams((p) => ({ ...p, search: search || undefined, page: 1 }))
            }
            startDate={dropParams.startDate ?? ""}
            endDate={dropParams.endDate ?? ""}
            onDate={(patch) => setDropParams((p) => ({ ...p, ...patch, page: 1 }))}
            onReset={() => setDropParams({ page: 1, limit: 25 })}
            searchPlaceholder="Drop number, reason, destination…"
          />

          <ReportTable
            columns={dropColumns}
            rows={drops.data?.data ?? []}
            rowKey={(row) => row.id}
            isLoading={drops.isLoading}
            storageKey="cash-drops"
            total={drops.data?.total}
            page={dropParams.page ?? 1}
            totalPages={drops.data?.totalPages ?? 1}
            onPageChange={(page) => setDropParams((p) => ({ ...p, page }))}
            emptyTitle="No cash drops"
            emptyMessage="No cash has been moved out of a drawer in this period."
          />
        </>
      ) : (
        <>
          <KpiGrid columns={3}>
            <KpiCard
              label="Total Paid Out"
              value={payouts.data?.summary.totalAmount ?? 0}
              format={formatCurrency}
              icon={Receipt}
              accent="warning"
              hint="Every payout also creates an expense record"
            />
            <KpiCard
              label="Payouts Recorded"
              value={payouts.data?.summary.count ?? 0}
              format={formatNumber}
              icon={Wallet}
            />
            <KpiCard
              label="Largest Category"
              value={payouts.data?.summary.byCategory?.[0]?.amount ?? 0}
              format={formatCurrency}
              icon={Receipt}
              hint={
                payouts.data?.summary.byCategory?.[0]
                  ? (PAYOUT_CATEGORY_LABELS[payouts.data.summary.byCategory[0].category] ??
                    payouts.data.summary.byCategory[0].category)
                  : "No payouts yet"
              }
            />
          </KpiGrid>

          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <DebouncedSearch
              value={payoutParams.search ?? ""}
              onChange={(search) =>
                setPayoutParams((p) => ({ ...p, search: search || undefined, page: 1 }))
              }
              placeholder="Payout number, reason, payee…"
              className="w-full sm:w-72"
            />

            <div className="w-full sm:w-52">
              <Select
                label="Category"
                options={CATEGORY_OPTIONS}
                value={payoutParams.category ?? ""}
                onChange={(e) =>
                  setPayoutParams((p) => ({
                    ...p,
                    category: (e.target.value || undefined) as PayoutListParams["category"],
                    page: 1,
                  }))
                }
              />
            </div>

            <DateField
              label="From"
              value={payoutParams.startDate ?? ""}
              onChange={(startDate) =>
                setPayoutParams((p) => ({ ...p, startDate: startDate || undefined, page: 1 }))
              }
            />
            <DateField
              label="To"
              value={payoutParams.endDate ?? ""}
              onChange={(endDate) =>
                setPayoutParams((p) => ({ ...p, endDate: endDate || undefined, page: 1 }))
              }
            />

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPayoutParams({ page: 1, limit: 25 })}
            >
              Reset
            </Button>
          </div>

          {/* Category breakdown — the fastest read on where drawer cash goes. */}
          {(payouts.data?.summary.byCategory?.length ?? 0) > 0 && (
            <Card className="p-3">
              <div className="flex flex-wrap gap-2">
                {payouts.data!.summary.byCategory.map((c) => (
                  <span
                    key={c.category}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs"
                  >
                    <span className="font-medium">
                      {PAYOUT_CATEGORY_LABELS[c.category] ?? c.category}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatCurrency(c.amount)} · {c.count}
                    </span>
                  </span>
                ))}
              </div>
            </Card>
          )}

          <ReportTable
            columns={payoutColumns}
            rows={payouts.data?.data ?? []}
            rowKey={(row) => row.id}
            isLoading={payouts.isLoading}
            storageKey="cash-payouts"
            total={payouts.data?.total}
            page={payoutParams.page ?? 1}
            totalPages={payouts.data?.totalPages ?? 1}
            onPageChange={(page) => setPayoutParams((p) => ({ ...p, page }))}
            emptyTitle="No payouts"
            emptyMessage="No expenses have been paid from a drawer in this period."
          />
        </>
      )}
    </div>
  );
}

// =============================================================================
// SMALL SHARED CONTROLS
// =============================================================================

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="w-full sm:w-40">
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}

function FilterRow({
  search,
  onSearch,
  startDate,
  endDate,
  onDate,
  onReset,
  searchPlaceholder,
}: {
  search: string;
  onSearch: (next: string) => void;
  startDate: string;
  endDate: string;
  onDate: (patch: { startDate?: string | undefined; endDate?: string | undefined }) => void;
  onReset: () => void;
  searchPlaceholder: string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <DebouncedSearch
        value={search}
        onChange={onSearch}
        placeholder={searchPlaceholder}
        className="w-full sm:w-72"
      />
      <DateField
        label="From"
        value={startDate}
        onChange={(v) => onDate({ startDate: v || undefined })}
      />
      <DateField
        label="To"
        value={endDate}
        onChange={(v) => onDate({ endDate: v || undefined })}
      />
      <Button variant="ghost" size="sm" onClick={onReset}>
        Reset
      </Button>
    </div>
  );
}
