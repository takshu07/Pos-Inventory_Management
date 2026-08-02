/**
 * Expense management, with the approval workflow.
 *
 * NO DELETE BUTTON — ANYWHERE, FOR ANY ROLE.
 *
 * That absence is the module's central control, so the UI states it rather
 * than leaving a user hunting for a menu item that does not exist. A wrong
 * expense is REJECTED (it leaves the P&L, the record stands) or CORRECTED with
 * an offsetting entry. Both leave an audit trail; deletion would not.
 */

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleDollarSign,
  Clock,
  Plus,
  Receipt,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import { Badge, Button, Card, CardContent, Input, Modal, Select } from "@/components/ui";
import {
  APPROVAL_STATUS_LABELS,
  APPROVAL_STATUS_VARIANTS,
  DebouncedSearch,
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
  formatDate,
  formatNumber,
  DEFAULT_FILTERS,
  type ReportColumn,
  type ReportFilterState,
} from "@/components/shared/bi";

import {
  useExpenses,
  useExpenseCategories,
  useCreateExpense,
  useReviewExpense,
} from "../hooks/useFinance";
import type { Expense, ExpenseParams } from "../types";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "PENDING", label: "Pending approval" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
];

const METHOD_OPTIONS = [
  { value: "", label: "All methods" },
  ...Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label })),
];

/** The expense table's own filter/paging state. */
type TableParams = Pick<
  ExpenseParams,
  | "page"
  | "limit"
  | "search"
  | "categoryId"
  | "employeeId"
  | "paymentMethod"
  | "approvalStatus"
  | "minAmount"
  | "maxAmount"
  | "sortBy"
  | "sortOrder"
>;

