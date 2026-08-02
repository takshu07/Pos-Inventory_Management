// =============================================================================
// FINANCE REPOSITORY  —  Prisma access for revenue, expenses, payables, payroll
//
// Aggregations that Prisma's fluent API cannot express — a SUM over a product
// of two columns, a date_trunc time series, a grouped join across three tables
// — are written as raw SQL. That is a deliberate boundary, not a shortcut:
// fetching rows to multiply them in Node would move the whole sales table over
// the wire to compute one number.
//
// TWO RULES FOR EVERY RAW QUERY HERE
// ----------------------------------
//   1. Table names are the @@map'd lowercase names ("sale_items", not
//      "SaleItem"). Prisma's @@map means the model name does not exist in
//      Postgres, and a query using it fails at runtime, never at compile time.
//   2. Every value is a `${}` tagged-template parameter, never string
//      concatenation. The only interpolated identifiers are date_trunc units,
//      which come from a closed whitelist in the engine — nothing user-supplied
//      is ever spliced into SQL text.
// =============================================================================

import { Prisma, PaymentMethod, ApprovalStatus, SaleStatus } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import { buildDocumentNumber, parseDocumentSequence, type Granularity, truncUnit } from "../engines/finance.engine";

type Db = Prisma.TransactionClient | typeof prisma;
const db = (tx?: Prisma.TransactionClient): Db => tx ?? prisma;

const EMPLOYEE_BRIEF = {
  id: true,
  firstName: true,
  lastName: true,
  employeeCode: true,
  role: true,
} as const;

export interface Window {
  start: Date;
  end: Date;
}

