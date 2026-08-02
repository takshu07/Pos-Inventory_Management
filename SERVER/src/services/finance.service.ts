// =============================================================================
// FINANCE SERVICE  —  revenue, expenses, payables, payroll, P&L, cash flow
//
// THE MODULE'S CENTRAL RULE: FINANCIAL HISTORY IS NEVER DELETED.
//
// There is no delete endpoint anywhere in this file, for any role including
// OWNER. An expense that was wrong is CORRECTED (amended, with the old values
// captured in the audit trail) or REJECTED (which removes it from the P&L while
// leaving the record standing). A row that can vanish is a row an audit cannot
// rely on, and a P&L that can be quietly re-cut after the fact is not a P&L.
//
// AUTHORIZATION
//   OWNER    full surface.
//   MANAGER  everything except approving their own expenses and anything that
//            would alter settled history. Enforced per-operation below, not by
//            route guards alone.
//   CASHIER  no access to this module at all — gated at the route tree.
//
// DOUBLE-COUNTING, AND WHY THE P&L LOOKS "MISSING" THINGS
// ------------------------------------------------------
// Net Profit subtracts operating expenses, and salary is an expense category —
// so salary is already in there. Supplier payments are NOT subtracted: they
// settle inventory whose cost is already counted in COGS at the moment it sold.
// Subtracting either again is the single most common way a retail P&L reports
// a loss on a profitable month. The cash-flow statement is where those payments
// legitimately appear, because cash flow and profit are different questions.
// =============================================================================

import {
  Prisma,
  ActionModule,
  ActionType,
  ApprovalStatus,
  PaymentMethod,
  SalaryAdjustmentType,
  ReferenceType,
  CashTransactionType,
} from "../../generated/prisma";

import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { AppError } from "../errors/AppError";
import { HTTP_STATUS } from "../constants/httpStatus";
import type { AuthenticatedUser } from "../types/employee.types";
import { auditRepository } from "../repositories/audit.repository";
import { financeRepository as repo, type Window } from "../repositories/finance.repository";
import { cashRegisterRepository } from "../repositories/cashRegister.repository";
import {
  ZERO,
  toDecimal,
  toNumber,
  money,
  percentage,
  growth,
  trend,
  calculateProfitLoss,
  buildCashFlow,
  deriveSettlementStatus,
  deriveSalaryStatus,
  calculateNetSalary,
  daysOverdue,
  ageingBucket,
  resolvePeriod,
  autoGranularity,
  fillSeries,
  type Granularity,
  type PeriodKeyword,
} from "../engines/finance.engine";
import type {
  DashboardQuery,
  RevenueQuery,
  ProfitLossQuery,
  CashFlowQuery,
  PaymentAnalyticsQuery,
  CreateExpenseInput,
  UpdateExpenseInput,
  ReviewExpenseInput,
  ExpenseQuery,
  CreateExpenseCategoryInput,
  PayablesQuery,
  RecordSupplierPaymentInput,
  SetBillDueDateInput,
  SupplierPaymentQuery,
  GeneratePayrollInput,
  SalaryAdjustmentInput,
  PaySalaryInput,
  SalaryQuery,
} from "../validation/finance.validation";

// =============================================================================
// HELPERS
// =============================================================================

const isOwner = (user: AuthenticatedUser) => user.role === "OWNER";

function employeeName(e: { firstName: string; lastName: string } | null | undefined): string {
  return e ? `${e.firstName} ${e.lastName}`.trim() : "—";
}

/** Turns a validated period query into the concrete window every query shares. */
function windowFor(query: {
  period: PeriodKeyword;
  startDate?: Date | undefined;
  endDate?: Date | undefined;
}): ReturnType<typeof resolvePeriod> {
  return resolvePeriod(query.period, {
    ...(query.startDate && { startDate: query.startDate }),
    ...(query.endDate && { endDate: query.endDate }),
  });
}

function resolveGranularity(
  requested: "auto" | Granularity,
  start: Date,
  end: Date
): Granularity {
  return requested === "auto" ? autoGranularity(start, end) : requested;
}

function audit(input: {
  employeeId: string;
  action: ActionType;
  module?: ActionModule;
  tableName: string;
  recordId: string;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
}): void {
  void auditRepository
    .create({
      performedBy: input.employeeId,
      action: input.action,
      module: input.module ?? ActionModule.FINANCE,
      tableName: input.tableName,
      recordId: input.recordId,
      ...(input.oldData && { oldData: input.oldData }),
      ...(input.newData && { newData: input.newData }),
    })
    .catch((err) => logger.error({ err }, "[Finance] audit write failed"));
}

/**
 * Records a cash movement against the actor's open drawer, if they have one.
 *
 * Returns the register id so the caller can store the link. Returns null when
 * no drawer is open — paying a supplier from the office safe is legitimate and
 * must not be blocked just because nobody is on a till.
 */
async function postToDrawerIfOpen(
  tx: Prisma.TransactionClient,
  input: {
    employeeId: string;
    amount: Prisma.Decimal;
    reason: string;
    referenceId: string;
    referenceType: ReferenceType;
    direction: CashTransactionType;
  }
): Promise<string | null> {
  const session = await cashRegisterRepository.findOpenSessionForEmployee(input.employeeId, tx);
  if (!session) return null;

  await cashRegisterRepository.createCashTransaction(
    {
      registerId: session.id,
      type: input.direction,
      amount: input.amount,
      reason: input.reason,
      referenceId: input.referenceId,
      referenceType: input.referenceType,
      employeeId: input.employeeId,
    },
    tx
  );

  await cashRegisterRepository.createActivity(
    {
      registerId: session.id,
      type: "EXPENSE",
      description: input.reason,
      amount: input.direction === CashTransactionType.CASH_OUT ? input.amount.negated() : input.amount,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      employeeId: input.employeeId,
    },
    tx
  );

  return session.id;
}

// =============================================================================
// FINANCIAL DASHBOARD
// =============================================================================

/**
 * The nine headline cards.
 *
 * Every figure for the current window and its comparison window is fetched in
 * ONE parallel batch. Sequencing them would cost ~15 serial round-trips to a
 * remote database for a screen that must feel instant.
 */
