/**
 * Finance types — mirrors the server DTOs exactly.
 *
 * Money is `number` throughout because the service converts Decimal → number at
 * its response boundary. The client never parses a currency string, which is
 * where silent NaN corruption creeps into financial UIs.
 */

export type PeriodKeyword =
  | "today" | "yesterday" | "week" | "month" | "quarter" | "year" | "custom";

export type Granularity = "auto" | "day" | "week" | "month" | "year";
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";
export type SettlementStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "CANCELLED";
export type SalaryStatus = "PENDING" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";
export type PaymentMethod = "CASH" | "UPI" | "CARD" | "CREDIT" | "GIFT_CARD" | "OTHER";
export type SalaryAdjustmentType =
  | "ADVANCE" | "BONUS" | "OVERTIME" | "INCENTIVE" | "DEDUCTION" | "REIMBURSEMENT";

export interface Period {
  label: string;
  start: string;
  end: string;
  granularity?: Exclude<Granularity, "auto">;
}

export interface EmployeeBrief {
  id: string;
  name: string;
}

export interface TrendValue {
  value: number;
  trend: "up" | "down" | "flat";
  previous: number;
}

// =============================================================================
// DASHBOARD
// =============================================================================

export interface FinanceDashboard {
  period: Period;
  cards: {
    todayRevenue: number;
    todayExpense: number;
    todayProfit: number;
    monthlyRevenue: number;
    monthlyProfit: number;
    inventoryValue: number;
    inventoryRetailValue: number;
    inventoryUnits: number;
    cashInDrawer: number;
    outstandingSupplierPayments: number;
    outstandingSalaries: number;
  };
  period_totals: {
    revenue: number;
    expenses: number;
    cogs: number;
    grossProfit: number;
    netProfit: number;
    grossMarginPercent: number;
    netMarginPercent: number;
    orders: number;
    refunds: number;
    discounts: number;
  };
  comparison: {
    revenue: TrendValue;
    expenses: TrendValue;
    profit: TrendValue;
  };
}

// =============================================================================
// REVENUE
// =============================================================================

export interface RevenueReport {
  period: Period;
  totals: {
    grossRevenue: number;
    netRevenue: number;
    subtotal: number;
    discounts: number;
    tax: number;
    refunds: number;
    orders: number;
    averageOrderValue: number;
    exchangeValue: number;
    exchangeCount: number;
  };
  comparison: {
    previousRevenue: number;
    previousOrders: number;
    growth: number;
    trend: "up" | "down" | "flat";
  };
  series: Array<{
    bucket: string;
    revenue: number;
    orders: number;
    discount: number;
    tax: number;
  }>;
  paymentBreakdown: Array<{
    method: PaymentMethod;
    amount: number;
    count: number;
    percentage: number;
  }>;
}

// =============================================================================
// PROFIT & LOSS
// =============================================================================

export interface ProfitLossStatement {
  grossSales: number;
  refunds: number;
  discounts: number;
  netSales: number;
  tax: number;
  cogs: number;
  grossProfit: number;
  grossMarginPercent: number;
  operatingExpenses: number;
  netProfit: number;
  netMarginPercent: number;
}

export interface ProfitLossReport {
  period: Period;
  statement: ProfitLossStatement;
  previous: ProfitLossStatement;
  comparison: {
    revenueGrowth: number;
    profitGrowth: number;
    trend: "up" | "down" | "flat";
    marginChange: number;
  };
  series: Array<{
    bucket: string;
    revenue: number;
    cogs: number;
    expenses: number;
    grossProfit: number;
    netProfit: number;
  }>;
  expenseBreakdown: Array<{
    categoryId: string;
    category: string;
    isRecurring: boolean;
    amount: number;
    count: number;
    percentage: number;
  }>;
}

// =============================================================================
// CASH FLOW
// =============================================================================

export interface CashFlowReport {
  period: Period;
  summary: {
    openingBalance: number;
    moneyIn: number;
    moneyOut: number;
    netFlow: number;
    closingBalance: number;
    cashInDrawersNow: number;
  };
  breakdown: {
    inflows: Array<{ label: string; amount: number; direction: "IN" }>;
    outflows: Array<{ label: string; amount: number; direction: "OUT" }>;
  };
  series: Array<{ bucket: string; moneyIn: number; moneyOut: number; netFlow: number }>;
}

// =============================================================================
// PAYMENT ANALYTICS
// =============================================================================

export interface PaymentAnalytics {
  period: Period;
  total: number;
  transactionCount: number;
  orderCount: number;
  splitPaymentCount: number;
  splitPaymentPercentage: number;
  methods: Array<{
    method: PaymentMethod;
    amount: number;
    count: number;
    percentage: number;
    previousAmount: number;
    growth: number;
    trend: "up" | "down" | "flat";
    averageTicket: number;
  }>;
}

// =============================================================================
// EXPENSES
// =============================================================================

