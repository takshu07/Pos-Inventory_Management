/**
 * Salary management.
 *
 * PAYROLL IS GENERATED, NOT TYPED.
 *
 * An owner picks a month and the system creates one row per eligible employee
 * from their salary on file. That is idempotent — re-running a month skips
 * anyone who already has a row — so a half-failed run is fixed by running it
 * again rather than by hunting for what landed.
 *
 * Adjustments (advance, bonus, deduction) are ITEMISED rather than folded into
 * a single net figure, because a payslip that shows only "₹27,400" is one an
 * employee cannot check.
 */

import { useMemo, useState } from "react";
import {
  Banknote,
  CalendarDays,
  Coins,
  Plus,
  TrendingDown,
  Users,
  Wallet,
} from "lucide-react";

import { Badge, Button, Card, CardContent, Input, Modal, Select } from "@/components/ui";
import {
  DebouncedSearch,
  ExportMenu,
  KpiCard,
  KpiGrid,
  PageHeader,
  PAYMENT_METHOD_LABELS,
  ReportTable,
  SALARY_ADJUSTMENT_LABELS,
  SALARY_ADJUSTMENT_SIGN,
  SALARY_STATUS_LABELS,
  SALARY_STATUS_VARIANTS,
  StatRow,
  formatCurrency,
  formatCurrencyExact,
  formatDate,
  formatNumber,
  type ReportColumn,
} from "@/components/shared/bi";
import { cn } from "@/utils/cn";

import {
  useAddSalaryAdjustment,
  useGeneratePayroll,
  usePaySalary,
  useSalaries,
  useSalary,
} from "../hooks/useFinance";
import type { SalaryParams, SalaryRecord } from "../types";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "PENDING", label: "Pending" },
  { value: "PARTIALLY_PAID", label: "Part paid" },
  { value: "PAID", label: "Paid" },
];