export async function getDashboard(query: DashboardQuery) {
  const w = windowFor(query);
  const today = resolvePeriod("today");
  const thisMonth = resolvePeriod("month");

  const current: Window = { start: w.start, end: w.end };
  const previous: Window = { start: w.previousStart, end: w.previousEnd };

  const [
    todayRevenue, todayExpense, todayCogs,
    monthRevenue, monthExpense, monthCogs,
    periodRevenue, periodExpense, periodCogs, periodRefunds,
    prevRevenue, prevExpense, prevCogs, prevRefunds,
    inventory, cashInDrawers, payables, salaries,
  ] = await Promise.all([
    repo.revenueTotals(today),
    repo.approvedExpenseTotal(today),
    repo.cogsTotal(today),

    repo.revenueTotals(thisMonth),
    repo.approvedExpenseTotal(thisMonth),
    repo.cogsTotal(thisMonth),

    repo.revenueTotals(current),
    repo.approvedExpenseTotal(current),
    repo.cogsTotal(current),
    repo.refundTotal(current),

    repo.revenueTotals(previous),
    repo.approvedExpenseTotal(previous),
    repo.cogsTotal(previous),
    repo.refundTotal(previous),

    repo.inventoryValue(),
    repo.cashInDrawers(),
    repo.outstandingPayables(),
    repo.outstandingSalaries(),
  ]);

  const todayProfit = calculateProfitLoss({
    grossSales: todayRevenue.grandTotal ?? 0,
    refunds: 0,
    discounts: todayRevenue.discount,
    tax: todayRevenue.tax ?? 0,
    cogs: todayCogs,
    operatingExpenses: todayExpense,
  });

  const monthProfit = calculateProfitLoss({
    grossSales: monthRevenue.grandTotal ?? 0,
    refunds: 0,
    discounts: monthRevenue.discount,
    tax: monthRevenue.tax ?? 0,
    cogs: monthCogs,
    operatingExpenses: monthExpense,
  });

  const periodProfit = calculateProfitLoss({
    grossSales: periodRevenue.grandTotal ?? 0,
    refunds: periodRefunds,
    discounts: periodRevenue.discount,
    tax: periodRevenue.tax ?? 0,
    cogs: periodCogs,
    operatingExpenses: periodExpense,
  });

  const prevProfit = calculateProfitLoss({
    grossSales: prevRevenue.grandTotal ?? 0,
    refunds: prevRefunds,
    discounts: prevRevenue.discount,
    tax: prevRevenue.tax ?? 0,
    cogs: prevCogs,
    operatingExpenses: prevExpense,
  });

  const revenueGrowth = growth(periodRevenue.grandTotal ?? 0, prevRevenue.grandTotal ?? 0);
  const expenseGrowth = growth(periodExpense, prevExpense);
  const profitGrowth = growth(periodProfit.netProfit, prevProfit.netProfit);

  return {
    period: { label: w.label, start: w.start, end: w.end },

    cards: {
      todayRevenue: toNumber(toDecimal(todayRevenue.grandTotal)),
      todayExpense: toNumber(todayExpense),
      todayProfit: todayProfit.netProfit,

      monthlyRevenue: toNumber(toDecimal(monthRevenue.grandTotal)),
      monthlyProfit: monthProfit.netProfit,

      inventoryValue: toNumber(inventory.costValue),
      inventoryRetailValue: toNumber(inventory.retailValue),
      inventoryUnits: inventory.units,

      cashInDrawer: toNumber(cashInDrawers),
      outstandingSupplierPayments: toNumber(payables),
      outstandingSalaries: toNumber(salaries),
    },

    // The selected period, with its own comparison — the dashboard's second row.
    period_totals: {
      revenue: periodProfit.grossSales,
      expenses: periodProfit.operatingExpenses,
      cogs: periodProfit.cogs,
      grossProfit: periodProfit.grossProfit,
      netProfit: periodProfit.netProfit,
      grossMarginPercent: periodProfit.grossMarginPercent,
      netMarginPercent: periodProfit.netMarginPercent,
      orders: periodRevenue.orderCount,
      refunds: periodProfit.refunds,
      discounts: periodProfit.discounts,
    },

    comparison: {
      revenue: { value: revenueGrowth, trend: trend(revenueGrowth), previous: prevProfit.grossSales },
      // An expense INCREASE is not good news, so the trend indicator is inverted
      // here rather than in the UI. Putting the polarity next to the number that
      // needs it is what stops a green up-arrow appearing on rising costs.
      expenses: { value: expenseGrowth, trend: trend(-expenseGrowth), previous: prevProfit.operatingExpenses },
      profit: { value: profitGrowth, trend: trend(profitGrowth), previous: prevProfit.netProfit },
    },
  };
}

// =============================================================================
// REVENUE
// =============================================================================

export async function getRevenue(query: RevenueQuery) {
  const w = windowFor(query);
  const granularity = resolveGranularity(query.granularity, w.start, w.end);
  const current: Window = { start: w.start, end: w.end };
  const previous: Window = { start: w.previousStart, end: w.previousEnd };

  const [totals, prevTotals, series, payments, refunds, exchanges] = await Promise.all([
    repo.revenueTotals(current),
    repo.revenueTotals(previous),
    repo.revenueSeries(current, granularity),
    repo.paymentsByMethod(current),
    repo.refundTotal(current),
    repo.exchangeTotals(current),
  ]);

  const revenue = toDecimal(totals.grandTotal);
  const revenueGrowth = growth(revenue, toDecimal(prevTotals.grandTotal));

  const paymentTotal = payments.reduce((acc, p) => acc.plus(p._sum.amount ?? 0), ZERO);

  return {
    period: { label: w.label, start: w.start, end: w.end, granularity },

    totals: {
      grossRevenue: toNumber(revenue),
      netRevenue: toNumber(money(revenue.minus(refunds))),
      subtotal: toNumber(toDecimal(totals.subtotal)),
      discounts: toNumber(totals.discount),
      tax: toNumber(toDecimal(totals.tax)),
      refunds: toNumber(refunds),
      orders: totals.orderCount,
      averageOrderValue:
        totals.orderCount === 0 ? 0 : toNumber(money(revenue.dividedBy(totals.orderCount))),
      exchangeValue: toNumber(toDecimal(exchanges.issued)),
      exchangeCount: exchanges.count,
    },

    comparison: {
      previousRevenue: toNumber(toDecimal(prevTotals.grandTotal)),
      previousOrders: prevTotals.orderCount,
      growth: revenueGrowth,
      trend: trend(revenueGrowth),
    },

    // Zero-filled so a closed day renders as a gap at zero, not as a straight
    // line between the days either side of it.
    series: fillSeries(
      series.map((r) => ({
        bucket: r.bucket,
        revenue: toNumber(toDecimal(r.revenue)),
        orders: Number(r.orders),
        discount: toNumber(toDecimal(r.discount)),
        tax: toNumber(toDecimal(r.tax)),
      })),
      w.start,
      w.end,
      granularity,
      { revenue: 0, orders: 0, discount: 0, tax: 0 }
    ),

    paymentBreakdown: payments.map((p) => ({
      method: p.method,
      amount: toNumber(toDecimal(p._sum.amount)),
      count: p._count._all,
      percentage: percentage(toDecimal(p._sum.amount), paymentTotal),
    })),
  };
}

// =============================================================================
// PROFIT & LOSS
// =============================================================================

export async function getProfitLoss(query: ProfitLossQuery) {
  const w = windowFor(query);
  const granularity = resolveGranularity(query.granularity, w.start, w.end);
  const current: Window = { start: w.start, end: w.end };
  const previous: Window = { start: w.previousStart, end: w.previousEnd };

  const [
    totals, cogs, expenses, refunds,
    prevTotals, prevCogs, prevExpenses, prevRefunds,
    revenueSeries, cogsSeries, expenseSeries,
    breakdown,
  ] = await Promise.all([
    repo.revenueTotals(current),
    repo.cogsTotal(current),
    repo.approvedExpenseTotal(current),
    repo.refundTotal(current),

    repo.revenueTotals(previous),
    repo.cogsTotal(previous),
    repo.approvedExpenseTotal(previous),
    repo.refundTotal(previous),

    repo.revenueSeries(current, granularity),
    repo.cogsSeries(current, granularity),
    repo.expenseSeries(current, granularity),

    query.includeBreakdown ? repo.expensesByCategory(current) : Promise.resolve([]),
  ]);

  const statement = calculateProfitLoss({
    grossSales: totals.grandTotal ?? 0,
    refunds,
    discounts: totals.discount,
    tax: totals.tax ?? 0,
    cogs,
    operatingExpenses: expenses,
  });

  const previousStatement = calculateProfitLoss({
    grossSales: prevTotals.grandTotal ?? 0,
    refunds: prevRefunds,
    discounts: prevTotals.discount,
    tax: prevTotals.tax ?? 0,
    cogs: prevCogs,
    operatingExpenses: prevExpenses,
  });

  // Merge the three independently-bucketed series into one row per bucket, so
  // the chart can stack revenue / COGS / expenses without the client joining.
  const cogsByBucket = new Map(cogsSeries.map((r) => [r.bucket.toISOString().slice(0, 10), toNumber(toDecimal(r.cogs))]));
  const expenseByBucket = new Map(expenseSeries.map((r) => [r.bucket.toISOString().slice(0, 10), toNumber(toDecimal(r.expense))]));

  const merged = revenueSeries.map((r) => {
    const key = r.bucket.toISOString().slice(0, 10);
    const revenue = toNumber(toDecimal(r.revenue));
    const bucketCogs = cogsByBucket.get(key) ?? 0;
    const bucketExpense = expenseByBucket.get(key) ?? 0;
    return {
      bucket: r.bucket,
      revenue,
      cogs: bucketCogs,
      expenses: bucketExpense,
      grossProfit: Number((revenue - bucketCogs).toFixed(2)),
      netProfit: Number((revenue - bucketCogs - bucketExpense).toFixed(2)),
    };
  });

  const netProfitGrowth = growth(statement.netProfit, previousStatement.netProfit);

  return {
    period: { label: w.label, start: w.start, end: w.end, granularity },
    statement,
    previous: previousStatement,
    comparison: {
      revenueGrowth: growth(statement.grossSales, previousStatement.grossSales),
      profitGrowth: netProfitGrowth,
      trend: trend(netProfitGrowth),
      marginChange: Number(
        (statement.netMarginPercent - previousStatement.netMarginPercent).toFixed(2)
      ),
    },
    series: fillSeries(merged, w.start, w.end, granularity, {
      revenue: 0, cogs: 0, expenses: 0, grossProfit: 0, netProfit: 0,
    }),
    expenseBreakdown: breakdown.map((b) => ({
      categoryId: b.categoryId,
      category: b.name,
      isRecurring: b.isRecurring,
      amount: toNumber(toDecimal(b.amount)),
      count: Number(b.count),
      percentage: percentage(toDecimal(b.amount), toDecimal(expenses)),
    })),
  };
}

