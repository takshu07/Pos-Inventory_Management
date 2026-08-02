/**
 * Supplier payables — what is owed, to whom, and how late.
 *
 * AGEING IS THE ORGANISING IDEA.
 *
 * "You owe ₹4.2 lakh" is not actionable. "₹90,000 of it is more than 90 days
 * late, to one supplier" is. So the page leads with the ageing buckets, and the
 * bill table sorts by due date ascending — the thing that needs paying first is
 * the first row, without anyone touching a sort control.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, Banknote, CalendarClock, Truck } from "lucide-react";

import { Badge, Button, Card, CardContent, Input, Modal, Select } from "@/components/ui";
import {
  AGEING_LABELS,
  AGEING_VARIANTS,
  BiBarChart,
  ChartShell,
  DebouncedSearch,
  ExportMenu,
  KpiCard,
  KpiGrid,
  PageHeader,
  PAYMENT_METHOD_LABELS,
  ReportTable,
  SETTLEMENT_STATUS_LABELS,
  SETTLEMENT_STATUS_VARIANTS,
  formatCurrency,
  formatCurrencyExact,
  formatDate,
  formatNumber,
  type ReportColumn,
} from "@/components/shared/bi";
import { cn } from "@/utils/cn";

import {
  useFinanceSuppliers,
  usePayables,
  useRecordSupplierPayment,
  useSetBillDueDate,
} from "../hooks/useFinance";
import type { PayableBill, PayablesParams } from "../types";

const STATUS_OPTIONS = [
  { value: "", label: "Unsettled bills" },
  { value: "UNPAID", label: "Unpaid" },
  { value: "PARTIALLY_PAID", label: "Part paid" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "PAID", label: "Paid" },
];

export default function PayablesPage() {
  const [params, setParams] = useState<PayablesParams>({
    page: 1,
    limit: 25,
    sortBy: "dueDate",
    sortOrder: "asc",
  });

  const [payFor, setPayFor] = useState<PayableBill | null>(null);
  const [dueDateFor, setDueDateFor] = useState<PayableBill | null>(null);

  const { data, isLoading } = usePayables(params);
  const suppliers = useFinanceSuppliers();
  const recordPayment = useRecordSupplierPayment();
  const setDueDate = useSetBillDueDate();

  const setFilter = (patch: Partial<PayablesParams>) =>
    setParams((prev) => ({ ...prev, ...patch, page: 1 }));

  const summary = data?.summary;

  // Ageing totals rolled up across suppliers — the fastest read on the page.
  const ageingTotals = useMemo(() => {
    const rows = data?.bySupplier ?? [];
    return {
      current: rows.reduce((n, s) => n + s.ageing.current, 0),
      days0_30: rows.reduce((n, s) => n + s.ageing.days0_30, 0),
      days31_60: rows.reduce((n, s) => n + s.ageing.days31_60, 0),
      days61_90: rows.reduce((n, s) => n + s.ageing.days61_90, 0),
      days90plus: rows.reduce((n, s) => n + s.ageing.days90plus, 0),
    };
  }, [data?.bySupplier]);

  const ageingChart = [
    { bucket: "Current", amount: ageingTotals.current },
    { bucket: "1–30 days", amount: ageingTotals.days0_30 },
    { bucket: "31–60 days", amount: ageingTotals.days31_60 },
    { bucket: "61–90 days", amount: ageingTotals.days61_90 },
    { bucket: "90+ days", amount: ageingTotals.days90plus },
  ];

  const overdueTotal =
    ageingTotals.days0_30 + ageingTotals.days31_60 + ageingTotals.days61_90 + ageingTotals.days90plus;

  const columns: Array<ReportColumn<PayableBill>> = [
    {
      key: "purchaseNumber",
      header: "Bill",
      locked: true,
      width: 160,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.purchaseNumber}</p>
          {row.supplierInvoiceNumber && (
            <p className="truncate text-xs text-muted-foreground">
              {row.supplierInvoiceNumber}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "supplier",
      header: "Supplier",
      width: 180,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate">{row.supplier?.businessName ?? "—"}</p>
          <p className="truncate text-xs text-muted-foreground">{row.supplier?.phone ?? ""}</p>
        </div>
      ),
    },
    {
      key: "purchaseDate",
      header: "Bill Date",
      sortKey: "purchaseDate",
      width: 120,
      render: (row) => formatDate(row.purchaseDate),
    },
    {
      key: "dueDate",
      header: "Due",
      sortKey: "dueDate",
      width: 150,
      render: (row) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setDueDateFor(row);
          }}
          className="text-left hover:underline"
        >
          {row.dueDate ? (
            <>
              <span>{formatDate(row.dueDate)}</span>
              {row.daysOverdue !== null && row.daysOverdue > 0 && (
                <span className="ml-1.5 text-xs text-red-600 dark:text-red-400">
                  {row.daysOverdue}d late
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Set due date</span>
          )}
        </button>
      ),
    },
    {
      key: "ageing",
      header: "Ageing",
      width: 120,
      render: (row) => (
        <Badge variant={AGEING_VARIANTS[row.ageingBucket] ?? "secondary"}>
          {AGEING_LABELS[row.ageingBucket] ?? row.ageingBucket}
        </Badge>
      ),
    },
    {
      key: "totalAmount",
      header: "Bill Total",
      sortKey: "totalAmount",
      align: "right",
      render: (row) => formatCurrencyExact(row.totalAmount),
      footer: formatCurrencyExact(summary?.totalAmount ?? 0),
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
      sortKey: "dueAmount",
      align: "right",
      render: (row) => (
        <span className={cn(row.dueAmount > 0 && "font-semibold")}>
          {formatCurrencyExact(row.dueAmount)}
        </span>
      ),
      footer: formatCurrencyExact(summary?.dueAmount ?? 0),
    },
    {
      key: "paymentStatus",
      header: "Status",
      width: 120,
      render: (row) => (
        <Badge variant={SETTLEMENT_STATUS_VARIANTS[row.paymentStatus] ?? "secondary"}>
          {SETTLEMENT_STATUS_LABELS[row.paymentStatus] ?? row.paymentStatus}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: 110,
      render: (row) =>
        row.dueAmount > 0 ? (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              setPayFor(row);
            }}
          >
            Pay
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Supplier Payments"
        description="Every purchase is a settleable bill. Recording a payment updates the bill and, if paid in cash from an open drawer, the till."
        actions={
          <ExportMenu path="/finance/export/payables" filters={params as Record<string, unknown>} />
        }
      />

      <KpiGrid columns={4}>
        <KpiCard
          label="Outstanding"
          value={summary?.dueAmount ?? 0}
          format={formatCurrency}
          icon={Truck}
          accent={(summary?.dueAmount ?? 0) > 0 ? "warning" : "success"}
          hint={`${formatNumber(summary?.billCount ?? 0)} unsettled bills`}
        />
        <KpiCard
          label="Overdue"
          value={overdueTotal}
          format={formatCurrency}
          icon={AlertTriangle}
          accent={overdueTotal > 0 ? "danger" : "success"}
          hint="Past the agreed due date"
        />
        <KpiCard
          label="90+ Days Late"
          value={ageingTotals.days90plus}
          format={formatCurrency}
          icon={CalendarClock}
          accent={ageingTotals.days90plus > 0 ? "danger" : "default"}
        />
        <KpiCard
          label="Already Paid"
          value={summary?.paidAmount ?? 0}
          format={formatCurrency}
          icon={Banknote}
          accent="success"
          hint="Against the bills in this filter"
        />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartShell
          title="Ageing"
          subtitle="Outstanding balance by how overdue it is"
          isLoading={isLoading}
          isEmpty={ageingChart.every((b) => b.amount === 0)}
          emptyMessage="Nothing is outstanding."
          height={280}
        >
          <BiBarChart
            data={ageingChart}
            xKey="bucket"
            series={[{ key: "amount", label: "Outstanding" }]}
          />
        </ChartShell>

        <Card>
          <CardContent className="p-0">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">By supplier</h3>
              <p className="text-xs text-muted-foreground">Largest outstanding first</p>
            </div>
            <div className="max-h-[280px] overflow-y-auto">
              {(data?.bySupplier.length ?? 0) === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Nothing outstanding.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {data!.bySupplier.map((s) => (
                    <li
                      key={s.supplierId}
                      className="flex items-start justify-between gap-3 px-4 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{s.businessName}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatNumber(s.billCount)} bill{s.billCount === 1 ? "" : "s"}
                          {s.ageing.days90plus > 0 && (
                            <span className="ml-1.5 text-red-600 dark:text-red-400">
                              · {formatCurrency(s.ageing.days90plus)} over 90 days
                            </span>
                          )}
                        </p>
                      </div>
                      <span className="shrink-0 font-medium tabular-nums">
                        {formatCurrencyExact(s.dueAmount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <DebouncedSearch
          value={params.search ?? ""}
          onChange={(search) => setFilter({ search: search || undefined })}
          placeholder="Bill number, invoice or supplier…"
          className="w-full sm:w-72"
        />

        <div className="w-full sm:w-52">
          <Select
            label="Supplier"
            options={[
              { value: "", label: "All suppliers" },
              ...(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.businessName })),
            ]}
            value={params.supplierId ?? ""}
            onChange={(e) => setFilter({ supplierId: e.target.value || undefined })}
          />
        </div>

        <div className="w-full sm:w-44">
          <Select
            label="Status"
            options={STATUS_OPTIONS}
            value={params.paymentStatus ?? ""}
            onChange={(e) =>
              setFilter({
                paymentStatus: (e.target.value || undefined) as PayablesParams["paymentStatus"],
              })
            }
          />
        </div>

        <label className="flex h-9 cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={params.overdueOnly ?? false}
            onChange={(e) => setFilter({ overdueOnly: e.target.checked || undefined })}
            className="h-4 w-4 rounded border-border"
          />
          Overdue only
        </label>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setParams({ page: 1, limit: 25, sortBy: "dueDate", sortOrder: "asc" })}
        >
          Reset
        </Button>
      </div>

      <ReportTable
        columns={columns}
        rows={data?.data ?? []}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        storageKey="finance-payables"
        showFooter
        total={data?.total}
        page={params.page ?? 1}
        totalPages={data?.totalPages ?? 1}
        onPageChange={(page) => setParams((prev) => ({ ...prev, page }))}
        sortBy={params.sortBy}
        sortOrder={params.sortOrder}
        onSortChange={(sortBy, sortOrder) =>
          setParams((prev) => ({
            ...prev,
            sortBy: sortBy as PayablesParams["sortBy"],
            sortOrder,
            page: 1,
          }))
        }
        emptyTitle="Nothing outstanding"
        emptyMessage="No supplier bills matched these filters."
      />

      <RecordPaymentDialog
        bill={payFor}
        onClose={() => setPayFor(null)}
        isSubmitting={recordPayment.isPending}
        onSubmit={(payload) =>
          payFor &&
          recordPayment.mutate(
            { ...payload, supplierId: payFor.supplier!.id, purchaseId: payFor.id },
            { onSuccess: () => setPayFor(null) }
          )
        }
      />

      <DueDateDialog
        bill={dueDateFor}
        onClose={() => setDueDateFor(null)}
        isSubmitting={setDueDate.isPending}
        onSubmit={(dueDate) =>
          dueDateFor &&
          setDueDate.mutate(
            { purchaseId: dueDateFor.id, dueDate },
            { onSuccess: () => setDueDateFor(null) }
          )
        }
      />
    </div>
  );
}

// =============================================================================
// RECORD PAYMENT
// =============================================================================

function RecordPaymentDialog({
  bill,
  onClose,
  isSubmitting,
  onSubmit,
}: {
  bill: PayableBill | null;
  onClose: () => void;
  isSubmitting: boolean;
  onSubmit: (payload: {
    amount: number;
    paymentMethod: string;
    referenceNumber?: string;
    notes?: string;
  }) => void;
}) {
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");

  useMemo(() => {
    if (bill) {
      // Pre-filling the full outstanding amount is the common case — a supplier
      // is usually paid in full — and it removes a transcription error.
      setAmount(String(bill.dueAmount));
      setPaymentMethod("CASH");
      setReferenceNumber("");
      setNotes("");
    }
  }, [bill]);

  if (!bill) return null;

  const parsed = amount === "" ? null : Math.round(Number(amount) * 100) / 100;
  const overpays = parsed !== null && parsed > bill.dueAmount;
  const canSubmit =
    parsed !== null && Number.isFinite(parsed) && parsed > 0 && !overpays && !isSubmitting;

  return (
    <Modal open onClose={onClose} title="Record Supplier Payment" size="md">
      <div className="space-y-4">
        <Card className="bg-muted/40">
          <CardContent className="space-y-1 py-3 text-sm">
            <p className="font-medium">{bill.supplier?.businessName}</p>
            <p className="text-xs text-muted-foreground">
              {bill.purchaseNumber}
              {bill.supplierInvoiceNumber ? ` · ${bill.supplierInvoiceNumber}` : ""}
            </p>
            <div className="flex gap-4 pt-1">
              <span className="text-xs">
                <span className="text-muted-foreground">Bill total </span>
                <span className="font-medium tabular-nums">
                  {formatCurrencyExact(bill.totalAmount)}
                </span>
              </span>
              <span className="text-xs">
                <span className="text-muted-foreground">Outstanding </span>
                <span className="font-medium tabular-nums">
                  {formatCurrencyExact(bill.dueAmount)}
                </span>
              </span>
            </div>
          </CardContent>
        </Card>

        <div>
          <Input
            label="Amount (₹)"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isSubmitting}
            autoFocus
          />
          {overpays && (
            <p className="mt-1 text-xs text-destructive">
              This exceeds the {formatCurrencyExact(bill.dueAmount)} still due. Overpaying a bill
              is almost always a mis-key — record an on-account payment instead if it is
              intentional.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="Payment method"
            options={Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            disabled={isSubmitting}
          />
          <Input
            label="Reference (optional)"
            value={referenceNumber}
            onChange={(e) => setReferenceNumber(e.target.value)}
            placeholder="UTR / cheque no."
            disabled={isSubmitting}
          />
        </div>

        <Input
          label="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={isSubmitting}
        />

        {paymentMethod === "CASH" && (
          <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/25 dark:text-blue-200">
            Paid in cash: if you have a register open, this is deducted from your drawer.
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                amount: parsed!,
                paymentMethod,
                ...(referenceNumber.trim() ? { referenceNumber: referenceNumber.trim() } : {}),
                ...(notes.trim() ? { notes: notes.trim() } : {}),
              })
            }
          >
            <Banknote className="mr-1.5 h-4 w-4" />
            {isSubmitting ? "Recording…" : "Record Payment"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// =============================================================================
// DUE DATE
// =============================================================================

function DueDateDialog({
  bill,
  onClose,
  isSubmitting,
  onSubmit,
}: {
  bill: PayableBill | null;
  onClose: () => void;
  isSubmitting: boolean;
  onSubmit: (dueDate: string | null) => void;
}) {
  const [dueDate, setDueDate] = useState("");

  useMemo(() => {
    if (bill) setDueDate(bill.dueDate ? bill.dueDate.slice(0, 10) : "");
  }, [bill]);

  if (!bill) return null;

  return (
    <Modal open onClose={onClose} title="Set payment due date" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {bill.purchaseNumber} · {bill.supplier?.businessName}
        </p>

        <Input
          label="Due date"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          disabled={isSubmitting}
          autoFocus
        />

        <p className="text-xs text-muted-foreground">
          A bill with no due date is never treated as overdue. Clearing the date removes it from
          the ageing report.
        </p>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          {bill.dueDate && (
            <Button variant="ghost" disabled={isSubmitting} onClick={() => onSubmit(null)}>
              Clear
            </Button>
          )}
          <Button
            disabled={isSubmitting || dueDate === ""}
            onClick={() => onSubmit(new Date(dueDate).toISOString())}
          >
            {isSubmitting ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
