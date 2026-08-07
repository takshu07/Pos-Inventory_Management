// =============================================================================
// CASH REGISTER REPOSITORY  —  Prisma access for the drawer/shift module
//
// Every function accepts an optional `tx` so a caller can compose several of
// them inside one transaction. Opening a register writes a session row, a
// ledger-anchoring activity and an audit trail; if any of those can land
// without the others, a drawer can exist with no opening event, which makes its
// timeline start mid-story.
//
// No business rules live here. "You cannot open a second session on REG-01" is
// a service-layer decision; this file only knows how to ask Postgres questions.
// =============================================================================

import { Prisma, RegisterStatus, CashTransactionType, ReferenceType, SaleStatus, PaymentStatus, PaymentMethod } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import { buildDocumentNumber, parseDocumentSequence } from "../engines/cashRegister.engine";

type Db = Prisma.TransactionClient | typeof prisma;
const db = (tx?: Prisma.TransactionClient): Db => tx ?? prisma;

/**
 * Employee shape embedded in every register payload.
 * Selected explicitly rather than `include: { employee: true }` so a password
 * hash can never ride along into an API response.
 */
export const EMPLOYEE_BRIEF = {
  id: true,
  firstName: true,
  lastName: true,
  employeeCode: true,
  role: true,
} as const;

const REGISTER_INCLUDE = {
  openedBy: { select: EMPLOYEE_BRIEF },
  closedBy: { select: EMPLOYEE_BRIEF },
  reconciledBy: { select: EMPLOYEE_BRIEF },
} as const;