// =============================================================================
// CASH FLOW
// =============================================================================

export async function getCashFlow(query: CashFlowQuery) {
  const w = windowFor(query);
  const granularity = resolveGranularity(query.granularity, w.start, w.end);
  const current: Window = { start: w.start, end: w.end };

  const [flow, dropsPayouts, expenses, supplierPayments, salariesPaid, series, drawerCash, revenue, refunds] =
    await Promise.all([
      repo.drawerFlow(current),
      repo.dropAndPayoutTotals(current),
      repo.approvedExpenseTotal(current),
      repo.supplierPaymentTotal(current),
      repo.salaryPaidTotal(current),
      repo.cashFlowSeries(current, granularity),
      repo.cashInDrawers(),
      repo.revenueTotals(current),
      repo.refundTotal(current),
    ]);

  // Opening balance is reconstructed as (current cash) − (net movement in the
  // window). Deriving it this way rather than storing a daily opening figure
  // keeps the statement correct for ANY window a user selects, including ones
  // that start mid-day.
  const netFlow = flow.cashIn.minus(flow.cashOut);
  const openingBalance = money(toDecimal(drawerCash).minus(netFlow));

  const statement = buildCashFlow({
    openingBalance,
    inflows: [
      { label: "Sales Receipts", amount: revenue.grandTotal ?? 0 },
      { label: "Drawer Cash In", amount: flow.cashIn },
    ],
    outflows: [
      { label: "Operating Expenses", amount: expenses },
      { label: "Supplier Payments", amount: supplierPayments },
      { label: "Salaries Paid", amount: salariesPaid },
      { label: "Cash Drops (to safe/bank)", amount: dropsPayouts.drops },
      { label: "Cash Payouts", amount: dropsPayouts.payouts },
      { label: "Refunds", amount: refunds },
    ],
  });

  // The headline uses the DRAWER LEDGER, not the sum of the labelled lines
  // above. Those lines are an explanatory breakdown that deliberately overlaps
  // (a cash payout is also an expense); presenting their sum as the movement
  // would double-count. The ledger is the one non-overlapping truth.
  const ledgerStatement = buildCashFlow({
    openingBalance,
    inflows: [{ label: "Cash In", amount: flow.cashIn }],
    outflows: [{ label: "Cash Out", amount: flow.cashOut }],
  });

  return {
    period: { label: w.label, start: w.start, end: w.end, granularity },

    summary: {
      openingBalance: ledgerStatement.openingBalance,
      moneyIn: ledgerStatement.moneyIn,
      moneyOut: ledgerStatement.moneyOut,
      netFlow: ledgerStatement.netFlow,
      closingBalance: ledgerStatement.closingBalance,
      cashInDrawersNow: toNumber(drawerCash),
    },

    breakdown: {
      inflows: statement.inflows,
      outflows: statement.outflows,
    },

    series: fillSeries(
      series.map((r) => {
        const moneyIn = toNumber(toDecimal(r.moneyIn));
        const moneyOut = toNumber(toDecimal(r.moneyOut));
        return {
          bucket: r.bucket,
          moneyIn,
          moneyOut,
          netFlow: Number((moneyIn - moneyOut).toFixed(2)),
        };
      }),
      w.start,
      w.end,
      granularity,
      { moneyIn: 0, moneyOut: 0, netFlow: 0 }
    ),
  };
}

// =============================================================================
// PAYMENT ANALYTICS
// =============================================================================

export async function getPaymentAnalytics(query: PaymentAnalyticsQuery) {
  const w = windowFor(query);
  const current: Window = { start: w.start, end: w.end };
  const previous: Window = { start: w.previousStart, end: w.previousEnd };

  const [payments, prevPayments, sales] = await Promise.all([
    repo.paymentsByMethod(current),
    repo.paymentsByMethod(previous),
    repo.revenueTotals(current),
  ]);

  const total = payments.reduce((acc, p) => acc.plus(p._sum.amount ?? 0), ZERO);
  const prevByMethod = new Map(prevPayments.map((p) => [p.method, toDecimal(p._sum.amount)]));

  // Every method is emitted, including ones with no activity. A breakdown that
  // omits "Card" when no card was taken reads as a missing integration rather
  // than as a fact about the period.
  const methods = Object.values(PaymentMethod);
  const rows = methods.map((method) => {
    const row = payments.find((p) => p.method === method);
    const amount = toDecimal(row?._sum.amount);
    const previousAmount = prevByMethod.get(method) ?? ZERO;
    const g = growth(amount, previousAmount);

    return {
      method,
      amount: toNumber(amount),
      count: row?._count._all ?? 0,
      percentage: percentage(amount, total),
      previousAmount: toNumber(previousAmount),
      growth: g,
      trend: trend(g),
      averageTicket:
        !row || row._count._all === 0 ? 0 : toNumber(money(amount.dividedBy(row._count._all))),
    };
  });

  // A "split" bill settles with more than one tender. It is a property of the
  // BILL, not of any single payment row, so it is counted separately rather
  // than presented as a sixth payment method.
  const splitCount = Math.max(0, payments.reduce((n, p) => n + p._count._all, 0) - sales.orderCount);

  return {
    period: { label: w.label, start: w.start, end: w.end },
    total: toNumber(total),
    transactionCount: payments.reduce((n, p) => n + p._count._all, 0),
    orderCount: sales.orderCount,
    splitPaymentCount: splitCount,
    splitPaymentPercentage: percentage(splitCount, sales.orderCount),
    methods: rows.filter((r) => r.amount > 0 || r.previousAmount > 0 || ["CASH", "UPI", "CARD"].includes(r.method)),
  };
}

// =============================================================================
// EXPENSES
// =============================================================================

type ExpenseRow = NonNullable<Awaited<ReturnType<typeof repo.findExpenseById>>>;