export interface ExpenseCategory {
  id: string;
  name: string;
  code: string | null;
  displayOrder: number;
  isRecurring: boolean;
}

export interface Expense {
  id: string;
  expenseCode: string;
  title: string;
  amount: number;
  categoryId: string;
  category: { id: string; name: string; isRecurring: boolean } | null;
  vendorName: string | null;
  paymentMethod: PaymentMethod;
  referenceNumber: string | null;
  description: string | null;
  notes: string | null;
  expenseDate: string;
  approvalStatus: ApprovalStatus;
  approvedAt: string | null;
  rejectionReason: string | null;
  receiptAssetId: string | null;
  registerId: string | null;
  createdAt: string;
  employee: EmployeeBrief | null;
  approvedBy: EmployeeBrief | null;
}

export interface ExpenseSummary {
  totalAmount: number;
  count: number;
  approved: { amount: number; count: number };
  pending: { amount: number; count: number };
  rejected: { amount: number; count: number };
}

// =============================================================================
// PAYABLES
// =============================================================================

export interface PayableBill {
  id: string;
  purchaseNumber: string;
  supplierInvoiceNumber: string | null;
  purchaseDate: string;
  dueDate: string | null;
  daysOverdue: number | null;
  ageingBucket: "CURRENT" | "0_30" | "31_60" | "61_90" | "90_PLUS";
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  paymentStatus: SettlementStatus;
  supplier: { id: string; businessName: string; phone: string; contactPerson: string | null } | null;
}

export interface SupplierAgeing {
  supplierId: string;
  businessName: string;
  phone: string;
  billCount: number;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  ageing: {
    current: number;
    days0_30: number;
    days31_60: number;
    days61_90: number;
    days90plus: number;
  };
}

export interface SupplierPayment {
  id: string;
  paymentNumber: string;
  amount: number;
  paymentMethod: PaymentMethod;
  referenceNumber: string | null;
  notes: string | null;
  paidAt: string;
  supplier: { id: string; businessName: string; phone: string } | null;
  purchase: { id: string; purchaseNumber: string } | null;
  createdBy: EmployeeBrief | null;
}

export interface OpenBill {
  id: string;
  purchaseNumber: string;
  purchaseDate: string;
  dueDate: string | null;
  daysOverdue: number | null;
  ageingBucket: PayableBill["ageingBucket"];
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  paymentStatus: SettlementStatus;
}

// =============================================================================
// PAYROLL
// =============================================================================

export interface SalaryAdjustment {
  id: string;
  type: SalaryAdjustmentType;
  amount: number;
  reason: string;
  createdAt: string;
  createdBy: EmployeeBrief | null;
}

export interface SalaryRecord {
  id: string;
  paymentNumber: string;
  employee: { id: string; name: string; employeeCode: string; role: string } | null;
  period: { year: number; month: number; label: string };
  baseSalary: number;
  totalBonus: number;
  totalOvertime?: number;
  totalIncentive?: number;
  totalAdvance: number;
  totalDeduction: number;
  netPayable: number;
  paidAmount: number;
  dueAmount: number;
  status: SalaryStatus;
  paymentMethod?: PaymentMethod;
  paidAt: string | null;
  referenceNumber?: string | null;
  notes?: string | null;
  paidBy: EmployeeBrief | null;
  adjustments?: SalaryAdjustment[];
}

export interface SalarySummary {
  count: number;
  totalBase: number;
  totalBonus: number;
  totalAdvance: number;
  totalDeduction: number;
  totalNetPayable: number;
  totalPaid: number;
  totalDue: number;
}

// =============================================================================
// SHARED
// =============================================================================

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

export interface PeriodParams {
  period?: PeriodKeyword;
  startDate?: string;
  endDate?: string;
}

export interface ExpenseParams extends PeriodParams {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string;
  employeeId?: string;
  paymentMethod?: PaymentMethod;
  approvalStatus?: ApprovalStatus;
  minAmount?: number;
  maxAmount?: number;
  sortBy?: "expenseDate" | "amount" | "createdAt" | "title";
  sortOrder?: "asc" | "desc";
}

export interface PayablesParams {
  page?: number;
  limit?: number;
  search?: string;
  supplierId?: string;
  paymentStatus?: SettlementStatus;
  overdueOnly?: boolean;
  dueBefore?: string;
  sortBy?: "dueDate" | "purchaseDate" | "dueAmount" | "totalAmount";
  sortOrder?: "asc" | "desc";
}

export interface SalaryParams {
  page?: number;
  limit?: number;
  search?: string;
  employeeId?: string;
  periodYear?: number;
  periodMonth?: number;
  status?: SalaryStatus;
}

export interface SupplierPaymentParams extends PeriodParams {
  page?: number;
  limit?: number;
  supplierId?: string;
  purchaseId?: string;
  paymentMethod?: PaymentMethod;
  search?: string;
}
