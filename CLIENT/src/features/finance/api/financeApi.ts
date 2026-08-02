/**
 * Finance — transport layer.
 *
 * Every path here is OWNER-only server-side. The client does not attempt to
 * narrow anything: a manager who reaches these functions gets a 403, which is
 * the honest outcome. Hiding the nav is a convenience; the guard is the
 * boundary.
 */

import { apiClient } from "@/lib/api";
import type {
  CashFlowReport,
  Expense,
  ExpenseCategory,
  ExpenseParams,
  ExpenseSummary,
  FinanceDashboard,
  OpenBill,
  Paginated,
  PayableBill,
  PayablesParams,
  PaymentAnalytics,
  PeriodParams,
  ProfitLossReport,
  RevenueReport,
  SalaryParams,
  SalaryRecord,
  SalarySummary,
  SupplierAgeing,
  SupplierPayment,
  SupplierPaymentParams,
} from "../types";

const BASE = "/finance";

function clean<T extends object>(params: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== "" && v !== null && v !== undefined)
  );
}

function toPaginated<T>(response: any, fallbackLimit: number): Paginated<T> {
  const total = response?.meta?.total ?? 0;
  return {
    data: response?.data ?? [],
    total,
    page: response?.meta?.page ?? 1,
    totalPages: response?.meta?.totalPages ?? Math.max(1, Math.ceil(total / fallbackLimit)),
  };
}

// =============================================================================
// DASHBOARD & ANALYTICS
// =============================================================================

export async function fetchDashboard(params: PeriodParams): Promise<FinanceDashboard> {
  const res = await apiClient.get<any>(`${BASE}/dashboard`, { params: clean(params) });
  return res.data;
}

export async function fetchRevenue(
  params: PeriodParams & { granularity?: string }
): Promise<RevenueReport> {
  const res = await apiClient.get<any>(`${BASE}/revenue`, { params: clean(params) });
  return res.data;
}

export async function fetchProfitLoss(
  params: PeriodParams & { granularity?: string; includeBreakdown?: boolean }
): Promise<ProfitLossReport> {
  const res = await apiClient.get<any>(`${BASE}/profit-loss`, { params: clean(params) });
  return res.data;
}

export async function fetchCashFlow(
  params: PeriodParams & { granularity?: string }
): Promise<CashFlowReport> {
  const res = await apiClient.get<any>(`${BASE}/cash-flow`, { params: clean(params) });
  return res.data;
}

export async function fetchPaymentAnalytics(
  params: PeriodParams & { granularity?: string }
): Promise<PaymentAnalytics> {
  const res = await apiClient.get<any>(`${BASE}/payment-analytics`, { params: clean(params) });
  return res.data;
}

// =============================================================================
// EXPENSES
// =============================================================================

export async function fetchExpenses(
  params: ExpenseParams
): Promise<Paginated<Expense> & { summary: ExpenseSummary }> {
  // `any` because the envelope carries a sibling `summary` the AxiosResponse
  // type does not describe — see the note in the register API.
  const res: any = await apiClient.get<any>(`${BASE}/expenses`, { params: clean(params) });
  return {
    ...toPaginated<Expense>(res, params.limit ?? 25),
    summary: res?.summary ?? {
      totalAmount: 0,
      count: 0,
      approved: { amount: 0, count: 0 },
      pending: { amount: 0, count: 0 },
      rejected: { amount: 0, count: 0 },
    },
  };
}

export async function fetchExpense(id: string): Promise<Expense> {
  const res = await apiClient.get<any>(`${BASE}/expenses/${id}`);
  return res.data;
}

export interface CreateExpensePayload {
  categoryId: string;
  title: string;
  amount: number;
  vendorName?: string;
  paymentMethod?: string;
  referenceNumber?: string;
  description?: string;
  notes?: string;
  expenseDate?: string;
  receiptAssetId?: string;
  requiresApproval?: boolean;
}

export async function createExpense(payload: CreateExpensePayload): Promise<Expense> {
  const res = await apiClient.post<any>(`${BASE}/expenses`, clean(payload));
  return res.data;
}

export async function updateExpense(
  id: string,
  payload: Partial<CreateExpensePayload>
): Promise<Expense> {
  const res = await apiClient.patch<any>(`${BASE}/expenses/${id}`, clean(payload));
  return res.data;
}

export async function reviewExpense(
  id: string,
  decision: "APPROVE" | "REJECT",
  rejectionReason?: string
): Promise<Expense> {
  const res = await apiClient.post<any>(`${BASE}/expenses/${id}/review`, {
    decision,
    ...(rejectionReason ? { rejectionReason } : {}),
  });
  return res.data;
}