function toExpenseDTO(e: ExpenseRow | Awaited<ReturnType<typeof repo.createExpense>>) {
  return {
    id: e.id,
    expenseCode: e.expenseCode,
    title: e.title,
    amount: toNumber(e.amount),
    categoryId: e.categoryId,
    category: e.category ? { id: e.category.id, name: e.category.name, isRecurring: e.category.isRecurring } : null,
    vendorName: e.vendorName,
    paymentMethod: e.paymentMethod,
    referenceNumber: e.referenceNumber,
    description: e.description,
    notes: e.notes,
    expenseDate: e.expenseDate,
    approvalStatus: e.approvalStatus,
    approvedAt: e.approvedAt,
    rejectionReason: e.rejectionReason,
    receiptAssetId: e.receiptAssetId,
    registerId: e.registerId,
    createdAt: e.createdAt,
    employee: e.employee ? { id: e.employee.id, name: employeeName(e.employee) } : null,
    approvedBy: e.approvedBy ? { id: e.approvedBy.id, name: employeeName(e.approvedBy) } : null,
  };
}

export async function createExpense(input: CreateExpenseInput, user: AuthenticatedUser) {
  const category = await prisma.expenseCategory.findUnique({ where: { id: input.categoryId } });
  if (!category) throw new AppError(HTTP_STATUS.NOT_FOUND, "Expense category not found.");
  if (!category.isActive) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, `The category "${category.name}" is no longer active.`);
  }

  const amount = money(toDecimal(input.amount));
  const expenseDate = input.expenseDate ?? new Date();
  const now = new Date();

  // A manager's expense goes to approval unless they explicitly recorded an
  // already-authorised cost; an owner's is authorised by definition, since
  // there is nobody above them to approve it.
  const needsApproval = input.requiresApproval && !isOwner(user);

  const expense = await prisma.$transaction(async (tx) => {
    const expenseCode = await repo.nextExpenseCode(now, tx);

    const created = await repo.createExpense(
      {
        expenseCode,
        categoryId: input.categoryId,
        title: input.title,
        amount,
        vendorName: input.vendorName ?? null,
        paymentMethod: input.paymentMethod as PaymentMethod,
        referenceNumber: input.referenceNumber ?? null,
        description: input.description ?? null,
        notes: input.notes ?? null,
        employeeId: user.id,
        expenseDate,
        approvalStatus: needsApproval ? ApprovalStatus.PENDING : ApprovalStatus.APPROVED,
        ...(needsApproval ? {} : { approvedById: user.id, approvedAt: now }),
        ...(input.receiptAssetId && { receiptAssetId: input.receiptAssetId }),
      },
      tx
    );

    // Only APPROVED cash spend leaves the drawer. A pending expense has not
    // been paid yet, so deducting it would make the till appear short by money
    // that is still in it.
    if (!needsApproval && input.paymentMethod === "CASH") {
      const registerId = await postToDrawerIfOpen(tx, {
        employeeId: user.id,
        amount,
        reason: `Expense ${expenseCode}: ${input.title}`,
        referenceId: created.id,
        referenceType: ReferenceType.EXPENSE,
        direction: CashTransactionType.CASH_OUT,
      });

      if (registerId) {
        return repo.updateExpense(created.id, { registerId }, tx);
      }
    }

    return created;
  });

  audit({
    employeeId: user.id,
    action: ActionType.CREATE,
    module: ActionModule.EXPENSE,
    tableName: "expenses",
    recordId: expense.id,
    newData: {
      expenseCode: expense.expenseCode,
      title: expense.title,
      amount: toNumber(expense.amount),
      categoryId: expense.categoryId,
      approvalStatus: expense.approvalStatus,
    },
  });

  return toExpenseDTO(expense);
}

/**
 * Amends an expense.
 *
 * Only PENDING expenses may be edited. Once approved, a cost has entered the
 * P&L and (if paid in cash) moved a drawer; silently rewriting it would change
 * a period an owner may already have signed off on. The correction path for an
 * approved expense is a new offsetting expense, which leaves both records
 * standing — that is what an audit trail is for.
 */
export async function updateExpense(
  id: string,
  input: UpdateExpenseInput,
  user: AuthenticatedUser
) {
  const existing = await repo.findExpenseById(id);
  if (!existing) throw new AppError(HTTP_STATUS.NOT_FOUND, "Expense not found.");

  if (existing.approvalStatus === ApprovalStatus.APPROVED) {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      "An approved expense cannot be edited. Record a correcting entry instead — financial history is never rewritten.",
      { reason: "EXPENSE_ALREADY_APPROVED" }
    );
  }

  if (!isOwner(user) && existing.employeeId !== user.id) {
    throw new AppError(HTTP_STATUS.FORBIDDEN, "You can only edit expenses you raised.");
  }

  const data: Prisma.ExpenseUncheckedUpdateInput = {};
  if (input.categoryId !== undefined) data.categoryId = input.categoryId;
  if (input.title !== undefined) data.title = input.title;
  if (input.amount !== undefined) data.amount = money(toDecimal(input.amount));
  if (input.vendorName !== undefined) data.vendorName = input.vendorName;
  if (input.paymentMethod !== undefined) data.paymentMethod = input.paymentMethod as PaymentMethod;
  if (input.referenceNumber !== undefined) data.referenceNumber = input.referenceNumber;
  if (input.description !== undefined) data.description = input.description;
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.expenseDate !== undefined) data.expenseDate = input.expenseDate;
  if (input.receiptAssetId !== undefined) data.receiptAssetId = input.receiptAssetId;

  const updated = await repo.updateExpense(id, data);

  audit({
    employeeId: user.id,
    action: ActionType.UPDATE,
    module: ActionModule.EXPENSE,
    tableName: "expenses",
    recordId: id,
    oldData: { title: existing.title, amount: toNumber(existing.amount), categoryId: existing.categoryId },
    newData: { title: updated.title, amount: toNumber(updated.amount), categoryId: updated.categoryId },
  });

  return toExpenseDTO(updated);
}

export async function reviewExpense(
  id: string,
  input: ReviewExpenseInput,
  user: AuthenticatedUser
) {
  const existing = await repo.findExpenseById(id);
  if (!existing) throw new AppError(HTTP_STATUS.NOT_FOUND, "Expense not found.");

  if (existing.approvalStatus !== ApprovalStatus.PENDING) {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      `This expense has already been ${existing.approvalStatus.toLowerCase()}.`
    );
  }

  // Self-approval defeats the entire control. Only an owner may approve their
  // own — and an owner's expense never enters PENDING in the first place.
  if (existing.employeeId === user.id && !isOwner(user)) {
    throw new AppError(
      HTTP_STATUS.FORBIDDEN,
      "You cannot approve an expense you raised. Ask an owner to review it."
    );
  }

  const approve = input.decision === "APPROVE";
  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const result = await repo.updateExpense(
      id,
      {
        approvalStatus: approve ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED,
        approvedById: user.id,
        approvedAt: now,
        rejectionReason: approve ? null : (input.rejectionReason ?? null),
      },
      tx
    );

    // The cash only leaves the drawer on approval — see createExpense.
    if (approve && existing.paymentMethod === PaymentMethod.CASH) {
      const registerId = await postToDrawerIfOpen(tx, {
        employeeId: user.id,
        amount: toDecimal(existing.amount),
        reason: `Expense ${existing.expenseCode} approved: ${existing.title}`,
        referenceId: id,
        referenceType: ReferenceType.EXPENSE,
        direction: CashTransactionType.CASH_OUT,
      });
      if (registerId) return repo.updateExpense(id, { registerId }, tx);
    }

    return result;
  });

  audit({
    employeeId: user.id,
    action: approve ? ActionType.EXPENSE_APPROVED : ActionType.EXPENSE_REJECTED,
    module: ActionModule.EXPENSE,
    tableName: "expenses",
    recordId: id,
    oldData: { approvalStatus: existing.approvalStatus },
    newData: {
      approvalStatus: updated.approvalStatus,
      rejectionReason: input.rejectionReason ?? null,
      amount: toNumber(existing.amount),
    },
  });

  return toExpenseDTO(updated);
}