export const cashRegisterRepository = {
  // ===========================================================================
  // SESSION LOOKUP
  // ===========================================================================

  /**
   * The open session for a specific till, or for ANY till when no number is
   * given. Used both to block a double-open and to answer "can this cashier
   * sell right now?".
   */
  async findOpenSession(registerNumber?: string, tx?: Prisma.TransactionClient) {
    return db(tx).cashRegister.findFirst({
      where: {
        status: RegisterStatus.OPEN,
        ...(registerNumber ? { registerNumber } : {}),
      },
      include: REGISTER_INCLUDE,
      orderBy: { openedAt: "desc" },
    });
  },

  /** The open session belonging to one employee — their own drawer. */
  async findOpenSessionForEmployee(employeeId: string, tx?: Prisma.TransactionClient) {
    return db(tx).cashRegister.findFirst({
      where: { status: RegisterStatus.OPEN, openedById: employeeId },
      include: REGISTER_INCLUDE,
      orderBy: { openedAt: "desc" },
    });
  },

  async findById(id: string, tx?: Prisma.TransactionClient) {
    return db(tx).cashRegister.findUnique({
      where: { id },
      include: REGISTER_INCLUDE,
    });
  },

  /** Distinct till identifiers seen so far — powers the register filter. */
  async listRegisterNumbers(): Promise<string[]> {
    const rows = await prisma.cashRegister.findMany({
      distinct: ["registerNumber"],
      select: { registerNumber: true },
      orderBy: { registerNumber: "asc" },
    });
    return rows.map((r) => r.registerNumber);
  },

  // ===========================================================================
  // SESSION MUTATIONS
  // ===========================================================================

  async createSession(data: Prisma.CashRegisterUncheckedCreateInput, tx?: Prisma.TransactionClient) {
    return db(tx).cashRegister.create({ data, include: REGISTER_INCLUDE });
  },

  async updateSession(
    id: string,
    data: Prisma.CashRegisterUncheckedUpdateInput,
    tx?: Prisma.TransactionClient
  ) {
    return db(tx).cashRegister.update({ where: { id }, data, include: REGISTER_INCLUDE });
  },

  /**
   * Paginated register history with full filtering.
   * Returns rows and total in ONE parallel batch — on a remote database two
   * awaited queries cost two round-trips for no reason.
   */
  async listSessions(params: {
    skip: number;
    take: number;
    where: Prisma.CashRegisterWhereInput;
    orderBy: Prisma.CashRegisterOrderByWithRelationInput;
  }) {
    const [items, total] = await Promise.all([
      prisma.cashRegister.findMany({
        skip: params.skip,
        take: params.take,
        where: params.where,
        orderBy: params.orderBy,
        include: REGISTER_INCLUDE,
      }),
      prisma.cashRegister.count({ where: params.where }),
    ]);
    return { items, total };
  },

  /** Aggregate totals across a filtered set of sessions, for the history header. */
  async aggregateSessions(where: Prisma.CashRegisterWhereInput) {
    const [totals, counts] = await Promise.all([
      prisma.cashRegister.aggregate({
        where,
        _sum: {
          openingBalance: true,
          expectedBalance: true,
          countedCash: true,
          difference: true,
          cashSales: true,
          upiSales: true,
          cardSales: true,
          cashDropTotal: true,
          cashPayoutTotal: true,
          transactionCount: true,
        },
      }),
      prisma.cashRegister.groupBy({ by: ["status"], where, _count: { _all: true } }),
    ]);
    return { totals, counts };
  },

  // ===========================================================================
  // DRAWER LEDGER
  // ===========================================================================

  async createCashTransaction(
    data: Prisma.CashTransactionUncheckedCreateInput,
    tx?: Prisma.TransactionClient
  ) {
    return db(tx).cashTransaction.create({ data });
  },

  /** Directional totals for one session — the input to expected-cash math. */
  async sumLedgerByDirection(registerId: string, tx?: Prisma.TransactionClient) {
    return db(tx).cashTransaction.groupBy({
      by: ["type"],
      where: { registerId },
      _sum: { amount: true },
    });
  },

  async listCashTransactions(registerId: string, take = 200) {
    return prisma.cashTransaction.findMany({
      where: { registerId },
      orderBy: { createdAt: "desc" },
      take,
      include: { employee: { select: EMPLOYEE_BRIEF } },
    });
  },

  // ===========================================================================
  // ACTIVITY TIMELINE
  // ===========================================================================

  async createActivity(
    data: Prisma.RegisterActivityUncheckedCreateInput,
    tx?: Prisma.TransactionClient
  ) {
    return db(tx).registerActivity.create({ data });
  },

  async listActivities(params: {
    registerId: string;
    skip: number;
    take: number;
    type?: Prisma.RegisterActivityWhereInput["type"];
  }) {
    const where: Prisma.RegisterActivityWhereInput = {
      registerId: params.registerId,
      ...(params.type ? { type: params.type } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.registerActivity.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: "desc" },
        include: { employee: { select: EMPLOYEE_BRIEF } },
      }),
      prisma.registerActivity.count({ where }),
    ]);
    return { items, total };
  },

  // ===========================================================================
  // CASH DROPS
  // ===========================================================================

  async createDrop(data: Prisma.CashDropUncheckedCreateInput, tx?: Prisma.TransactionClient) {
    return db(tx).cashDrop.create({
      data,
      include: {
        employee: { select: EMPLOYEE_BRIEF },
        witnessedBy: { select: EMPLOYEE_BRIEF },
      },
    });
  },

  async listDrops(params: {
    skip: number;
    take: number;
    where: Prisma.CashDropWhereInput;
  }) {
    const [items, total, sum] = await Promise.all([
      prisma.cashDrop.findMany({
        skip: params.skip,
        take: params.take,
        where: params.where,
        orderBy: { createdAt: "desc" },
        include: {
          employee: { select: EMPLOYEE_BRIEF },
          witnessedBy: { select: EMPLOYEE_BRIEF },
          register: { select: { id: true, registerNumber: true, sessionNumber: true } },
        },
      }),
      prisma.cashDrop.count({ where: params.where }),
      prisma.cashDrop.aggregate({ where: params.where, _sum: { amount: true } }),
    ]);
    return { items, total, totalAmount: sum._sum.amount };
  },

  async sumDrops(registerId: string, tx?: Prisma.TransactionClient) {
    const result = await db(tx).cashDrop.aggregate({
      where: { registerId },
      _sum: { amount: true },
      _count: { _all: true },
    });
    return { amount: result._sum.amount, count: result._count._all };
  },

  // ===========================================================================
  // CASH PAYOUTS
  // ===========================================================================

  async createPayout(data: Prisma.CashPayoutUncheckedCreateInput, tx?: Prisma.TransactionClient) {
    return db(tx).cashPayout.create({
      data,
      include: {
        employee: { select: EMPLOYEE_BRIEF },
        approvedBy: { select: EMPLOYEE_BRIEF },
        expense: { select: { id: true, expenseCode: true, categoryId: true } },
      },
    });
  },

  async updatePayout(
    id: string,
    data: Prisma.CashPayoutUncheckedUpdateInput,
    tx?: Prisma.TransactionClient
  ) {
    return db(tx).cashPayout.update({ where: { id }, data });
  },

  async listPayouts(params: {
    skip: number;
    take: number;
    where: Prisma.CashPayoutWhereInput;
  }) {
    const [items, total, sum, byCategory] = await Promise.all([
      prisma.cashPayout.findMany({
        skip: params.skip,
        take: params.take,
        where: params.where,
        orderBy: { createdAt: "desc" },
        include: {
          employee: { select: EMPLOYEE_BRIEF },
          approvedBy: { select: EMPLOYEE_BRIEF },
          register: { select: { id: true, registerNumber: true, sessionNumber: true } },
        },
      }),
      prisma.cashPayout.count({ where: params.where }),
      prisma.cashPayout.aggregate({ where: params.where, _sum: { amount: true } }),
      prisma.cashPayout.groupBy({
        by: ["category"],
        where: params.where,
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);
    return { items, total, totalAmount: sum._sum.amount, byCategory };
  },

  async sumPayouts(registerId: string, tx?: Prisma.TransactionClient) {
    const result = await db(tx).cashPayout.aggregate({
      where: { registerId, approvalStatus: { not: "REJECTED" } },
      _sum: { amount: true },
      _count: { _all: true },
    });
    return { amount: result._sum.amount, count: result._count._all };
  },

  // ===========================================================================
  // SHIFT SALES — read from the SALES tables, for the summary's non-cash columns
  //
  // Bounded by the session window (openedAt → closedAt-or-now) AND by employee.
  // Both bounds matter: two cashiers may be on different tills at the same time,
  // so a window-only query would credit each with the other's sales.
  // ===========================================================================

  /**
   * Payment totals by tender for one shift window.
   *
   * COVERS SALES **AND** EXCHANGE TOP-UPS. An exchange where the customer
   * trades up and pays the difference is money taken across the counter: it
   * lands in the drawer via the ledger, so a tender breakdown that counted only
   * sale payments would report less collected than the drawer actually holds,
   * with nothing on screen to explain the gap.
   *
   * The two sides are queried separately because the employee bound differs —
   * `sale.employeeId` versus `exchange.employeeId` — and Prisma cannot express
   * that as one relation filter.
   */
  async sumShiftPaymentsByMethod(params: {
    employeeId: string;
    from: Date;
    to: Date;
  }) {
    const [saleRows, exchangeRows] = await Promise.all([
      prisma.payment.groupBy({
        by: ["method"],
        where: {
          status: PaymentStatus.PAID,
          paidAt: { gte: params.from, lte: params.to },
          sale: {
            employeeId: params.employeeId,
            status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIAL] },
          },
        },
        _sum: { amount: true },
      }),
      prisma.payment.groupBy({
        by: ["method"],
        where: {
          status: PaymentStatus.PAID,
          paidAt: { gte: params.from, lte: params.to },
          exchange: {
            employeeId: params.employeeId,
            status: "COMPLETED",
          },
        },
        _sum: { amount: true },
      }),
    ]);

    // Merge on method so a tender paid on both a sale and an exchange yields
    // one row; `bucketPayments` would otherwise see two and the caller could
    // not tell whether that was intended.
    const byMethod = new Map<PaymentMethod, Prisma.Decimal>();
    for (const row of [...saleRows, ...exchangeRows]) {
      const current = byMethod.get(row.method) ?? new Prisma.Decimal(0);
      byMethod.set(row.method, current.plus(row._sum.amount ?? 0));
    }

    return [...byMethod].map(([method, amount]) => ({
      method,
      _sum: { amount },
    }));
  },

  /** Bill-level aggregates for one shift window. */
  async sumShiftSales(params: { employeeId: string; from: Date; to: Date }) {
    const where: Prisma.SaleWhereInput = {
      employeeId: params.employeeId,
      saleDate: { gte: params.from, lte: params.to },
      status: { in: [SaleStatus.COMPLETED, SaleStatus.PARTIAL] },
    };

    const [aggregate, count, splitCount] = await Promise.all([
      prisma.sale.aggregate({
        where,
        _sum: { grandTotal: true, discountAmount: true, manualDiscountAmount: true },
      }),
      prisma.sale.count({ where }),
      // A "split" bill is one settled with more than one payment row. Counting
      // via the relation filter keeps this a single indexed query instead of
      // pulling every payment into memory to group by saleId.
      prisma.sale.findMany({
        where: { ...where, payments: { some: {} } },
        select: { grandTotal: true, _count: { select: { payments: true } } },
      }),
    ]);

    let splitTotal = new Prisma.Decimal(0);
    for (const row of splitCount) {
      if (row._count.payments > 1) splitTotal = splitTotal.plus(row.grandTotal);
    }

    return {
      grandTotal: aggregate._sum.grandTotal,
      discountTotal: new Prisma.Decimal(aggregate._sum.discountAmount ?? 0).plus(
        aggregate._sum.manualDiscountAmount ?? 0
      ),
      transactionCount: count,
      splitTotal,
    };
  },

  /** Exchange value moved during one shift window. */
  async sumShiftExchanges(params: { employeeId: string; from: Date; to: Date }) {
    const [result, topUps] = await Promise.all([
      prisma.exchange.aggregate({
        where: {
          employeeId: params.employeeId,
          exchangeDate: { gte: params.from, lte: params.to },
          status: "COMPLETED",
        },
        _sum: { issuedValue: true, returnedValue: true, priceDifference: true },
        _count: { _all: true },
      }),
      // Money the customer handed over on an exchange, in any tender. Reported
      // separately so the tender breakdown can show why "total collected"
      // exceeds "gross sales" instead of leaving an unexplained gap.
      prisma.payment.aggregate({
        where: {
          status: PaymentStatus.PAID,
          paidAt: { gte: params.from, lte: params.to },
          exchange: { employeeId: params.employeeId, status: "COMPLETED" },
        },
        _sum: { amount: true },
      }),
    ]);

    return {
      issued: result._sum.issuedValue,
      returned: result._sum.returnedValue,
      priceDifference: result._sum.priceDifference,
      topUps: topUps._sum.amount,
      count: result._count._all,
    };
  },

  /**
   * Refunds owed to customers during a shift, SPLIT BY HOW THEY WERE SETTLED.
   *
   * A refund is a negative priceDifference on a completed exchange — this
   * system has no standalone refund entity, so reading it from exchanges is
   * the truthful source rather than an approximation.
   *
   * THE SPLIT IS THE POINT. `exchange.service` settles every negative price
   * difference by incrementing `customer.storeCredit`; no notes leave the till.
   * Reporting those as cash refunds — as this query previously did — subtracted
   * money from the drawer that was never taken out of it, producing a phantom
   * shortage exactly equal to the credit issued. The cash bucket is therefore
   * derived from the DRAWER LEDGER (the only record of notes actually handed
   * back), and the credit bucket from the exchanges themselves.
   */
  async sumShiftRefunds(params: {
    employeeId: string;
    from: Date;
    to: Date;
    registerId: string;
  }) {
    const [owed, cashOut] = await Promise.all([
      prisma.exchange.aggregate({
        where: {
          employeeId: params.employeeId,
          exchangeDate: { gte: params.from, lte: params.to },
          status: "COMPLETED",
          priceDifference: { lt: 0 },
        },
        _sum: { priceDifference: true },
        _count: { _all: true },
      }),
      // Cash actually paid back: CASH_OUT rows the exchange flow wrote. Drops
      // and payouts are also CASH_OUT, so the reference type is what separates
      // a refund from a safe drop.
      prisma.cashTransaction.aggregate({
        where: {
          registerId: params.registerId,
          type: CashTransactionType.CASH_OUT,
          referenceType: ReferenceType.EXCHANGE,
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    const totalOwed = new Prisma.Decimal(owed._sum.priceDifference ?? 0).abs();
    const cashAmount = new Prisma.Decimal(cashOut._sum.amount ?? 0);

    return {
      /** Refunds handed back as physical cash. Affects the drawer. */
      cashAmount,
      cashCount: cashOut._count._all,
      /** Refunds settled as store credit. Informational only. */
      storeCreditAmount: totalOwed.minus(cashAmount),
      /** Everything owed back, however settled. */
      totalAmount: totalOwed,
      count: owed._count._all,
    };
  },

  // ===========================================================================
  // DOCUMENT NUMBERING
  //
  // Sequences are per-prefix per-day. The `startsWith` scan is bounded by the
  // day's rows and served by the unique index on the number column, so it stays
  // cheap without a separate counter table to keep in sync.
  // ===========================================================================

  async nextSessionNumber(date: Date, tx?: Prisma.TransactionClient): Promise<string> {
    const prefix = buildDocumentNumber("SH", date, 0).slice(0, -5);
    const last = await db(tx).cashRegister.findFirst({
      where: { sessionNumber: { startsWith: prefix } },
      orderBy: { sessionNumber: "desc" },
      select: { sessionNumber: true },
    });
    return buildDocumentNumber("SH", date, parseDocumentSequence(last?.sessionNumber) + 1);
  },

  async nextDropNumber(date: Date, tx?: Prisma.TransactionClient): Promise<string> {
    const prefix = buildDocumentNumber("DROP", date, 0).slice(0, -5);
    const last = await db(tx).cashDrop.findFirst({
      where: { dropNumber: { startsWith: prefix } },
      orderBy: { dropNumber: "desc" },
      select: { dropNumber: true },
    });
    return buildDocumentNumber("DROP", date, parseDocumentSequence(last?.dropNumber) + 1);
  },

  async nextPayoutNumber(date: Date, tx?: Prisma.TransactionClient): Promise<string> {
    const prefix = buildDocumentNumber("PAY", date, 0).slice(0, -5);
    const last = await db(tx).cashPayout.findFirst({
      where: { payoutNumber: { startsWith: prefix } },
      orderBy: { payoutNumber: "desc" },
      select: { payoutNumber: true },
    });
    return buildDocumentNumber("PAY", date, parseDocumentSequence(last?.payoutNumber) + 1);
  },
};
