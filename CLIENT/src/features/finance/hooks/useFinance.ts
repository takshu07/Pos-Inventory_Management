/**
 * Finance — React Query bindings.
 *
 * CACHING POSTURE
 * ---------------
 * Analytical queries (dashboard, P&L, cash flow) carry a 60-second staleTime.
 * They are expensive multi-aggregate queries and their inputs — yesterday's
 * sales — do not change second to second. A shorter window would re-run six
 * grouped joins every time an owner switched tabs.
 *
 * Mutations invalidate BROADLY. Approving an expense changes the expense list,
 * the P&L, the cash flow and the dashboard; enumerating each key per mutation
 * is how one of them eventually gets forgotten and a screen shows a figure that
 * is no longer true.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import * as api from "../api/financeApi";
import type {
  ExpenseParams,
  PayablesParams,
  PeriodParams,
  SalaryParams,
  SupplierPaymentParams,
} from "../types";

const ANALYTICS_STALE_MS = 60_000;

export const financeKeys = {
  all: ["finance"] as const,
  dashboard: (params: PeriodParams) => [...financeKeys.all, "dashboard", params] as const,
  revenue: (params: object) => [...financeKeys.all, "revenue", params] as const,
  profitLoss: (params: object) => [...financeKeys.all, "profit-loss", params] as const,
  cashFlow: (params: object) => [...financeKeys.all, "cash-flow", params] as const,
  paymentAnalytics: (params: object) => [...financeKeys.all, "payments", params] as const,

  expenses: (params: ExpenseParams) => [...financeKeys.all, "expenses", params] as const,
  expense: (id: string) => [...financeKeys.all, "expense", id] as const,
  expenseCategories: () => [...financeKeys.all, "expense-categories"] as const,

  payables: (params: PayablesParams) => [...financeKeys.all, "payables", params] as const,
  supplierPayments: (params: SupplierPaymentParams) =>
    [...financeKeys.all, "supplier-payments", params] as const,
  suppliers: () => [...financeKeys.all, "suppliers"] as const,
  openBills: (supplierId: string) => [...financeKeys.all, "open-bills", supplierId] as const,

  salaries: (params: SalaryParams) => [...financeKeys.all, "salaries", params] as const,
  salary: (id: string) => [...financeKeys.all, "salary", id] as const,
};

function errorMessage(err: unknown, fallback: string): string {
  const anyErr = err as { response?: { data?: { message?: string } }; message?: string };
  return anyErr?.response?.data?.message ?? anyErr?.message ?? fallback;
}

function useInvalidateFinance() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: financeKeys.all });
    // A cash expense or supplier payment moves a drawer, so the register's live
    // position is stale too. Invalidating across module boundaries here is
    // correct: the two modules share one ledger.
    void queryClient.invalidateQueries({ queryKey: ["register"] });
  };
}

// =============================================================================
// ANALYTICS
// =============================================================================

export function useFinanceDashboard(params: PeriodParams) {
  return useQuery({
    queryKey: financeKeys.dashboard(params),
    queryFn: () => api.fetchDashboard(params),
    staleTime: ANALYTICS_STALE_MS,
  });
}

export function useRevenue(params: PeriodParams & { granularity?: string }) {
  return useQuery({
    queryKey: financeKeys.revenue(params),
    queryFn: () => api.fetchRevenue(params),
    staleTime: ANALYTICS_STALE_MS,
  });
}

export function useProfitLoss(
  params: PeriodParams & { granularity?: string; includeBreakdown?: boolean }
) {
  return useQuery({
    queryKey: financeKeys.profitLoss(params),
    queryFn: () => api.fetchProfitLoss(params),
    staleTime: ANALYTICS_STALE_MS,
  });
}

export function useCashFlow(params: PeriodParams & { granularity?: string }) {
  return useQuery({
    queryKey: financeKeys.cashFlow(params),
    queryFn: () => api.fetchCashFlow(params),
    staleTime: ANALYTICS_STALE_MS,
  });
}

export function usePaymentAnalytics(params: PeriodParams & { granularity?: string }) {
  return useQuery({
    queryKey: financeKeys.paymentAnalytics(params),
    queryFn: () => api.fetchPaymentAnalytics(params),
    staleTime: ANALYTICS_STALE_MS,
  });
}

// =============================================================================
// EXPENSES
// =============================================================================

export function useExpenses(params: ExpenseParams) {
  return useQuery({
    queryKey: financeKeys.expenses(params),
    queryFn: () => api.fetchExpenses(params),
    staleTime: 30_000,
  });
}

export function useExpenseCategories() {
  return useQuery({
    queryKey: financeKeys.expenseCategories(),
    queryFn: api.fetchExpenseCategories,
    // Categories are administrative data that changes a few times a year.
    staleTime: 10 * 60_000,
  });
}

export function useCreateExpense() {
  const invalidate = useInvalidateFinance();

  return useMutation({
    mutationFn: (payload: api.CreateExpensePayload) => api.createExpense(payload),
    onSuccess: (expense) => {
      invalidate();
      toast.success(
        expense.approvalStatus === "PENDING"
          ? "Expense submitted for approval."
          : `Expense ${expense.expenseCode} recorded.`
      );
    },
    onError: (err) => toast.error(errorMessage(err, "Could not record the expense.")),
  });
}

export function useUpdateExpense() {
  const invalidate = useInvalidateFinance();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<api.CreateExpensePayload> }) =>
      api.updateExpense(id, payload),
    onSuccess: () => {
      invalidate();
      toast.success("Expense updated.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not update the expense.")),
  });
}

export function useReviewExpense() {
  const invalidate = useInvalidateFinance();

  return useMutation({
    mutationFn: ({
      id,
      decision,
      rejectionReason,
    }: {
      id: string;
      decision: "APPROVE" | "REJECT";
      rejectionReason?: string;
    }) => api.reviewExpense(id, decision, rejectionReason),
    onSuccess: (_data, variables) => {
      invalidate();
      toast.success(variables.decision === "APPROVE" ? "Expense approved." : "Expense rejected.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not review the expense.")),
  });
}

export function useCreateExpenseCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createExpenseCategory,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeKeys.expenseCategories() });
      toast.success("Expense category created.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not create the category.")),
  });
}

// =============================================================================
// PAYABLES
// =============================================================================

export function usePayables(params: PayablesParams) {
  return useQuery({
    queryKey: financeKeys.payables(params),
    queryFn: () => api.fetchPayables(params),
    staleTime: 30_000,
  });
}

export function useSupplierPayments(params: SupplierPaymentParams) {
  return useQuery({
    queryKey: financeKeys.supplierPayments(params),
    queryFn: () => api.fetchSupplierPayments(params),
    staleTime: 30_000,
  });
}

export function useFinanceSuppliers() {
  return useQuery({
    queryKey: financeKeys.suppliers(),
    queryFn: api.fetchSuppliers,
    staleTime: 10 * 60_000,
  });
}

export function useOpenBills(supplierId: string | undefined) {
  return useQuery({
    queryKey: financeKeys.openBills(supplierId ?? ""),
    queryFn: () => api.fetchOpenBills(supplierId!),
    enabled: Boolean(supplierId),
  });
}

export function useRecordSupplierPayment() {
  const invalidate = useInvalidateFinance();

  return useMutation({
    mutationFn: api.recordSupplierPayment,
    onSuccess: (payment) => {
      invalidate();
      toast.success(`Payment ${payment.paymentNumber} recorded.`);
    },
    onError: (err) => toast.error(errorMessage(err, "Could not record the payment.")),
  });
}

export function useSetBillDueDate() {
  const invalidate = useInvalidateFinance();

  return useMutation({
    mutationFn: ({ purchaseId, dueDate }: { purchaseId: string; dueDate: string | null }) =>
      api.setBillDueDate(purchaseId, dueDate),
    onSuccess: () => {
      invalidate();
      toast.success("Due date updated.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not update the due date.")),
  });
}

// =============================================================================
// PAYROLL
// =============================================================================

export function useSalaries(params: SalaryParams) {
  return useQuery({
    queryKey: financeKeys.salaries(params),
    queryFn: () => api.fetchSalaries(params),
    staleTime: 30_000,
  });
}

export function useSalary(id: string | undefined) {
  return useQuery({
    queryKey: financeKeys.salary(id ?? ""),
    queryFn: () => api.fetchSalary(id!),
    enabled: Boolean(id),
  });
}

export function useGeneratePayroll() {
  const invalidate = useInvalidateFinance();

  return useMutation({
    mutationFn: api.generatePayroll,
    onSuccess: (result) => {
      invalidate();
      if (result.generated === 0) {
        // Not an error — payroll is idempotent, and re-running a completed
        // month is a legitimate thing to do. Saying so beats a silent success.
        toast.info("Payroll was already generated for this period.");
      } else {
        toast.success(
          `Payroll generated for ${result.generated} employee${result.generated === 1 ? "" : "s"}.` +
            (result.skipped.length > 0 ? ` ${result.skipped.length} already existed.` : "")
        );
      }
    },
    onError: (err) => toast.error(errorMessage(err, "Could not generate payroll.")),
  });
}

export function useAddSalaryAdjustment() {
  const invalidate = useInvalidateFinance();

  return useMutation({
    mutationFn: ({
      salaryId,
      payload,
    }: {
      salaryId: string;
      payload: { type: string; amount: number; reason: string };
    }) => api.addSalaryAdjustment(salaryId, payload),
    onSuccess: () => {
      invalidate();
      toast.success("Adjustment recorded.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not record the adjustment.")),
  });
}

export function usePaySalary() {
  const invalidate = useInvalidateFinance();

  return useMutation({
    mutationFn: ({
      salaryId,
      payload,
    }: {
      salaryId: string;
      payload: {
        amount: number;
        paymentMethod?: string;
        referenceNumber?: string;
        notes?: string;
      };
    }) => api.paySalary(salaryId, payload),
    onSuccess: (salary) => {
      invalidate();
      toast.success(salary.status === "PAID" ? "Salary paid in full." : "Part payment recorded.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not record the payment.")),
  });
}