function buildExpenseWhere(query: ExpenseQuery): Prisma.ExpenseWhereInput {
  const w = windowFor(query);
  const where: Prisma.ExpenseWhereInput = {
    expenseDate: { gte: w.start, lte: w.end },
  };

  if (query.categoryId) where.categoryId = query.categoryId;
  if (query.employeeId) where.employeeId = query.employeeId;
  if (query.paymentMethod) where.paymentMethod = query.paymentMethod as PaymentMethod;
  if (query.approvalStatus) where.approvalStatus = query.approvalStatus as ApprovalStatus;
  if (query.registerId) where.registerId = query.registerId;

  if (query.minAmount !== undefined || query.maxAmount !== undefined) {
    where.amount = {
      ...(query.minAmount !== undefined && { gte: query.minAmount }),
      ...(query.maxAmount !== undefined && { lte: query.maxAmount }),
    };
  }

  if (query.search) {
    where.OR = [
      { title: { contains: query.search, mode: "insensitive" } },
      { expenseCode: { contains: query.search, mode: "insensitive" } },
      { vendorName: { contains: query.search, mode: "insensitive" } },
      { referenceNumber: { contains: query.search, mode: "insensitive" } },
      { description: { contains: query.search, mode: "insensitive" } },
    ];
  }

  return where;
}

export async function listExpenses(query: ExpenseQuery) {
  const where = buildExpenseWhere(query);

  const { items, total, totalAmount, byStatus } = await repo.listExpenses({
    skip: (query.page - 1) * query.limit,
    take: query.limit,
    where,
    orderBy: { [query.sortBy]: query.sortOrder } as Prisma.ExpenseOrderByWithRelationInput,
  });

  const statusMap = Object.fromEntries(
    byStatus.map((s) => [s.approvalStatus, { amount: toNumber(toDecimal(s._sum.amount)), count: s._count._all }])
  );

  return {
    data: items.map(toExpenseDTO),
    summary: {
      totalAmount: toNumber(toDecimal(totalAmount)),
      count: total,
      approved: statusMap["APPROVED"] ?? { amount: 0, count: 0 },
      pending: statusMap["PENDING"] ?? { amount: 0, count: 0 },
      rejected: statusMap["REJECTED"] ?? { amount: 0, count: 0 },
    },
    meta: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}

export async function getExpense(id: string) {
  const expense = await repo.findExpenseById(id);
  if (!expense) throw new AppError(HTTP_STATUS.NOT_FOUND, "Expense not found.");
  return toExpenseDTO(expense);
}

export async function listExpenseCategories() {
  const categories = await repo.listExpenseCategories();
  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    code: c.code,
    displayOrder: c.displayOrder,
    isRecurring: c.isRecurring,
  }));
}

export async function createExpenseCategory(
  input: CreateExpenseCategoryInput,
  user: AuthenticatedUser
) {
  const existing = await prisma.expenseCategory.findUnique({ where: { name: input.name } });
  if (existing) {
    throw new AppError(HTTP_STATUS.CONFLICT, `A category named "${input.name}" already exists.`);
  }

  const created = await repo.createExpenseCategory({
    name: input.name,
    ...(input.code && { code: input.code }),
    displayOrder: input.displayOrder,
    isRecurring: input.isRecurring,
  });

  audit({
    employeeId: user.id,
    action: ActionType.CREATE,
    module: ActionModule.EXPENSE,
    tableName: "expense_categories",
    recordId: created.id,
    newData: { name: created.name, code: created.code },
  });

  return created;
}

// =============================================================================
// SUPPLIER PAYABLES
// =============================================================================

export async function listPayables(query: PayablesQuery) {
  // Refresh overdue flags before reading. Doing it here rather than on a cron
  // means the payables screen is always correct without a scheduler; the
  // updateMany is a narrow indexed write that no-ops when nothing has aged.
  await repo.refreshOverduePayables(new Date()).catch((err) =>
    logger.warn({ err }, "[Finance] overdue refresh failed; showing stored statuses")
  );

  const where: Prisma.PurchaseWhereInput = { status: { not: "CANCELLED" } };

  if (query.supplierId) where.supplierId = query.supplierId;
  if (query.paymentStatus) where.paymentStatus = query.paymentStatus as never;
  else where.paymentStatus = { in: ["UNPAID", "PARTIALLY_PAID", "OVERDUE"] };

  if (query.overdueOnly) {
    where.dueDate = { lt: new Date() };
    where.dueAmount = { gt: 0 };
  }
  if (query.dueBefore) where.dueDate = { ...(where.dueDate as object), lte: query.dueBefore };

  if (query.search) {
    where.OR = [
      { purchaseNumber: { contains: query.search, mode: "insensitive" } },
      { supplierInvoiceNumber: { contains: query.search, mode: "insensitive" } },
      { supplier: { businessName: { contains: query.search, mode: "insensitive" } } },
    ];
  }

  const [{ items, total, totals }, bySupplier] = await Promise.all([
    repo.listPayables({
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      where,
      orderBy: { [query.sortBy]: query.sortOrder } as Prisma.PurchaseOrderByWithRelationInput,
    }),
    repo.payablesBySupplier(new Date()),
  ]);

  const asOf = new Date();

  return {
    data: items.map((p) => {
      const overdue = daysOverdue(p.dueDate, asOf);
      return {
        id: p.id,
        purchaseNumber: p.purchaseNumber,
        supplierInvoiceNumber: p.supplierInvoiceNumber,
        purchaseDate: p.purchaseDate,
        dueDate: p.dueDate,
        daysOverdue: overdue,
        ageingBucket: ageingBucket(overdue),
        totalAmount: toNumber(p.totalAmount),
        paidAmount: toNumber(p.paidAmount),
        dueAmount: toNumber(p.dueAmount),
        paymentStatus: p.paymentStatus,
        supplier: p.supplier,
      };
    }),

    summary: {
      billCount: total,
      totalAmount: toNumber(toDecimal(totals.totalAmount)),
      paidAmount: toNumber(toDecimal(totals.paidAmount)),
      dueAmount: toNumber(toDecimal(totals.dueAmount)),
    },

    bySupplier: bySupplier.map((s) => ({
      supplierId: s.supplierId,
      businessName: s.businessName,
      phone: s.phone,
      billCount: Number(s.billCount),
      totalAmount: toNumber(toDecimal(s.totalAmount)),
      paidAmount: toNumber(toDecimal(s.paidAmount)),
      dueAmount: toNumber(toDecimal(s.dueAmount)),
      ageing: {
        current: toNumber(toDecimal(s.current)),
        days0_30: toNumber(toDecimal(s.days0_30)),
        days31_60: toNumber(toDecimal(s.days31_60)),
        days61_90: toNumber(toDecimal(s.days61_90)),
        days90plus: toNumber(toDecimal(s.days90plus)),
      },
    })),

    meta: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}

export async function recordSupplierPayment(
  input: RecordSupplierPaymentInput,
  user: AuthenticatedUser
) {
  const supplier = await prisma.supplier.findUnique({
    where: { id: input.supplierId },
    select: { id: true, businessName: true },
  });
  if (!supplier) throw new AppError(HTTP_STATUS.NOT_FOUND, "Supplier not found.");

  const amount = money(toDecimal(input.amount));
  const paidAt = input.paidAt ?? new Date();

  const payment = await prisma.$transaction(async (tx) => {
    let bill: Awaited<ReturnType<typeof repo.findPurchaseForSettlement>> = null;

    if (input.purchaseId) {
      bill = await repo.findPurchaseForSettlement(input.purchaseId, tx);
      if (!bill) throw new AppError(HTTP_STATUS.NOT_FOUND, "Purchase bill not found.");
      if (bill.supplierId !== input.supplierId) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "That bill belongs to a different supplier."
        );
      }
      if (bill.status === "CANCELLED") {
        throw new AppError(HTTP_STATUS.CONFLICT, "Cannot pay against a cancelled purchase.");
      }
      // Overpaying a bill is almost always a mis-keyed amount, and silently
      // accepting it leaves a negative due that corrupts the payables total.
      if (amount.greaterThan(toDecimal(bill.dueAmount))) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          `Payment of ₹${amount} exceeds the ₹${bill.dueAmount} still due on ${bill.purchaseNumber}.`,
          { reason: "OVERPAYMENT", dueAmount: toNumber(bill.dueAmount) }
        );
      }
    }

    const paymentNumber = await repo.nextSupplierPaymentNumber(paidAt, tx);

    const created = await repo.createSupplierPayment(
      {
        paymentNumber,
        supplierId: input.supplierId,
        purchaseId: input.purchaseId ?? null,
        amount,
        paymentMethod: input.paymentMethod as PaymentMethod,
        referenceNumber: input.referenceNumber ?? null,
        notes: input.notes ?? null,
        paidAt,
        createdById: user.id,
      },
      tx
    );

    // Settle the bill in the SAME transaction. A payment that committed without
    // updating paidAmount would leave the payables total permanently wrong, and
    // there is no reconciliation job to catch it.
    if (bill) {
      const newPaid = money(toDecimal(bill.paidAmount).plus(amount));
      const settlement = deriveSettlementStatus({
        total: bill.totalAmount,
        paid: newPaid,
        dueDate: bill.dueDate,
      });

      await repo.updatePurchaseSettlement(
        bill.id,
        {
          paidAmount: newPaid,
          dueAmount: settlement.dueAmount,
          paymentStatus: settlement.status as never,
        },
        tx
      );
    }

    if (input.paymentMethod === "CASH") {
      const registerId = await postToDrawerIfOpen(tx, {
        employeeId: user.id,
        amount,
        reason: `Supplier payment ${paymentNumber} to ${supplier.businessName}`,
        referenceId: created.id,
        referenceType: ReferenceType.SUPPLIER_PAYMENT,
        direction: CashTransactionType.CASH_OUT,
      });
      if (registerId) {
        await tx.supplierPayment.update({ where: { id: created.id }, data: { registerId } });
      }
    }

    return created;
  });

  audit({
    employeeId: user.id,
    action: ActionType.SUPPLIER_PAYMENT_RECORDED,
    module: ActionModule.SUPPLIER_PAYMENT,
    tableName: "supplier_payments",
    recordId: payment.id,
    newData: {
      paymentNumber: payment.paymentNumber,
      supplierId: input.supplierId,
      purchaseId: input.purchaseId ?? null,
      amount: toNumber(amount),
      paymentMethod: input.paymentMethod,
    },
  });

  return toSupplierPaymentDTO(payment);
}