export const financeRepository = {
  // ===========================================================================
  // REVENUE
  // ===========================================================================

  /** Bill-level revenue aggregates for a window. */
  async revenueTotals(w: Window) {
    const where: Prisma.SaleWhereInput = {
      status: SaleStatus.COMPLETED,
      saleDate: { gte: w.start, lte: w.end },
    };

    const [agg, count] = await Promise.all([
      prisma.sale.aggregate({
        where,
        _sum: {
          grandTotal: true,
          subtotal: true,
          discountAmount: true,
          manualDiscountAmount: true,
          taxAmount: true,
        },
      }),
      prisma.sale.count({ where }),
    ]);

    return {
      grandTotal: agg._sum.grandTotal,
      subtotal: agg._sum.subtotal,
      discount: new Prisma.Decimal(agg._sum.discountAmount ?? 0).plus(
        agg._sum.manualDiscountAmount ?? 0
      ),
      tax: agg._sum.taxAmount,
      orderCount: count,
    };
  },

  /**
   * Cost of goods sold for a window.
   *
   * SUM(costAtSale * quantity) is a column-to-column multiply, which Prisma's
   * aggregate API cannot express — hence raw SQL. `costAtSale` is the snapshot
   * taken at sale time, so a later supplier price change never rewrites a past
   * margin.
   */
  async cogsTotal(w: Window): Promise<Prisma.Decimal> {
    const rows = await prisma.$queryRaw<Array<{ cogs: Prisma.Decimal | null }>>`
      SELECT COALESCE(SUM(si."costAtSale" * si."quantity"), 0)::numeric AS cogs
        FROM "sale_items" si
        JOIN "sales" s ON s.id = si."saleId"
       WHERE s.status = 'COMPLETED'
         AND s."saleDate" >= ${w.start}
         AND s."saleDate" <= ${w.end}
    `;
    return new Prisma.Decimal(rows[0]?.cogs ?? 0);
  },

  /** Payment totals by tender for a window. */
  async paymentsByMethod(w: Window) {
    return prisma.payment.groupBy({
      by: ["method"],
      where: {
        status: "PAID",
        paidAt: { gte: w.start, lte: w.end },
        sale: { status: SaleStatus.COMPLETED },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
  },

  /**
   * Revenue time series, bucketed by `granularity`.
   *
   * The trunc unit is interpolated with Prisma.raw because Postgres will not
   * accept a bind parameter in date_trunc's first argument. It is safe only
   * because `truncUnit()` maps to a closed set of four literals — no caller
   * input reaches this string.
   */
  async revenueSeries(w: Window, granularity: Granularity) {
    const unit = Prisma.raw(`'${truncUnit(granularity)}'`);

    return prisma.$queryRaw<
      Array<{ bucket: Date; revenue: Prisma.Decimal; orders: bigint; discount: Prisma.Decimal; tax: Prisma.Decimal }>
    >`
      SELECT date_trunc(${unit}, s."saleDate")           AS bucket,
             COALESCE(SUM(s."grandTotal"), 0)::numeric    AS revenue,
             COUNT(*)                                     AS orders,
             COALESCE(SUM(s."discountAmount" + s."manualDiscountAmount"), 0)::numeric AS discount,
             COALESCE(SUM(s."taxAmount"), 0)::numeric     AS tax
        FROM "sales" s
       WHERE s.status = 'COMPLETED'
         AND s."saleDate" >= ${w.start}
         AND s."saleDate" <= ${w.end}
       GROUP BY 1
       ORDER BY 1 ASC
    `;
  },

  /** COGS time series, so the profit chart can plot margin per bucket. */
  async cogsSeries(w: Window, granularity: Granularity) {
    const unit = Prisma.raw(`'${truncUnit(granularity)}'`);

    return prisma.$queryRaw<Array<{ bucket: Date; cogs: Prisma.Decimal }>>`
      SELECT date_trunc(${unit}, s."saleDate")                       AS bucket,
             COALESCE(SUM(si."costAtSale" * si."quantity"), 0)::numeric AS cogs
        FROM "sale_items" si
        JOIN "sales" s ON s.id = si."saleId"
       WHERE s.status = 'COMPLETED'
         AND s."saleDate" >= ${w.start}
         AND s."saleDate" <= ${w.end}
       GROUP BY 1
       ORDER BY 1 ASC
    `;
  },

  /** Expense time series, aligned to the same buckets as revenue. */
  async expenseSeries(w: Window, granularity: Granularity) {
    const unit = Prisma.raw(`'${truncUnit(granularity)}'`);

    return prisma.$queryRaw<Array<{ bucket: Date; expense: Prisma.Decimal }>>`
      SELECT date_trunc(${unit}, e."expenseDate")     AS bucket,
             COALESCE(SUM(e."amount"), 0)::numeric     AS expense
        FROM "expenses" e
       WHERE e."approvalStatus" = 'APPROVED'
         AND e."expenseDate" >= ${w.start}
         AND e."expenseDate" <= ${w.end}
       GROUP BY 1
       ORDER BY 1 ASC
    `;
  },

  // ===========================================================================
  // REFUNDS & EXCHANGES
  // ===========================================================================

  /** Refund value in a window — negative price differences on exchanges. */
  async refundTotal(w: Window): Promise<Prisma.Decimal> {
    const agg = await prisma.exchange.aggregate({
      where: {
        status: "COMPLETED",
        exchangeDate: { gte: w.start, lte: w.end },
        priceDifference: { lt: 0 },
      },
      _sum: { priceDifference: true },
    });
    return new Prisma.Decimal(agg._sum.priceDifference ?? 0).abs();
  },

  async exchangeTotals(w: Window) {
    const agg = await prisma.exchange.aggregate({
      where: { status: "COMPLETED", exchangeDate: { gte: w.start, lte: w.end } },
      _sum: { issuedValue: true, returnedValue: true, priceDifference: true },
      _count: { _all: true },
    });
    return {
      issued: agg._sum.issuedValue,
      returned: agg._sum.returnedValue,
      priceDifference: agg._sum.priceDifference,
      count: agg._count._all,
    };
  },

  // ===========================================================================
  // EXPENSES
  // ===========================================================================

  async createExpense(data: Prisma.ExpenseUncheckedCreateInput, tx?: Prisma.TransactionClient) {
    return db(tx).expense.create({
      data,
      include: {
        category: true,
        employee: { select: EMPLOYEE_BRIEF },
        approvedBy: { select: EMPLOYEE_BRIEF },
      },
    });
  },

  async findExpenseById(id: string, tx?: Prisma.TransactionClient) {
    return db(tx).expense.findUnique({
      where: { id },
      include: {
        category: true,
        employee: { select: EMPLOYEE_BRIEF },
        approvedBy: { select: EMPLOYEE_BRIEF },
        payout: { select: { id: true, payoutNumber: true, registerId: true } },
      },
    });
  },

  async updateExpense(
    id: string,
    data: Prisma.ExpenseUncheckedUpdateInput,
    tx?: Prisma.TransactionClient
  ) {
    return db(tx).expense.update({
      where: { id },
      data,
      include: {
        category: true,
        employee: { select: EMPLOYEE_BRIEF },
        approvedBy: { select: EMPLOYEE_BRIEF },
      },
    });
  },

  async listExpenses(params: {
    skip: number;
    take: number;
    where: Prisma.ExpenseWhereInput;
    orderBy: Prisma.ExpenseOrderByWithRelationInput;
  }) {
    const [items, total, agg, byStatus] = await Promise.all([
      prisma.expense.findMany({
        skip: params.skip,
        take: params.take,
        where: params.where,
        orderBy: params.orderBy,
        include: {
          category: true,
          employee: { select: EMPLOYEE_BRIEF },
          approvedBy: { select: EMPLOYEE_BRIEF },
        },
      }),
      prisma.expense.count({ where: params.where }),
      prisma.expense.aggregate({ where: params.where, _sum: { amount: true } }),
      prisma.expense.groupBy({
        by: ["approvalStatus"],
        where: params.where,
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    return { items, total, totalAmount: agg._sum.amount, byStatus };
  },

  /** Approved expense total for a window — the P&L's operating-expense line. */
  async approvedExpenseTotal(w: Window): Promise<Prisma.Decimal> {
    const agg = await prisma.expense.aggregate({
      where: {
        approvalStatus: ApprovalStatus.APPROVED,
        expenseDate: { gte: w.start, lte: w.end },
      },
      _sum: { amount: true },
    });
    return new Prisma.Decimal(agg._sum.amount ?? 0);
  },

  /** Expense breakdown by category, for the donut chart and the P&L detail. */
  async expensesByCategory(w: Window) {
    return prisma.$queryRaw<
      Array<{ categoryId: string; name: string; isRecurring: boolean; amount: Prisma.Decimal; count: bigint }>
    >`
      SELECT c.id                                  AS "categoryId",
             c.name                                AS name,
             c."isRecurring"                       AS "isRecurring",
             COALESCE(SUM(e.amount), 0)::numeric   AS amount,
             COUNT(e.id)                           AS count
        FROM "expenses" e
        JOIN "expense_categories" c ON c.id = e."categoryId"
       WHERE e."approvalStatus" = 'APPROVED'
         AND e."expenseDate" >= ${w.start}
         AND e."expenseDate" <= ${w.end}
       GROUP BY c.id, c.name, c."isRecurring"
       ORDER BY amount DESC
    `;
  },

  async listExpenseCategories() {
    return prisma.expenseCategory.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });
  },

  async createExpenseCategory(data: Prisma.ExpenseCategoryUncheckedCreateInput) {
    return prisma.expenseCategory.create({ data });
  },

  async nextExpenseCode(date: Date, tx?: Prisma.TransactionClient): Promise<string> {
    const prefix = buildDocumentNumber("EXP", date, 0).slice(0, -5);
    const last = await db(tx).expense.findFirst({
      where: { expenseCode: { startsWith: prefix } },
      orderBy: { expenseCode: "desc" },
      select: { expenseCode: true },
    });
    return buildDocumentNumber("EXP", date, parseDocumentSequence(last?.expenseCode) + 1);
  },

  // ===========================================================================
  // SUPPLIER PAYABLES
  // ===========================================================================

  async findPurchaseForSettlement(id: string, tx?: Prisma.TransactionClient) {
    return db(tx).purchase.findUnique({
      where: { id },
      select: {
        id: true,
        purchaseNumber: true,
        supplierId: true,
        totalAmount: true,
        paidAmount: true,
        dueAmount: true,
        paymentStatus: true,
        dueDate: true,
        status: true,
      },
    });
  },

  async updatePurchaseSettlement(
    id: string,
    data: Prisma.PurchaseUncheckedUpdateInput,
    tx?: Prisma.TransactionClient
  ) {
    return db(tx).purchase.update({ where: { id }, data });
  },

  async listPayables(params: {
    skip: number;
    take: number;
    where: Prisma.PurchaseWhereInput;
    orderBy: Prisma.PurchaseOrderByWithRelationInput;
  }) {
    const [items, total, agg] = await Promise.all([
      prisma.purchase.findMany({
        skip: params.skip,
        take: params.take,
        where: params.where,
        orderBy: params.orderBy,
        select: {
          id: true,
          purchaseNumber: true,
          supplierInvoiceNumber: true,
          purchaseDate: true,
          dueDate: true,
          totalAmount: true,
          paidAmount: true,
          dueAmount: true,
          paymentStatus: true,
          status: true,
          supplier: { select: { id: true, businessName: true, phone: true, contactPerson: true } },
        },
      }),
      prisma.purchase.count({ where: params.where }),
      prisma.purchase.aggregate({
        where: params.where,
        _sum: { totalAmount: true, paidAmount: true, dueAmount: true },
      }),
    ]);

    return { items, total, totals: agg._sum };
  },

  /** Total outstanding supplier payables — a headline KPI. */
  async outstandingPayables(): Promise<Prisma.Decimal> {
    const agg = await prisma.purchase.aggregate({
      where: { paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID", "OVERDUE"] } },
      _sum: { dueAmount: true },
    });
    return new Prisma.Decimal(agg._sum.dueAmount ?? 0);
  },

  /**
   * Payables grouped by supplier, with an ageing breakdown.
   *
   * The FILTER clauses compute all four ageing buckets in ONE pass. Four
   * separate queries would each re-scan the same rows, and a join per bucket
   * would multiply the cost by four for a screen that is already the slowest
   * in the module.
   */
  async payablesBySupplier(asOf: Date) {
    return prisma.$queryRaw<
      Array<{
        supplierId: string;
        businessName: string;
        phone: string;
        billCount: bigint;
        totalAmount: Prisma.Decimal;
        paidAmount: Prisma.Decimal;
        dueAmount: Prisma.Decimal;
        current: Prisma.Decimal;
        days0_30: Prisma.Decimal;
        days31_60: Prisma.Decimal;
        days61_90: Prisma.Decimal;
        days90plus: Prisma.Decimal;
      }>
    >`
      SELECT s.id                                        AS "supplierId",
             s."businessName"                            AS "businessName",
             s.phone                                     AS phone,
             COUNT(p.id)                                 AS "billCount",
             COALESCE(SUM(p."totalAmount"), 0)::numeric  AS "totalAmount",
             COALESCE(SUM(p."paidAmount"), 0)::numeric   AS "paidAmount",
             COALESCE(SUM(p."dueAmount"), 0)::numeric    AS "dueAmount",
             COALESCE(SUM(p."dueAmount") FILTER (
               WHERE p."dueDate" IS NULL OR p."dueDate" >= ${asOf}), 0)::numeric AS current,
             COALESCE(SUM(p."dueAmount") FILTER (
               WHERE p."dueDate" < ${asOf}
                 AND p."dueDate" >= ${asOf}::timestamp - INTERVAL '30 days'), 0)::numeric AS "days0_30",
             COALESCE(SUM(p."dueAmount") FILTER (
               WHERE p."dueDate" < ${asOf}::timestamp - INTERVAL '30 days'
                 AND p."dueDate" >= ${asOf}::timestamp - INTERVAL '60 days'), 0)::numeric AS "days31_60",
             COALESCE(SUM(p."dueAmount") FILTER (
               WHERE p."dueDate" < ${asOf}::timestamp - INTERVAL '60 days'
                 AND p."dueDate" >= ${asOf}::timestamp - INTERVAL '90 days'), 0)::numeric AS "days61_90",
             COALESCE(SUM(p."dueAmount") FILTER (
               WHERE p."dueDate" < ${asOf}::timestamp - INTERVAL '90 days'), 0)::numeric AS "days90plus"
        FROM "purchases" p
        JOIN "suppliers" s ON s.id = p."supplierId"
       WHERE p."paymentStatus" IN ('UNPAID', 'PARTIALLY_PAID', 'OVERDUE')
       GROUP BY s.id, s."businessName", s.phone
      HAVING COALESCE(SUM(p."dueAmount"), 0) > 0
       ORDER BY "dueAmount" DESC
    `;
  },

  /** Marks bills whose due date has passed as OVERDUE. Idempotent. */
  async refreshOverduePayables(asOf: Date): Promise<number> {
    const result = await prisma.purchase.updateMany({
      where: {
        paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] },
        dueDate: { lt: asOf },
        dueAmount: { gt: 0 },
      },
      data: { paymentStatus: "OVERDUE" },
    });
    return result.count;
  },

  // ===========================================================================
  // SUPPLIER PAYMENTS
  // ===========================================================================

  async createSupplierPayment(
    data: Prisma.SupplierPaymentUncheckedCreateInput,
    tx?: Prisma.TransactionClient
  ) {
    return db(tx).supplierPayment.create({
      data,
      include: {
        supplier: { select: { id: true, businessName: true, phone: true } },
        purchase: { select: { id: true, purchaseNumber: true, totalAmount: true } },
        createdBy: { select: EMPLOYEE_BRIEF },
      },
    });
  },

  async listSupplierPayments(params: {
    skip: number;
    take: number;
    where: Prisma.SupplierPaymentWhereInput;
  }) {
    const [items, total, agg] = await Promise.all([
      prisma.supplierPayment.findMany({
        skip: params.skip,
        take: params.take,
        where: params.where,
        orderBy: { paidAt: "desc" },
        include: {
          supplier: { select: { id: true, businessName: true, phone: true } },
          purchase: { select: { id: true, purchaseNumber: true } },
          createdBy: { select: EMPLOYEE_BRIEF },
        },
      }),
      prisma.supplierPayment.count({ where: params.where }),
      prisma.supplierPayment.aggregate({ where: params.where, _sum: { amount: true } }),
    ]);
    return { items, total, totalAmount: agg._sum.amount };
  },

  async supplierPaymentTotal(w: Window): Promise<Prisma.Decimal> {
    const agg = await prisma.supplierPayment.aggregate({
      where: { paidAt: { gte: w.start, lte: w.end } },
      _sum: { amount: true },
    });
    return new Prisma.Decimal(agg._sum.amount ?? 0);
  },

  async nextSupplierPaymentNumber(date: Date, tx?: Prisma.TransactionClient): Promise<string> {
    const prefix = buildDocumentNumber("SP", date, 0).slice(0, -5);
    const last = await db(tx).supplierPayment.findFirst({
      where: { paymentNumber: { startsWith: prefix } },
      orderBy: { paymentNumber: "desc" },
      select: { paymentNumber: true },
    });
    return buildDocumentNumber("SP", date, parseDocumentSequence(last?.paymentNumber) + 1);
  },

  // ===========================================================================
  // PAYROLL
  // ===========================================================================

  async findSalaryPayment(id: string, tx?: Prisma.TransactionClient) {
    return db(tx).salaryPayment.findUnique({
      where: { id },
      include: {
        employee: { select: { ...EMPLOYEE_BRIEF, salary: true } },
        createdBy: { select: EMPLOYEE_BRIEF },
        paidBy: { select: EMPLOYEE_BRIEF },
        adjustments: {
          orderBy: { createdAt: "asc" },
          include: { createdBy: { select: EMPLOYEE_BRIEF } },
        },
      },
    });
  },

  async findSalaryForPeriod(
    employeeId: string,
    periodYear: number,
    periodMonth: number,
    tx?: Prisma.TransactionClient
  ) {
    return db(tx).salaryPayment.findUnique({
      where: { employeeId_periodYear_periodMonth: { employeeId, periodYear, periodMonth } },
    });
  },

  async createSalaryPayment(
    data: Prisma.SalaryPaymentUncheckedCreateInput,
    tx?: Prisma.TransactionClient
  ) {
    return db(tx).salaryPayment.create({ data });
  },

  async updateSalaryPayment(
    id: string,
    data: Prisma.SalaryPaymentUncheckedUpdateInput,
    tx?: Prisma.TransactionClient
  ) {
    return db(tx).salaryPayment.update({ where: { id }, data });
  },

  async createSalaryAdjustment(
    data: Prisma.SalaryAdjustmentUncheckedCreateInput,
    tx?: Prisma.TransactionClient
  ) {
    return db(tx).salaryAdjustment.create({ data });
  },

  async listSalaryPayments(params: {
    skip: number;
    take: number;
    where: Prisma.SalaryPaymentWhereInput;
  }) {
    const [items, total, agg] = await Promise.all([
      prisma.salaryPayment.findMany({
        skip: params.skip,
        take: params.take,
        where: params.where,
        orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { createdAt: "desc" }],
        include: {
          employee: { select: EMPLOYEE_BRIEF },
          paidBy: { select: EMPLOYEE_BRIEF },
        },
      }),
      prisma.salaryPayment.count({ where: params.where }),
      prisma.salaryPayment.aggregate({
        where: params.where,
        _sum: {
          baseSalary: true,
          totalBonus: true,
          totalAdvance: true,
          totalDeduction: true,
          netPayable: true,
          paidAmount: true,
          dueAmount: true,
        },
      }),
    ]);
    return { items, total, totals: agg._sum };
  },

  /** Total unpaid salary — a headline KPI. */
  async outstandingSalaries(): Promise<Prisma.Decimal> {
    const agg = await prisma.salaryPayment.aggregate({
      where: { status: { in: ["PENDING", "PARTIALLY_PAID"] } },
      _sum: { dueAmount: true },
    });
    return new Prisma.Decimal(agg._sum.dueAmount ?? 0);
  },

  async salaryPaidTotal(w: Window): Promise<Prisma.Decimal> {
    const agg = await prisma.salaryPayment.aggregate({
      where: { paidAt: { gte: w.start, lte: w.end } },
      _sum: { paidAmount: true },
    });
    return new Prisma.Decimal(agg._sum.paidAmount ?? 0);
  },

  /** Active employees with a salary on file — the payroll-generation cohort. */
  async listPayrollEligibleEmployees() {
    return prisma.employee.findMany({
      where: { isActive: true, salary: { not: null }, employmentStatus: { not: "TERMINATED" } },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, role: true, salary: true },
      orderBy: { employeeCode: "asc" },
    });
  },

  async nextSalaryPaymentNumber(date: Date, tx?: Prisma.TransactionClient): Promise<string> {
    const prefix = buildDocumentNumber("SAL", date, 0).slice(0, -5);
    const last = await db(tx).salaryPayment.findFirst({
      where: { paymentNumber: { startsWith: prefix } },
      orderBy: { paymentNumber: "desc" },
      select: { paymentNumber: true },
    });
    return buildDocumentNumber("SAL", date, parseDocumentSequence(last?.paymentNumber) + 1);
  },

  // ===========================================================================
  // CASH POSITION & INVENTORY VALUE
  // ===========================================================================

  /**
   * Cash currently sitting in all open drawers.
   *
   * Computed from the drawer ledger rather than from `closingBalance`, which is
   * null while a shift is open. Summing opening floats plus net ledger movement
   * is the only figure that is correct mid-shift.
   */
  async cashInDrawers(): Promise<Prisma.Decimal> {
    const rows = await prisma.$queryRaw<Array<{ total: Prisma.Decimal | null }>>`
      SELECT COALESCE(SUM(
               r."openingBalance"
               + COALESCE(l."cash_in", 0)
               - COALESCE(l."cash_out", 0)
             ), 0)::numeric AS total
        FROM "cash_registers" r
        LEFT JOIN (
          SELECT t."registerId",
                 SUM(t.amount) FILTER (WHERE t.type = 'CASH_IN')  AS "cash_in",
                 SUM(t.amount) FILTER (WHERE t.type = 'CASH_OUT') AS "cash_out"
            FROM "cash_transactions" t
           GROUP BY t."registerId"
        ) l ON l."registerId" = r.id
       WHERE r.status = 'OPEN'
    `;
    return new Prisma.Decimal(rows[0]?.total ?? 0);
  },

  /** Inventory valuation at cost and at retail. */
  async inventoryValue() {
    const rows = await prisma.$queryRaw<
      Array<{ costValue: Prisma.Decimal; retailValue: Prisma.Decimal; units: bigint }>
    >`
      SELECT COALESCE(SUM(v."currentStock" * v."costPrice"), 0)::numeric    AS "costValue",
             COALESCE(SUM(v."currentStock" * v."sellingPrice"), 0)::numeric AS "retailValue",
             COALESCE(SUM(GREATEST(v."currentStock", 0)), 0)                AS units
        FROM "product_variants" v
       WHERE v."isActive" = true
         AND v."currentStock" > 0
    `;
    return {
      costValue: new Prisma.Decimal(rows[0]?.costValue ?? 0),
      retailValue: new Prisma.Decimal(rows[0]?.retailValue ?? 0),
      units: Number(rows[0]?.units ?? 0),
    };
  },

  // ===========================================================================
  // CASH FLOW
  // ===========================================================================

  /** Drawer ledger movement in a window, split by direction. */
  async drawerFlow(w: Window) {
    const rows = await prisma.cashTransaction.groupBy({
      by: ["type"],
      where: { createdAt: { gte: w.start, lte: w.end } },
      _sum: { amount: true },
    });

    let cashIn = new Prisma.Decimal(0);
    let cashOut = new Prisma.Decimal(0);
    for (const r of rows) {
      if (r.type === "CASH_IN") cashIn = cashIn.plus(r._sum.amount ?? 0);
      else cashOut = cashOut.plus(r._sum.amount ?? 0);
    }
    return { cashIn, cashOut };
  },

  async dropAndPayoutTotals(w: Window) {
    const [drops, payouts] = await Promise.all([
      prisma.cashDrop.aggregate({
        where: { createdAt: { gte: w.start, lte: w.end } },
        _sum: { amount: true },
      }),
      prisma.cashPayout.aggregate({
        where: { createdAt: { gte: w.start, lte: w.end }, approvalStatus: { not: "REJECTED" } },
        _sum: { amount: true },
      }),
    ]);
    return {
      drops: new Prisma.Decimal(drops._sum.amount ?? 0),
      payouts: new Prisma.Decimal(payouts._sum.amount ?? 0),
    };
  },

  /** Cash-flow time series: money in and out per bucket. */
  async cashFlowSeries(w: Window, granularity: Granularity) {
    const unit = Prisma.raw(`'${truncUnit(granularity)}'`);

    return prisma.$queryRaw<Array<{ bucket: Date; moneyIn: Prisma.Decimal; moneyOut: Prisma.Decimal }>>`
      SELECT date_trunc(${unit}, t."createdAt") AS bucket,
             COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'CASH_IN'), 0)::numeric  AS "moneyIn",
             COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'CASH_OUT'), 0)::numeric AS "moneyOut"
        FROM "cash_transactions" t
       WHERE t."createdAt" >= ${w.start}
         AND t."createdAt" <= ${w.end}
       GROUP BY 1
       ORDER BY 1 ASC
    `;
  },

  // ===========================================================================
  // CONVENIENCE
  // ===========================================================================

  async listSuppliersBrief() {
    return prisma.supplier.findMany({
      where: { isActive: true },
      select: { id: true, businessName: true, phone: true },
      orderBy: { businessName: "asc" },
    });
  },

  /** Non-cancelled bills for one supplier that still owe money. */
  async listOpenBillsForSupplier(supplierId: string) {
    return prisma.purchase.findMany({
      where: { supplierId, dueAmount: { gt: 0 }, status: { not: "CANCELLED" } },
      select: {
        id: true,
        purchaseNumber: true,
        purchaseDate: true,
        dueDate: true,
        totalAmount: true,
        paidAmount: true,
        dueAmount: true,
        paymentStatus: true,
      },
      orderBy: { purchaseDate: "asc" },
    });
  },
};

export type PaymentMethodKey = keyof typeof PaymentMethod;