export async function fetchExpenseCategories(): Promise<ExpenseCategory[]> {
  const res = await apiClient.get<any>(`${BASE}/expense-categories`);
  return res.data ?? [];
}

export async function createExpenseCategory(payload: {
  name: string;
  code?: string;
  displayOrder?: number;
  isRecurring?: boolean;
}): Promise<ExpenseCategory> {
  const res = await apiClient.post<any>(`${BASE}/expense-categories`, clean(payload));
  return res.data;
}

// =============================================================================
// SUPPLIER PAYABLES
// =============================================================================

export async function fetchPayables(
  params: PayablesParams
): Promise<
  Paginated<PayableBill> & {
    summary: { billCount: number; totalAmount: number; paidAmount: number; dueAmount: number };
    bySupplier: SupplierAgeing[];
  }
> {
  const res: any = await apiClient.get<any>(`${BASE}/payables`, { params: clean(params) });
  return {
    ...toPaginated<PayableBill>(res, params.limit ?? 25),
    summary: res?.summary ?? { billCount: 0, totalAmount: 0, paidAmount: 0, dueAmount: 0 },
    bySupplier: res?.bySupplier ?? [],
  };
}

export interface RecordSupplierPaymentPayload {
  supplierId: string;
  purchaseId?: string;
  amount: number;
  paymentMethod?: string;
  referenceNumber?: string;
  notes?: string;
  paidAt?: string;
}

export async function recordSupplierPayment(
  payload: RecordSupplierPaymentPayload
): Promise<SupplierPayment> {
  const res = await apiClient.post<any>(`${BASE}/supplier-payments`, clean(payload));
  return res.data;
}

export async function fetchSupplierPayments(
  params: SupplierPaymentParams
): Promise<Paginated<SupplierPayment> & { summary: { totalAmount: number; count: number } }> {
  const res: any = await apiClient.get<any>(`${BASE}/supplier-payments`, {
    params: clean(params),
  });
  return {
    ...toPaginated<SupplierPayment>(res, params.limit ?? 25),
    summary: res?.summary ?? { totalAmount: 0, count: 0 },
  };
}

export async function setBillDueDate(
  purchaseId: string,
  dueDate: string | null
): Promise<{ id: string; dueDate: string | null; paymentStatus: string; dueAmount: number }> {
  const res = await apiClient.patch<any>(`${BASE}/payables/${purchaseId}/due-date`, { dueDate });
  return res.data;
}

export async function fetchOpenBills(supplierId: string): Promise<OpenBill[]> {
  const res = await apiClient.get<any>(`${BASE}/suppliers/${supplierId}/open-bills`);
  return res.data ?? [];
}

export async function fetchSuppliers(): Promise<
  Array<{ id: string; businessName: string; phone: string }>
> {
  const res = await apiClient.get<any>(`${BASE}/suppliers`);
  return res.data ?? [];
}

// =============================================================================
// PAYROLL
// =============================================================================

export async function generatePayroll(payload: {
  periodYear: number;
  periodMonth: number;
  employeeIds?: string[];
}): Promise<{
  period: { year: number; month: number };
  generated: number;
  skipped: Array<{ employeeId: string; name: string; reason: string }>;
}> {
  const res = await apiClient.post<any>(`${BASE}/payroll/generate`, clean(payload));
  return res.data;
}

export async function fetchSalaries(
  params: SalaryParams
): Promise<Paginated<SalaryRecord> & { summary: SalarySummary }> {
  const res: any = await apiClient.get<any>(`${BASE}/salaries`, { params: clean(params) });
  return {
    ...toPaginated<SalaryRecord>(res, params.limit ?? 25),
    summary: res?.summary ?? {
      count: 0, totalBase: 0, totalBonus: 0, totalAdvance: 0,
      totalDeduction: 0, totalNetPayable: 0, totalPaid: 0, totalDue: 0,
    },
  };
}

export async function fetchSalary(id: string): Promise<SalaryRecord> {
  const res = await apiClient.get<any>(`${BASE}/salaries/${id}`);
  return res.data;
}

export async function addSalaryAdjustment(
  salaryId: string,
  payload: { type: string; amount: number; reason: string }
): Promise<SalaryRecord> {
  const res = await apiClient.post<any>(`${BASE}/salaries/${salaryId}/adjustments`, payload);
  return res.data;
}

export async function paySalary(
  salaryId: string,
  payload: {
    amount: number;
    paymentMethod?: string;
    referenceNumber?: string;
    notes?: string;
    paidAt?: string;
  }
): Promise<SalaryRecord> {
  const res = await apiClient.post<any>(`${BASE}/salaries/${salaryId}/pay`, clean(payload));
  return res.data;
}