function toSupplierPaymentDTO(p: Awaited<ReturnType<typeof repo.createSupplierPayment>>) {
  return {
    id: p.id,
    paymentNumber: p.paymentNumber,
    amount: toNumber(p.amount),
    paymentMethod: p.paymentMethod,
    referenceNumber: p.referenceNumber,
    notes: p.notes,
    paidAt: p.paidAt,
    registerId: p.registerId,
    supplier: p.supplier,
    purchase: p.purchase
      ? { id: p.purchase.id, purchaseNumber: p.purchase.purchaseNumber }
      : null,
    createdBy: p.createdBy ? { id: p.createdBy.id, name: employeeName(p.createdBy) } : null,
  };
}

export async function listSupplierPayments(query: SupplierPaymentQuery) {
  const w = windowFor(query);
  const where: Prisma.SupplierPaymentWhereInput = {
    paidAt: { gte: w.start, lte: w.end },
  };

  if (query.supplierId) where.supplierId = query.supplierId;
  if (query.purchaseId) where.purchaseId = query.purchaseId;
  if (query.paymentMethod) where.paymentMethod = query.paymentMethod as PaymentMethod;
  if (query.search) {
    where.OR = [
      { paymentNumber: { contains: query.search, mode: "insensitive" } },
      { referenceNumber: { contains: query.search, mode: "insensitive" } },
      { supplier: { businessName: { contains: query.search, mode: "insensitive" } } },
    ];
  }

  const { items, total, totalAmount } = await repo.listSupplierPayments({
    skip: (query.page - 1) * query.limit,
    take: query.limit,
    where,
  });

  return {
    data: items.map((p) => ({
      id: p.id,
      paymentNumber: p.paymentNumber,
      amount: toNumber(p.amount),
      paymentMethod: p.paymentMethod,
      referenceNumber: p.referenceNumber,
      notes: p.notes,
      paidAt: p.paidAt,
      supplier: p.supplier,
      purchase: p.purchase,
      createdBy: p.createdBy ? { id: p.createdBy.id, name: employeeName(p.createdBy) } : null,
    })),
    summary: { totalAmount: toNumber(toDecimal(totalAmount)), count: total },
    meta: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}

export async function setBillDueDate(
  purchaseId: string,
  input: SetBillDueDateInput,
  user: AuthenticatedUser
) {
  const bill = await repo.findPurchaseForSettlement(purchaseId);
  if (!bill) throw new AppError(HTTP_STATUS.NOT_FOUND, "Purchase bill not found.");

  const settlement = deriveSettlementStatus({
    total: bill.totalAmount,
    paid: bill.paidAmount,
    dueDate: input.dueDate,
    isCancelled: bill.status === "CANCELLED",
  });

  const updated = await repo.updatePurchaseSettlement(purchaseId, {
    dueDate: input.dueDate,
    paymentStatus: settlement.status as never,
    dueAmount: settlement.dueAmount,
  });

  audit({
    employeeId: user.id,
    action: ActionType.UPDATE,
    module: ActionModule.SUPPLIER_PAYMENT,
    tableName: "purchases",
    recordId: purchaseId,
    oldData: { dueDate: bill.dueDate, paymentStatus: bill.paymentStatus },
    newData: { dueDate: input.dueDate, paymentStatus: settlement.status },
  });

  return {
    id: updated.id,
    purchaseNumber: updated.purchaseNumber,
    dueDate: updated.dueDate,
    paymentStatus: updated.paymentStatus,
    dueAmount: toNumber(updated.dueAmount),
  };
}

export async function listOpenBillsForSupplier(supplierId: string) {
  const bills = await repo.listOpenBillsForSupplier(supplierId);
  const asOf = new Date();

  return bills.map((b) => {
    const overdue = daysOverdue(b.dueDate, asOf);
    return {
      id: b.id,
      purchaseNumber: b.purchaseNumber,
      purchaseDate: b.purchaseDate,
      dueDate: b.dueDate,
      daysOverdue: overdue,
      ageingBucket: ageingBucket(overdue),
      totalAmount: toNumber(b.totalAmount),
      paidAmount: toNumber(b.paidAmount),
      dueAmount: toNumber(b.dueAmount),
      paymentStatus: b.paymentStatus,
    };
  });
}

export async function listSuppliers() {
  return repo.listSuppliersBrief();
}

// =============================================================================
// PAYROLL
// =============================================================================

/**
 * Generates salary rows for a pay period.
 *
 * IDEMPOTENT by the unique constraint on (employeeId, periodYear, periodMonth):
 * re-running for the same month skips employees who already have a row rather
 * than erroring, so a partially-failed run can simply be re-run. Skipped
 * employees are reported back so the caller sees what happened rather than
 * inferring it from a count.
 */
export async function generatePayroll(input: GeneratePayrollInput, user: AuthenticatedUser) {
  if (!isOwner(user)) {
    throw new AppError(HTTP_STATUS.FORBIDDEN, "Only an owner can generate payroll.");
  }

  const eligible = await repo.listPayrollEligibleEmployees();
  const cohort = input.employeeIds?.length
    ? eligible.filter((e) => input.employeeIds!.includes(e.id))
    : eligible;

  if (cohort.length === 0) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      "No eligible employees found. Payroll requires an active employee with a salary on file.",
      { reason: "NO_ELIGIBLE_EMPLOYEES" }
    );
  }

  const created: string[] = [];
  const skipped: Array<{ employeeId: string; name: string; reason: string }> = [];
  const now = new Date();

  // Sequential rather than parallel: each iteration reads the latest payment
  // number, and a parallel batch would hand the same number to several rows and
  // collide on the unique index.
  for (const employee of cohort) {
    const existing = await repo.findSalaryForPeriod(employee.id, input.periodYear, input.periodMonth);
    if (existing) {
      skipped.push({
        employeeId: employee.id,
        name: employeeName(employee),
        reason: "Salary already generated for this period.",
      });
      continue;
    }

    const baseSalary = money(toDecimal(employee.salary));
    const netPayable = calculateNetSalary({ baseSalary });

    try {
      const row = await prisma.$transaction(async (tx) => {
        const paymentNumber = await repo.nextSalaryPaymentNumber(now, tx);
        return repo.createSalaryPayment(
          {
            paymentNumber,
            employeeId: employee.id,
            periodYear: input.periodYear,
            periodMonth: input.periodMonth,
            baseSalary,
            netPayable,
            dueAmount: netPayable,
            status: "PENDING",
            createdById: user.id,
          },
          tx
        );
      });
      created.push(row.id);
    } catch (err) {
      // A unique-constraint race (two owners generating at once) is not a
      // failure of the run — the row exists, which is the desired end state.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        skipped.push({
          employeeId: employee.id,
          name: employeeName(employee),
          reason: "Salary already generated for this period.",
        });
        continue;
      }
      throw err;
    }
  }

  audit({
    employeeId: user.id,
    action: ActionType.CREATE,
    module: ActionModule.SALARY,
    tableName: "salary_payments",
    recordId: `${input.periodYear}-${String(input.periodMonth).padStart(2, "0")}`,
    newData: { generated: created.length, skipped: skipped.length, period: `${input.periodYear}-${input.periodMonth}` },
  });

  return {
    period: { year: input.periodYear, month: input.periodMonth },
    generated: created.length,
    skipped,
  };
}