export default function SalariesPage() {
  const now = new Date();

  const [params, setParams] = useState<SalaryParams>({
    page: 1,
    limit: 25,
    periodYear: now.getFullYear(),
    periodMonth: now.getMonth() + 1,
  });

  const [generateOpen, setGenerateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data, isLoading } = useSalaries(params);
  const generatePayroll = useGeneratePayroll();

  const setFilter = (patch: Partial<SalaryParams>) =>
    setParams((prev) => ({ ...prev, ...patch, page: 1 }));

  const summary = data?.summary;

  const yearOptions = useMemo(() => {
    const current = now.getFullYear();
    return [
      { value: "", label: "All years" },
      ...Array.from({ length: 5 }, (_, i) => {
        const y = current - i;
        return { value: String(y), label: String(y) };
      }),
    ];
  }, [now]);

  const monthOptions = [
    { value: "", label: "All months" },
    ...MONTHS.map((label, i) => ({ value: String(i + 1), label })),
  ];

  const columns: Array<ReportColumn<SalaryRecord>> = [
    {
      key: "employee",
      header: "Employee",
      locked: true,
      width: 190,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.employee?.name ?? "—"}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.employee?.employeeCode} · {row.employee?.role}
          </p>
        </div>
      ),
    },
    {
      key: "period",
      header: "Period",
      width: 120,
      render: (row) => row.period.label,
    },
    {
      key: "paymentNumber",
      header: "Payslip",
      width: 150,
      defaultHidden: true,
      render: (row) => row.paymentNumber,
    },
    {
      key: "baseSalary",
      header: "Base",
      align: "right",
      render: (row) => formatCurrencyExact(row.baseSalary),
      footer: formatCurrencyExact(summary?.totalBase ?? 0),
    },
    {
      key: "totalBonus",
      header: "Bonus",
      align: "right",
      render: (row) =>
        row.totalBonus > 0 ? (
          <span className="text-emerald-600 dark:text-emerald-400">
            +{formatCurrencyExact(row.totalBonus)}
          </span>
        ) : (
          "—"
        ),
      footer: formatCurrencyExact(summary?.totalBonus ?? 0),
    },
    {
      key: "totalAdvance",
      header: "Advance",
      align: "right",
      render: (row) =>
        row.totalAdvance > 0 ? (
          <span className="text-red-600 dark:text-red-400">
            −{formatCurrencyExact(row.totalAdvance)}
          </span>
        ) : (
          "—"
        ),
      footer: formatCurrencyExact(summary?.totalAdvance ?? 0),
    },
    {
      key: "totalDeduction",
      header: "Deduction",
      align: "right",
      defaultHidden: true,
      render: (row) =>
        row.totalDeduction > 0 ? (
          <span className="text-red-600 dark:text-red-400">
            −{formatCurrencyExact(row.totalDeduction)}
          </span>
        ) : (
          "—"
        ),
      footer: formatCurrencyExact(summary?.totalDeduction ?? 0),
    },
    {
      key: "netPayable",
      header: "Net Payable",
      align: "right",
      render: (row) => (
        <span className="font-semibold">{formatCurrencyExact(row.netPayable)}</span>
      ),
      footer: formatCurrencyExact(summary?.totalNetPayable ?? 0),
    },
    {
      key: "paidAmount",
      header: "Paid",
      align: "right",
      render: (row) => formatCurrencyExact(row.paidAmount),
      footer: formatCurrencyExact(summary?.totalPaid ?? 0),
    },
    {
      key: "dueAmount",
      header: "Due",
      align: "right",
      render: (row) => (
        <span className={cn(row.dueAmount > 0 && "font-semibold text-amber-700 dark:text-amber-400")}>
          {formatCurrencyExact(row.dueAmount)}
        </span>
      ),
      footer: formatCurrencyExact(summary?.totalDue ?? 0),
    },
    {
      key: "status",
      header: "Status",
      width: 120,
      render: (row) => (
        <Badge variant={SALARY_STATUS_VARIANTS[row.status] ?? "secondary"}>
          {SALARY_STATUS_LABELS[row.status] ?? row.status}
        </Badge>
      ),
    },
    {
      key: "paidAt",
      header: "Paid On",
      width: 120,
      defaultHidden: true,
      render: (row) => (row.paidAt ? formatDate(row.paidAt) : "—"),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Salaries"
        description="Generate payroll for a month, itemise advances and bonuses, then disburse. Every payment also records an expense, so payroll shows up in the P&L exactly once."
        actions={
          <>
            <ExportMenu
              path="/finance/export/salaries"
              filters={params as Record<string, unknown>}
            />
            <Button size="sm" onClick={() => setGenerateOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Generate Payroll
            </Button>
          </>
        }
      />

      <KpiGrid columns={4}>
        <KpiCard
          label="Net Payable"
          value={summary?.totalNetPayable ?? 0}
          format={formatCurrency}
          icon={Users}
          hint={`${formatNumber(summary?.count ?? 0)} payslips`}
        />
        <KpiCard
          label="Paid"
          value={summary?.totalPaid ?? 0}
          format={formatCurrency}
          icon={Banknote}
          accent="success"
        />
        <KpiCard
          label="Outstanding"
          value={summary?.totalDue ?? 0}
          format={formatCurrency}
          icon={Wallet}
          accent={(summary?.totalDue ?? 0) > 0 ? "warning" : "success"}
        />
        <KpiCard
          label="Advances Given"
          value={summary?.totalAdvance ?? 0}
          format={formatCurrency}
          icon={TrendingDown}
          hint="Already handed over, deducted at settlement"
        />
      </KpiGrid>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <DebouncedSearch
          value={params.search ?? ""}
          onChange={(search) => setFilter({ search: search || undefined })}
          placeholder="Employee name, code or payslip number…"
          className="w-full sm:w-72"
        />

        <div className="w-full sm:w-36">
          <Select
            label="Year"
            options={yearOptions}
            value={params.periodYear ? String(params.periodYear) : ""}
            onChange={(e) =>
              setFilter({ periodYear: e.target.value ? Number(e.target.value) : undefined })
            }
          />
        </div>

        <div className="w-full sm:w-40">
          <Select
            label="Month"
            options={monthOptions}
            value={params.periodMonth ? String(params.periodMonth) : ""}
            onChange={(e) =>
              setFilter({ periodMonth: e.target.value ? Number(e.target.value) : undefined })
            }
          />
        </div>

        <div className="w-full sm:w-40">
          <Select
            label="Status"
            options={STATUS_OPTIONS}
            value={params.status ?? ""}
            onChange={(e) =>
              setFilter({ status: (e.target.value || undefined) as SalaryParams["status"] })
            }
          />
        </div>

        <Button variant="ghost" size="sm" onClick={() => setParams({ page: 1, limit: 25 })}>
          Reset
        </Button>
      </div>

      <ReportTable
        columns={columns}
        rows={data?.data ?? []}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        storageKey="finance-salaries"
        showFooter
        total={data?.total}
        page={params.page ?? 1}
        totalPages={data?.totalPages ?? 1}
        onPageChange={(page) => setParams((prev) => ({ ...prev, page }))}
        onRowClick={(row) => setDetailId(row.id)}
        emptyTitle="No payroll for this period"
        emptyMessage="Generate payroll for the selected month, or widen the filters."
      />

      <GeneratePayrollDialog
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        isSubmitting={generatePayroll.isPending}
        onSubmit={(payload) =>
          generatePayroll.mutate(payload, {
            onSuccess: (result) => {
              setGenerateOpen(false);
              setFilter({ periodYear: result.period.year, periodMonth: result.period.month });
            },
          })
        }
      />

      <SalaryDetailDrawer salaryId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

// =============================================================================
// GENERATE PAYROLL
// =============================================================================

function GeneratePayrollDialog({
  open,
  onClose,
  isSubmitting,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  isSubmitting: boolean;
  onSubmit: (payload: { periodYear: number; periodMonth: number }) => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  return (
    <Modal open={open} onClose={onClose} title="Generate Payroll" size="md">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Creates one payslip per active employee who has a salary on file, using their current
          salary as the base. Employees who already have a payslip for this month are skipped —
          running this twice is safe.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Month"
            options={MONTHS.map((label, i) => ({ value: String(i + 1), label }))}
            value={String(month)}
            onChange={(e) => setMonth(Number(e.target.value))}
            disabled={isSubmitting}
          />
          <Select
            label="Year"
            options={Array.from({ length: 5 }, (_, i) => {
              const y = now.getFullYear() - i;
              return { value: String(y), label: String(y) };
            })}
            value={String(year)}
            onChange={(e) => setYear(Number(e.target.value))}
            disabled={isSubmitting}
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            disabled={isSubmitting}
            onClick={() => onSubmit({ periodYear: year, periodMonth: month })}
          >
            <CalendarDays className="mr-1.5 h-4 w-4" />
            {isSubmitting ? "Generating…" : "Generate"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// =============================================================================
// SALARY DETAIL
// =============================================================================

function SalaryDetailDrawer({
  salaryId,
  onClose,
}: {
  salaryId: string | null;
  onClose: () => void;
}) {
  const { data: salary, isLoading } = useSalary(salaryId ?? undefined);
  const addAdjustment = useAddSalaryAdjustment();
  const paySalary = usePaySalary();

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  if (!salaryId) return null;

  return (
    <>
      <Modal open onClose={onClose} title="Payslip" size="lg">
        {isLoading || !salary ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Loading payslip…</p>
        ) : (
          <div className="space-y-4">
            <Card className="bg-muted/40">
              <CardContent className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{salary.employee?.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {salary.employee?.employeeCode} · {salary.employee?.role}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {salary.paymentNumber} · {salary.period.label}
                  </p>
                </div>
                <Badge variant={SALARY_STATUS_VARIANTS[salary.status] ?? "secondary"}>
                  {SALARY_STATUS_LABELS[salary.status] ?? salary.status}
                </Badge>
              </CardContent>
            </Card>

            {/* ── The payslip arithmetic ─────────────────────────────────── */}
            <div className="space-y-0.5">
              <StatRow label="Base salary" value={formatCurrencyExact(salary.baseSalary)} />
              {salary.totalBonus > 0 && (
                <StatRow
                  label="Bonus"
                  value={`+${formatCurrencyExact(salary.totalBonus)}`}
                  tone="positive"
                />
              )}
              {(salary.totalOvertime ?? 0) > 0 && (
                <StatRow
                  label="Overtime"
                  value={`+${formatCurrencyExact(salary.totalOvertime!)}`}
                  tone="positive"
                />
              )}
              {(salary.totalIncentive ?? 0) > 0 && (
                <StatRow
                  label="Incentive"
                  value={`+${formatCurrencyExact(salary.totalIncentive!)}`}
                  tone="positive"
                />
              )}
              {salary.totalAdvance > 0 && (
                <StatRow
                  label="Less: advances already taken"
                  value={`−${formatCurrencyExact(salary.totalAdvance)}`}
                  tone="negative"
                />
              )}
              {salary.totalDeduction > 0 && (
                <StatRow
                  label="Less: deductions"
                  value={`−${formatCurrencyExact(salary.totalDeduction)}`}
                  tone="negative"
                />
              )}
              <StatRow
                label="Net payable"
                value={formatCurrencyExact(salary.netPayable)}
                emphasis
              />
              <StatRow label="Paid" value={formatCurrencyExact(salary.paidAmount)} />
              <StatRow
                label="Still due"
                value={formatCurrencyExact(salary.dueAmount)}
                emphasis
                tone={salary.dueAmount > 0 ? "negative" : "positive"}
              />
            </div>

            {/* ── Itemised adjustments ───────────────────────────────────── */}
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Adjustments
              </p>
              {(salary.adjustments?.length ?? 0) === 0 ? (
                <p className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
                  No adjustments — the payslip is the base salary alone.
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {salary.adjustments!.map((a) => {
                    const sign = SALARY_ADJUSTMENT_SIGN[a.type] ?? 1;
                    return (
                      <li key={a.id} className="flex items-start justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {SALARY_ADJUSTMENT_LABELS[a.type] ?? a.type}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{a.reason}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(a.createdAt)}
                            {a.createdBy ? ` · ${a.createdBy.name}` : ""}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 font-medium tabular-nums",
                            sign > 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-red-600 dark:text-red-400"
                          )}
                        >
                          {sign > 0 ? "+" : "−"}
                          {formatCurrencyExact(a.amount)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              {salary.status !== "PAID" && salary.status !== "CANCELLED" && (
                <>
                  <Button variant="outline" onClick={() => setAdjustOpen(true)}>
                    <Coins className="mr-1.5 h-4 w-4" />
                    Add Adjustment
                  </Button>
                  <Button onClick={() => setPayOpen(true)}>
                    <Banknote className="mr-1.5 h-4 w-4" />
                    Pay
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </Modal>

      {salary && (
        <>
          <AdjustmentDialog
            open={adjustOpen}
            onClose={() => setAdjustOpen(false)}
            isSubmitting={addAdjustment.isPending}
            onSubmit={(payload) =>
              addAdjustment.mutate(
                { salaryId: salary.id, payload },
                { onSuccess: () => setAdjustOpen(false) }
              )
            }
          />

          <PaySalaryDialog
            open={payOpen}
            onClose={() => setPayOpen(false)}
            dueAmount={salary.dueAmount}
            employeeName={salary.employee?.name ?? ""}
            isSubmitting={paySalary.isPending}
            onSubmit={(payload) =>
              paySalary.mutate(
                { salaryId: salary.id, payload },
                { onSuccess: () => setPayOpen(false) }
              )
            }
          />
        </>
      )}
    </>
  );
}

// =============================================================================
// ADJUSTMENT
// =============================================================================

function AdjustmentDialog({
  open,
  onClose,
  isSubmitting,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  isSubmitting: boolean;
  onSubmit: (payload: { type: string; amount: number; reason: string }) => void;
}) {
  const [type, setType] = useState("BONUS");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  useMemo(() => {
    if (open) {
      setType("BONUS");
      setAmount("");
      setReason("");
    }
  }, [open]);

  const parsed = amount === "" ? null : Math.round(Number(amount) * 100) / 100;
  const canSubmit =
    parsed !== null &&
    Number.isFinite(parsed) &&
    parsed > 0 &&
    reason.trim().length >= 3 &&
    !isSubmitting;

  const sign = SALARY_ADJUSTMENT_SIGN[type] ?? 1;

  return (
    <Modal open={open} onClose={onClose} title="Add Salary Adjustment" size="md">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="Type"
            options={Object.entries(SALARY_ADJUSTMENT_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
            value={type}
            onChange={(e) => setType(e.target.value)}
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
            autoFocus
          />
        </div>

        <p
          className={cn(
            "rounded-lg border px-3 py-2 text-xs",
            sign > 0
              ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-200"
              : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/25 dark:text-amber-200"
          )}
        >
          {sign > 0
            ? "This INCREASES the net payable."
            : "This REDUCES the net payable. Enter the amount as a positive number — the type carries the direction, so a deduction can never be entered as a negative bonus."}
          {type === "ADVANCE" &&
            " An advance is cash handed over now, so it is deducted from your drawer immediately if a register is open."}
        </p>

        <Input
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Diwali bonus / advance requested on 12th"
          disabled={isSubmitting}
        />

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() => onSubmit({ type, amount: parsed!, reason: reason.trim() })}
          >
            {isSubmitting ? "Saving…" : "Add Adjustment"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// =============================================================================
// PAY
// =============================================================================

function PaySalaryDialog({
  open,
  onClose,
  dueAmount,
  employeeName,
  isSubmitting,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  dueAmount: number;
  employeeName: string;
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

  useMemo(() => {
    if (open) {
      setAmount(String(dueAmount));
      setPaymentMethod("CASH");
      setReferenceNumber("");
    }
  }, [open, dueAmount]);

  const parsed = amount === "" ? null : Math.round(Number(amount) * 100) / 100;
  const overpays = parsed !== null && parsed > dueAmount;
  const canSubmit =
    parsed !== null && Number.isFinite(parsed) && parsed > 0 && !overpays && !isSubmitting;

  return (
    <Modal open={open} onClose={onClose} title="Disburse Salary" size="md">
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Due to {employeeName}: </span>
          <span className="font-semibold tabular-nums">{formatCurrencyExact(dueAmount)}</span>
        </div>

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
              This exceeds the {formatCurrencyExact(dueAmount)} still due.
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

        <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/25 dark:text-blue-200">
          Paying also records an expense under the Salary category, which is the single place
          payroll enters the profit &amp; loss. It is not subtracted a second time anywhere.
        </p>

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
              })
            }
          >
            <Banknote className="mr-1.5 h-4 w-4" />
            {isSubmitting ? "Paying…" : "Record Payment"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