export default function ExpensesPage() {
  const [filters, setFilters] = useState<ReportFilterState>(DEFAULT_FILTERS);

  // The table's own state, kept separate from the shared period filter bar.
  // Declared explicitly rather than as Omit<ExpenseParams, keyof ReportFilterState>:
  // that Omit would also strip categoryId and paymentMethod, which this table
  // owns even though the shared bar happens to declare fields of the same name.
  const [table, setTable] = useState<TableParams>({
    page: 1,
    limit: 25,
    sortBy: "expenseDate",
    sortOrder: "desc",
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [reviewing, setReviewing] = useState<Expense | null>(null);

  const params = { ...cleanFilters(filters), ...table } as ExpenseParams;
  const { data, isLoading } = useExpenses(params);
  const categories = useExpenseCategories();
  const createExpense = useCreateExpense();
  const reviewExpense = useReviewExpense();

  const setTableFilter = (patch: Partial<ExpenseParams>) =>
    setTable((prev) => ({ ...prev, ...patch, page: 1 }));

  const summary = data?.summary;

  const columns: Array<ReportColumn<Expense>> = [
    {
      key: "expenseCode",
      header: "Code",
      locked: true,
      width: 150,
      render: (row) => <span className="font-medium">{row.expenseCode}</span>,
    },
    {
      key: "expenseDate",
      header: "Date",
      sortKey: "expenseDate",
      width: 120,
      render: (row) => formatDate(row.expenseDate),
    },
    {
      key: "title",
      header: "Title",
      sortKey: "title",
      width: 220,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate">{row.title}</p>
          {row.vendorName && (
            <p className="truncate text-xs text-muted-foreground">{row.vendorName}</p>
          )}
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      width: 150,
      render: (row) => (
        <span className="inline-flex items-center gap-1.5">
          {row.category?.name ?? "—"}
          {row.category?.isRecurring && <Badge variant="outline">Recurring</Badge>}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      sortKey: "amount",
      align: "right",
      width: 130,
      render: (row) => formatCurrencyExact(row.amount),
      footer: formatCurrencyExact(summary?.totalAmount ?? 0),
    },
    {
      key: "paymentMethod",
      header: "Method",
      width: 100,
      render: (row) => PAYMENT_METHOD_LABELS[row.paymentMethod] ?? row.paymentMethod,
    },
    {
      key: "approvalStatus",
      header: "Status",
      width: 130,
      render: (row) => (
        <Badge variant={APPROVAL_STATUS_VARIANTS[row.approvalStatus] ?? "secondary"}>
          {APPROVAL_STATUS_LABELS[row.approvalStatus] ?? row.approvalStatus}
        </Badge>
      ),
    },
    {
      key: "employee",
      header: "Recorded By",
      defaultHidden: true,
      render: (row) => row.employee?.name ?? "—",
    },
    {
      key: "approvedBy",
      header: "Approved By",
      defaultHidden: true,
      render: (row) => row.approvedBy?.name ?? "—",
    },
    {
      key: "reference",
      header: "Reference",
      defaultHidden: true,
      render: (row) => row.referenceNumber ?? "—",
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: 130,
      render: (row) =>
        row.approvalStatus === "PENDING" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              setReviewing(row);
            }}
          >
            Review
          </Button>
        ) : row.rejectionReason ? (
          <span className="text-xs text-muted-foreground" title={row.rejectionReason}>
            Rejected
          </span>
        ) : null,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Expenses"
        description="Only APPROVED expenses count towards profit. Pending ones are recorded but excluded from the P&L until someone signs them off."
        actions={
          <>
            <ExportMenu path="/finance/export/expenses" filters={params as Record<string, unknown>} />
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Record Expense
            </Button>
          </>
        }
      />

      <FilterBar value={filters} onChange={setFilters} isLoading={isLoading} />

      <KpiGrid columns={4}>
        <KpiCard
          label="Total Expenses"
          value={summary?.totalAmount ?? 0}
          format={formatCurrency}
          icon={CircleDollarSign}
          hint={`${formatNumber(summary?.count ?? 0)} records`}
        />
        <KpiCard
          label="Approved"
          value={summary?.approved.amount ?? 0}
          format={formatCurrency}
          icon={CheckCircle2}
          accent="success"
          hint={`${formatNumber(summary?.approved.count ?? 0)} expenses · counts in the P&L`}
        />
        <KpiCard
          label="Pending Approval"
          value={summary?.pending.amount ?? 0}
          format={formatCurrency}
          icon={Clock}
          accent={(summary?.pending.count ?? 0) > 0 ? "warning" : "default"}
          hint={`${formatNumber(summary?.pending.count ?? 0)} awaiting review`}
        />
        <KpiCard
          label="Rejected"
          value={summary?.rejected.amount ?? 0}
          format={formatCurrency}
          icon={XCircle}
          hint={`${formatNumber(summary?.rejected.count ?? 0)} excluded from profit`}
        />
      </KpiGrid>

      {/* ── Secondary filters ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <DebouncedSearch
          value={table.search ?? ""}
          onChange={(search) => setTableFilter({ search: search || undefined })}
          placeholder="Code, title, vendor or reference…"
          className="w-full sm:w-72"
        />

        <div className="w-full sm:w-48">
          <Select
            label="Category"
            options={[
              { value: "", label: "All categories" },
              ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name })),
            ]}
            value={table.categoryId ?? ""}
            onChange={(e) => setTableFilter({ categoryId: e.target.value || undefined })}
          />
        </div>

        <div className="w-full sm:w-44">
          <Select
            label="Status"
            options={STATUS_OPTIONS}
            value={table.approvalStatus ?? ""}
            onChange={(e) =>
              setTableFilter({
                approvalStatus: (e.target.value || undefined) as ExpenseParams["approvalStatus"],
              })
            }
          />
        </div>

        <div className="w-full sm:w-40">
          <Select
            label="Method"
            options={METHOD_OPTIONS}
            value={table.paymentMethod ?? ""}
            onChange={(e) =>
              setTableFilter({
                paymentMethod: (e.target.value || undefined) as ExpenseParams["paymentMethod"],
              })
            }
          />
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            setTable({ page: 1, limit: 25, sortBy: "expenseDate", sortOrder: "desc" })
          }
        >
          Reset
        </Button>
      </div>

      <ReportTable
        columns={columns}
        rows={data?.data ?? []}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        storageKey="finance-expenses"
        showFooter
        total={data?.total}
        page={table.page ?? 1}
        totalPages={data?.totalPages ?? 1}
        onPageChange={(page) => setTable((prev) => ({ ...prev, page }))}
        sortBy={table.sortBy}
        sortOrder={table.sortOrder}
        onSortChange={(sortBy, sortOrder) =>
          setTable((prev) => ({
            ...prev,
            sortBy: sortBy as ExpenseParams["sortBy"],
            sortOrder,
            page: 1,
          }))
        }
        emptyTitle="No expenses"
        emptyMessage="Nothing matched these filters. Try a wider date range or clear the status filter."
      />

      <Card className="bg-muted/40">
        <CardContent className="flex items-start gap-2.5 py-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-xs text-muted-foreground">
            Financial history is never deleted. An approved expense cannot be edited — record a
            correcting entry instead, so both the original and the correction remain visible to
            an audit.
          </p>
        </CardContent>
      </Card>

      <CreateExpenseDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        categories={categories.data ?? []}
        isSubmitting={createExpense.isPending}
        onSubmit={(payload) =>
          createExpense.mutate(payload, { onSuccess: () => setCreateOpen(false) })
        }
      />

      <ReviewExpenseDialog
        expense={reviewing}
        onClose={() => setReviewing(null)}
        isSubmitting={reviewExpense.isPending}
        onSubmit={(decision, rejectionReason) =>
          reviewing &&
          reviewExpense.mutate(
            { id: reviewing.id, decision, ...(rejectionReason ? { rejectionReason } : {}) },
            { onSuccess: () => setReviewing(null) }
          )
        }
      />
    </div>
  );
}

// =============================================================================
// CREATE
// =============================================================================

function CreateExpenseDialog({
  open,
  onClose,
  categories,
  isSubmitting,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  categories: Array<{ id: string; name: string }>;
  isSubmitting: boolean;
  onSubmit: (payload: {
    categoryId: string;
    title: string;
    amount: number;
    vendorName?: string;
    paymentMethod?: string;
    referenceNumber?: string;
    notes?: string;
    expenseDate?: string;
    requiresApproval?: boolean;
  }) => void;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [requiresApproval, setRequiresApproval] = useState(false);

  useMemo(() => {
    if (open && !categoryId && categories.length > 0) setCategoryId(categories[0]!.id);
  }, [open, categories, categoryId]);

  const parsed = amount === "" ? null : Math.round(Number(amount) * 100) / 100;
  const canSubmit =
    Boolean(categoryId) &&
    title.trim().length >= 3 &&
    parsed !== null &&
    Number.isFinite(parsed) &&
    parsed > 0 &&
    !isSubmitting;

  return (
    <Modal open={open} onClose={onClose} title="Record Expense" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="Category"
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={isSubmitting}
          />
          <Input
            label="Amount (₹)"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            disabled={isSubmitting}
          />
        </div>

        <Input
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Monthly shop rent"
          disabled={isSubmitting}
          autoFocus
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            label="Vendor (optional)"
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
            disabled={isSubmitting}
          />
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
            label="Date"
            type="date"
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
            disabled={isSubmitting}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Reference (optional)"
            value={referenceNumber}
            onChange={(e) => setReferenceNumber(e.target.value)}
            placeholder="Bill / invoice no."
            disabled={isSubmitting}
          />
          <Input
            label="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isSubmitting}
          />
        </div>

        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 text-sm">
          <input
            type="checkbox"
            checked={requiresApproval}
            onChange={(e) => setRequiresApproval(e.target.checked)}
            disabled={isSubmitting}
            className="mt-0.5 h-4 w-4 rounded border-border"
          />
          <span>
            <span className="font-medium">Submit for approval</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              The expense is recorded but excluded from the P&L until approved. Leave unticked to
              record it as already authorised — which is what an owner recording their own costs
              wants.
            </span>
          </span>
        </label>

        {paymentMethod === "CASH" && !requiresApproval && (
          <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/25 dark:text-blue-200">
            Paid in cash: if you have a register open, this amount will be deducted from your
            drawer automatically.
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
                categoryId,
                title: title.trim(),
                amount: parsed!,
                paymentMethod,
                expenseDate: new Date(expenseDate).toISOString(),
                requiresApproval,
                ...(vendorName.trim() ? { vendorName: vendorName.trim() } : {}),
                ...(referenceNumber.trim() ? { referenceNumber: referenceNumber.trim() } : {}),
                ...(notes.trim() ? { notes: notes.trim() } : {}),
              })
            }
          >
            <Receipt className="mr-1.5 h-4 w-4" />
            {isSubmitting ? "Recording…" : "Record Expense"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// =============================================================================
// REVIEW
// =============================================================================

function ReviewExpenseDialog({
  expense,
  onClose,
  isSubmitting,
  onSubmit,
}: {
  expense: Expense | null;
  onClose: () => void;
  isSubmitting: boolean;
  onSubmit: (decision: "APPROVE" | "REJECT", rejectionReason?: string) => void;
}) {
  const [rejectionReason, setRejectionReason] = useState("");

  useMemo(() => {
    if (expense) setRejectionReason("");
  }, [expense]);

  if (!expense) return null;

  return (
    <Modal open onClose={onClose} title="Review Expense" size="md">
      <div className="space-y-4">
        <Card className="bg-muted/40">
          <CardContent className="space-y-1 py-3 text-sm">
            <p className="font-medium">{expense.title}</p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatCurrencyExact(expense.amount)}
            </p>
            <p className="text-xs text-muted-foreground">
              {expense.expenseCode} · {expense.category?.name ?? "—"} ·{" "}
              {formatDate(expense.expenseDate)}
            </p>
            {expense.vendorName && (
              <p className="text-xs text-muted-foreground">Vendor: {expense.vendorName}</p>
            )}
            {expense.employee && (
              <p className="text-xs text-muted-foreground">
                Raised by {expense.employee.name}
              </p>
            )}
          </CardContent>
        </Card>

        <div>
          <Input
            label="Rejection reason (required to reject)"
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            placeholder="Why is this being rejected?"
            disabled={isSubmitting}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Approving adds this to the P&L. If it was paid in cash from an open drawer, the cash
            is deducted at approval — not before, because a pending expense has not been paid.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={isSubmitting || rejectionReason.trim().length < 3}
            onClick={() => onSubmit("REJECT", rejectionReason.trim())}
          >
            <XCircle className="mr-1.5 h-4 w-4" />
            Reject
          </Button>
          <Button
            variant="success"
            disabled={isSubmitting}
            onClick={() => onSubmit("APPROVE")}
          >
            <CheckCircle2 className="mr-1.5 h-4 w-4" />
            {isSubmitting ? "Saving…" : "Approve"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