type SalaryRow = NonNullable<Awaited<ReturnType<typeof repo.findSalaryPayment>>>;

function toSalaryDTO(s: SalaryRow) {
  return {
    id: s.id,
    paymentNumber: s.paymentNumber,
    employee: s.employee
      ? {
          id: s.employee.id,
          name: employeeName(s.employee),
          employeeCode: s.employee.employeeCode,
          role: s.employee.role,
        }
      : null,
    period: {
      year: s.periodYear,
      month: s.periodMonth,
      label: new Date(s.periodYear, s.periodMonth - 1, 1).toLocaleString("en-IN", {
        month: "long",
        year: "numeric",
      }),
    },
    baseSalary: toNumber(s.baseSalary),
    totalBonus: toNumber(s.totalBonus),
    totalOvertime: toNumber(s.totalOvertime),
    totalIncentive: toNumber(s.totalIncentive),
    totalAdvance: toNumber(s.totalAdvance),
    totalDeduction: toNumber(s.totalDeduction),
    netPayable: toNumber(s.netPayable),
    paidAmount: toNumber(s.paidAmount),
    dueAmount: toNumber(s.dueAmount),
    status: s.status,
    paymentMethod: s.paymentMethod,
    paidAt: s.paidAt,
    referenceNumber: s.referenceNumber,
    notes: s.notes,
    paidBy: s.paidBy ? { id: s.paidBy.id, name: employeeName(s.paidBy) } : null,
    adjustments: s.adjustments.map((a) => ({
      id: a.id,
      type: a.type,
      amount: toNumber(a.amount),
      reason: a.reason,
      createdAt: a.createdAt,
      createdBy: a.createdBy ? { id: a.createdBy.id, name: employeeName(a.createdBy) } : null,
    })),
  };
}

/**
 * Recomputes a salary row's rollups from its adjustments.
 *
 * Called inside the transaction that writes an adjustment. Recomputing from the
 * adjustment rows rather than incrementing a counter means a rollup can never
 * drift out of step with the itemisation the payslip prints.
 */
async function recalculateSalary(
  tx: Prisma.TransactionClient,
  salaryPaymentId: string
): Promise<void> {
  const [salary, groups] = await Promise.all([
    tx.salaryPayment.findUnique({
      where: { id: salaryPaymentId },
      select: { baseSalary: true, paidAmount: true },
    }),
    tx.salaryAdjustment.groupBy({
      by: ["type"],
      where: { salaryPaymentId },
      _sum: { amount: true },
    }),
  ]);

  if (!salary) return;

  const by = (type: SalaryAdjustmentType) =>
    toDecimal(groups.find((g) => g.type === type)?._sum.amount);

  const bonus = by(SalaryAdjustmentType.BONUS).plus(by(SalaryAdjustmentType.REIMBURSEMENT));
  const overtime = by(SalaryAdjustmentType.OVERTIME);
  const incentive = by(SalaryAdjustmentType.INCENTIVE);
  const advance = by(SalaryAdjustmentType.ADVANCE);
  const deduction = by(SalaryAdjustmentType.DEDUCTION);

  const netPayable = calculateNetSalary({
    baseSalary: salary.baseSalary,
    bonus,
    overtime,
    incentive,
    advance,
    deduction,
  });

  const { status, dueAmount } = deriveSalaryStatus(netPayable, salary.paidAmount);

  await tx.salaryPayment.update({
    where: { id: salaryPaymentId },
    data: {
      totalBonus: money(bonus),
      totalOvertime: money(overtime),
      totalIncentive: money(incentive),
      totalAdvance: money(advance),
      totalDeduction: money(deduction),
      netPayable,
      dueAmount,
      status: status as never,
    },
  });
}

export async function addSalaryAdjustment(
  salaryPaymentId: string,
  input: SalaryAdjustmentInput,
  user: AuthenticatedUser
) {
  if (!isOwner(user)) {
    throw new AppError(HTTP_STATUS.FORBIDDEN, "Only an owner can adjust a salary.");
  }

  const salary = await repo.findSalaryPayment(salaryPaymentId);
  if (!salary) throw new AppError(HTTP_STATUS.NOT_FOUND, "Salary record not found.");

  if (salary.status === "PAID") {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      "This salary has been settled in full. Record the adjustment against the next period instead.",
      { reason: "SALARY_ALREADY_PAID" }
    );
  }
  if (salary.status === "CANCELLED") {
    throw new AppError(HTTP_STATUS.CONFLICT, "This salary record has been cancelled.");
  }

  const amount = money(toDecimal(input.amount));

  await prisma.$transaction(async (tx) => {
    const adjustment = await repo.createSalaryAdjustment(
      {
        salaryPaymentId,
        type: input.type as SalaryAdjustmentType,
        amount,
        reason: input.reason,
        createdById: user.id,
      },
      tx
    );

    // An ADVANCE is cash handed over now, so it leaves the drawer now. Bonuses
    // and deductions only change what is owed at settlement — no cash moves.
    if (input.type === "ADVANCE") {
      const registerId = await postToDrawerIfOpen(tx, {
        employeeId: user.id,
        amount,
        reason: `Salary advance to ${employeeName(salary.employee)}: ${input.reason}`,
        referenceId: adjustment.id,
        referenceType: ReferenceType.SALARY_ADJUSTMENT,
        direction: CashTransactionType.CASH_OUT,
      });
      if (registerId) {
        await tx.salaryAdjustment.update({ where: { id: adjustment.id }, data: { registerId } });
      }
    }

    await recalculateSalary(tx, salaryPaymentId);
  });

  audit({
    employeeId: user.id,
    action: ActionType.SALARY_ADJUSTED,
    module: ActionModule.SALARY,
    tableName: "salary_payments",
    recordId: salaryPaymentId,
    newData: { type: input.type, amount: toNumber(amount), reason: input.reason },
  });

  const refreshed = await repo.findSalaryPayment(salaryPaymentId);
  return toSalaryDTO(refreshed!);
}

export async function paySalary(
  salaryPaymentId: string,
  input: PaySalaryInput,
  user: AuthenticatedUser
) {
  if (!isOwner(user)) {
    throw new AppError(HTTP_STATUS.FORBIDDEN, "Only an owner can disburse salary.");
  }

  const salary = await repo.findSalaryPayment(salaryPaymentId);
  if (!salary) throw new AppError(HTTP_STATUS.NOT_FOUND, "Salary record not found.");
  if (salary.status === "PAID") {
    throw new AppError(HTTP_STATUS.CONFLICT, "This salary has already been paid in full.");
  }
  if (salary.status === "CANCELLED") {
    throw new AppError(HTTP_STATUS.CONFLICT, "This salary record has been cancelled.");
  }

  const amount = money(toDecimal(input.amount));

  // Overpaying payroll is a mis-key, and accepting it would make the
  // outstanding-salaries KPI go negative.
  if (amount.greaterThan(toDecimal(salary.dueAmount))) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      `Payment of ₹${amount} exceeds the ₹${salary.dueAmount} still due.`,
      { reason: "OVERPAYMENT", dueAmount: toNumber(salary.dueAmount) }
    );
  }

  const paidAt = input.paidAt ?? new Date();
  const newPaid = money(toDecimal(salary.paidAmount).plus(amount));
  const { status, dueAmount } = deriveSalaryStatus(salary.netPayable, newPaid);

  await prisma.$transaction(async (tx) => {
    await repo.updateSalaryPayment(
      salaryPaymentId,
      {
        paidAmount: newPaid,
        dueAmount,
        status: status as never,
        paymentMethod: input.paymentMethod as PaymentMethod,
        paidAt,
        paidById: user.id,
        referenceNumber: input.referenceNumber ?? null,
        ...(input.notes !== undefined && { notes: input.notes ?? null }),
      },
      tx
    );

    // Salary is an operating cost, so it must also land in the expense ledger —
    // otherwise the P&L would show payroll-free months. This is the ONLY place
    // salary enters the P&L; it is not subtracted again anywhere.
    const expenseCode = await repo.nextExpenseCode(paidAt, tx);
    const categoryId = await resolveSalaryExpenseCategory(tx);

    const expense = await repo.createExpense(
      {
        expenseCode,
        categoryId,
        title: `Salary — ${employeeName(salary.employee)} (${salary.periodMonth}/${salary.periodYear})`,
        amount,
        vendorName: employeeName(salary.employee),
        paymentMethod: input.paymentMethod as PaymentMethod,
        referenceNumber: salary.paymentNumber,
        description: `Salary disbursement ${salary.paymentNumber}`,
        employeeId: user.id,
        expenseDate: paidAt,
        approvalStatus: ApprovalStatus.APPROVED,
        approvedById: user.id,
        approvedAt: paidAt,
      },
      tx
    );

    if (input.paymentMethod === "CASH") {
      const registerId = await postToDrawerIfOpen(tx, {
        employeeId: user.id,
        amount,
        reason: `Salary paid to ${employeeName(salary.employee)} (${salary.paymentNumber})`,
        referenceId: salaryPaymentId,
        referenceType: ReferenceType.SALARY_PAYMENT,
        direction: CashTransactionType.CASH_OUT,
      });
      if (registerId) {
        await Promise.all([
          tx.salaryPayment.update({ where: { id: salaryPaymentId }, data: { registerId } }),
          tx.expense.update({ where: { id: expense.id }, data: { registerId } }),
        ]);
      }
    }
  });

  audit({
    employeeId: user.id,
    action: ActionType.SALARY_PAID,
    module: ActionModule.SALARY,
    tableName: "salary_payments",
    recordId: salaryPaymentId,
    oldData: { paidAmount: toNumber(salary.paidAmount), status: salary.status },
    newData: {
      paidAmount: toNumber(newPaid),
      status,
      amount: toNumber(amount),
      paymentMethod: input.paymentMethod,
    },
  });

  const refreshed = await repo.findSalaryPayment(salaryPaymentId);
  return toSalaryDTO(refreshed!);
}

/** Resolves (creating if absent) the SALARY expense category. */
async function resolveSalaryExpenseCategory(tx: Prisma.TransactionClient): Promise<string> {
  const existing = await tx.expenseCategory.findUnique({ where: { code: "SALARY" } });
  if (existing) return existing.id;

  const byName = await tx.expenseCategory.findUnique({ where: { name: "Salary" } });
  if (byName) {
    const adopted = await tx.expenseCategory.update({
      where: { id: byName.id },
      data: { code: "SALARY", isRecurring: true },
    });
    return adopted.id;
  }

  const created = await tx.expenseCategory.create({
    data: { name: "Salary", code: "SALARY", isRecurring: true, displayOrder: 10 },
  });
  return created.id;
}

export async function listSalaries(query: SalaryQuery) {
  const where: Prisma.SalaryPaymentWhereInput = {};

  if (query.employeeId) where.employeeId = query.employeeId;
  if (query.periodYear) where.periodYear = query.periodYear;
  if (query.periodMonth) where.periodMonth = query.periodMonth;
  if (query.status) where.status = query.status as never;
  if (query.search) {
    where.OR = [
      { paymentNumber: { contains: query.search, mode: "insensitive" } },
      { employee: { firstName: { contains: query.search, mode: "insensitive" } } },
      { employee: { lastName: { contains: query.search, mode: "insensitive" } } },
      { employee: { employeeCode: { contains: query.search, mode: "insensitive" } } },
    ];
  }

  const { items, total, totals } = await repo.listSalaryPayments({
    skip: (query.page - 1) * query.limit,
    take: query.limit,
    where,
  });

  return {
    data: items.map((s) => ({
      id: s.id,
      paymentNumber: s.paymentNumber,
      employee: s.employee
        ? { id: s.employee.id, name: employeeName(s.employee), employeeCode: s.employee.employeeCode, role: s.employee.role }
        : null,
      period: {
        year: s.periodYear,
        month: s.periodMonth,
        label: new Date(s.periodYear, s.periodMonth - 1, 1).toLocaleString("en-IN", {
          month: "short",
          year: "numeric",
        }),
      },
      baseSalary: toNumber(s.baseSalary),
      totalBonus: toNumber(s.totalBonus),
      totalAdvance: toNumber(s.totalAdvance),
      totalDeduction: toNumber(s.totalDeduction),
      netPayable: toNumber(s.netPayable),
      paidAmount: toNumber(s.paidAmount),
      dueAmount: toNumber(s.dueAmount),
      status: s.status,
      paidAt: s.paidAt,
      paidBy: s.paidBy ? { id: s.paidBy.id, name: employeeName(s.paidBy) } : null,
    })),
    summary: {
      count: total,
      totalBase: toNumber(toDecimal(totals.baseSalary)),
      totalBonus: toNumber(toDecimal(totals.totalBonus)),
      totalAdvance: toNumber(toDecimal(totals.totalAdvance)),
      totalDeduction: toNumber(toDecimal(totals.totalDeduction)),
      totalNetPayable: toNumber(toDecimal(totals.netPayable)),
      totalPaid: toNumber(toDecimal(totals.paidAmount)),
      totalDue: toNumber(toDecimal(totals.dueAmount)),
    },
    meta: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}

export async function getSalary(id: string) {
  const salary = await repo.findSalaryPayment(id);
  if (!salary) throw new AppError(HTTP_STATUS.NOT_FOUND, "Salary record not found.");
  return toSalaryDTO(salary);
}

/** Exposed for the export service so it builds the same filtered set. */
export const internals = { buildExpenseWhere, windowFor, toExpenseDTO };
