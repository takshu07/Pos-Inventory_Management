// =============================================================================
// CASH REGISTER SERVICE  —  shift lifecycle, drawer accountability
//
// This module owns one invariant above all others:
//
//     A CASHIER CANNOT SELL WITHOUT AN OPEN REGISTER SESSION.
//
// `requireOpenSessionForSale()` is the single gate that enforces it, and the
// sale service calls it before a checkout transaction begins. It lives here
// rather than in sale.service so that the rule has exactly one definition —
// the exchange flow and any future till-bound operation call the same function
// instead of re-implementing a check that could drift.
//
// AUTHORIZATION MODEL
// -------------------
//   CASHIER  operates their OWN drawer: open, drop, payout, close. They can see
//            their own live session and their own shift summaries — nothing else.
//   MANAGER  everything a cashier can do, plus oversight of every session and
//            reconciliation sign-off. Cannot delete financial history.
//   OWNER    full surface.
//
// Every read that returns another employee's drawer routes through
// `assertCanViewSession()`. Route-level guards narrow the surface; this function
// is the second, independent gate — nav hiding and route guards are never the
// only boundary.
//
// WHY SO MUCH IS WRITTEN, NOT DERIVED
// -----------------------------------
// Closing a shift freezes its rollups onto the session row. A summary that
// recomputed on read would silently change when a late refund posted against a
// sale from a shift an owner had already signed off on. A reconciliation must
// be a statement about a moment, not a live query.
// =============================================================================

import {
  Prisma,
  RegisterStatus,
  CashTransactionType,
  RegisterActivityType,
  ReferenceType,
  ActionModule,
  ActionType,
  ApprovalStatus,
  PaymentMethod,
} from "../../generated/prisma";

import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { AppError } from "../errors/AppError";
import { HTTP_STATUS } from "../constants/httpStatus";
import type { AuthenticatedUser } from "../types/employee.types";
import { auditRepository } from "../repositories/audit.repository";
import { cashRegisterRepository as repo } from "../repositories/cashRegister.repository";
import { financeRepository } from "../repositories/finance.repository";
import {
  ZERO,
  toDecimal,
  toNumber,
  money,
  foldLedger,
  calculateExpectedCash,
  calculateVariance,
  countDenominations,
  bucketPayments,
  buildDrawerBreakdown,
  calculateCollected,
  shiftDurationMinutes,
  formatDuration,
  type LedgerTotals,
} from "../engines/cashRegister.engine";
import type {
  OpenRegisterInput,
  CloseRegisterInput,
  ReconcileRegisterInput,
  CreateCashDropInput,
  CreateCashPayoutInput,
  CreateAdjustmentInput,
  AddRegisterNoteInput,
  RegisterHistoryQuery,
  RegisterActivityQuery,
  CashDropQuery,
  CashPayoutQuery,
} from "../validation/cashRegister.validation";

// =============================================================================
// AUTHORIZATION HELPERS
// =============================================================================

const isManagerOrAbove = (user: AuthenticatedUser) =>
  user.role === "OWNER" || user.role === "MANAGER";

/**
 * A cashier may only ever look at their own drawer.
 *
 * Enforced on the SESSION rather than on each sub-resource: drops, payouts and
 * activities are all reachable only through a session id, so gating the session
 * gates the whole subtree. Gating each leaf independently would be five chances
 * to forget one.
 */
function assertCanViewSession(
  session: { openedById: string },
  user: AuthenticatedUser
): void {
  if (isManagerOrAbove(user)) return;
  if (session.openedById === user.id) return;
  throw new AppError(
    HTTP_STATUS.FORBIDDEN,
    "You can only view your own register sessions."
  );
}

/** Mutating a drawer is stricter still: only its own cashier, or an owner. */
function assertCanOperateSession(
  session: { openedById: string; status: RegisterStatus },
  user: AuthenticatedUser
): void {
  if (session.status !== RegisterStatus.OPEN) {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      "This register session is closed. Reopen a new session to record drawer activity."
    );
  }
  if (user.role === "OWNER") return;
  if (session.openedById === user.id) return;
  throw new AppError(
    HTTP_STATUS.FORBIDDEN,
    "Only the cashier who opened this drawer (or an owner) can record activity on it."
  );
}

// =============================================================================
// AUDIT + TIMELINE HELPERS
// =============================================================================

/**
 * Writes a timeline entry. Called INSIDE the caller's transaction so an event
 * and its narrative land together — a drop that succeeded without an activity
 * row would be a hole in the shift's story.
 */
async function recordActivity(
  tx: Prisma.TransactionClient,
  input: {
    registerId: string;
    type: RegisterActivityType;
    description: string;
    amount?: Prisma.Decimal;
    balanceAfter?: Prisma.Decimal;
    referenceType?: ReferenceType;
    referenceId?: string;
    employeeId: string;
  }
): Promise<void> {
  await repo.createActivity(
    {
      registerId: input.registerId,
      type: input.type,
      description: input.description,
      amount: input.amount ?? ZERO,
      ...(input.balanceAfter !== undefined && { balanceAfter: input.balanceAfter }),
      ...(input.referenceType && { referenceType: input.referenceType }),
      ...(input.referenceId && { referenceId: input.referenceId }),
      employeeId: input.employeeId,
    },
    tx
  );
}

/** Fire-and-forget audit. Never blocks or rolls back a financial operation. */
function audit(input: {
  employeeId: string;
  action: ActionType;
  recordId: string;
  tableName: string;
  newData?: Record<string, unknown>;
  oldData?: Record<string, unknown>;
}): void {
  void auditRepository
    .create({
      performedBy: input.employeeId,
      action: input.action,
      module: ActionModule.CASH_REGISTER,
      tableName: input.tableName,
      recordId: input.recordId,
      ...(input.oldData && { oldData: input.oldData }),
      ...(input.newData && { newData: input.newData }),
    })
    .catch((err) => logger.error({ err }, "[CashRegister] audit write failed"));
}

// =============================================================================
// LIVE POSITION
//
// The one place expected cash is computed. Everything that needs the current
// drawer position — the live dashboard, the close preflight, the sale guard —
// calls this, so there is no second implementation to drift.
// =============================================================================

export interface LivePosition {
  openingCash: Prisma.Decimal;
  cashIn: Prisma.Decimal;
  cashOut: Prisma.Decimal;
  expectedCash: Prisma.Decimal;
  ledger: LedgerTotals;
}

async function computeLivePosition(
  session: { id: string; openingBalance: Prisma.Decimal },
  tx?: Prisma.TransactionClient
): Promise<LivePosition> {
  const rows = await repo.sumLedgerByDirection(session.id, tx);
  const ledger = foldLedger(rows);
  return {
    openingCash: toDecimal(session.openingBalance),
    cashIn: ledger.cashIn,
    cashOut: ledger.cashOut,
    expectedCash: calculateExpectedCash(session.openingBalance, ledger),
    ledger,
  };
}

// =============================================================================
// SHIFT SALES SNAPSHOT
//
// Reads the sales side of a shift. Bounded by BOTH the session window and the
// cashier, because two tills can be open at once and a window-only query would
// credit each cashier with the other's takings.
// =============================================================================

interface ShiftSales {
  cash: Prisma.Decimal;
  upi: Prisma.Decimal;
  card: Prisma.Decimal;
  other: Prisma.Decimal;
  gross: Prisma.Decimal;
  split: Prisma.Decimal;
  discounts: Prisma.Decimal;
  /**
   * Refunds paid back in CASH. This is the only refund figure that may be
   * subtracted from a cash total; see `storeCreditRefunds` for the rest.
   */
  refunds: Prisma.Decimal;
  refundCount: number;
  /** Refunds settled as store credit. Informational — moves no notes. */
  storeCreditRefunds: Prisma.Decimal;
  /** Cash + store-credit refunds. The customer-facing "money owed back". */
  totalRefunds: Prisma.Decimal;
  exchangeValue: Prisma.Decimal;
  /** Money taken across the counter on exchanges, in any tender. */
  exchangeTopUps: Prisma.Decimal;
  exchangeCount: number;
  transactionCount: number;
}

async function computeShiftSales(session: {
  id: string;
  openedById: string;
  openedAt: Date;
  closedAt: Date | null;
}): Promise<ShiftSales> {
  const from = session.openedAt;
  const to = session.closedAt ?? new Date();
  const window = { employeeId: session.openedById, from, to };

  // Four independent aggregates — one parallel batch rather than four serial
  // round-trips to a remote database.
  const [payments, sales, exchanges, refunds] = await Promise.all([
    repo.sumShiftPaymentsByMethod(window),
    repo.sumShiftSales(window),
    repo.sumShiftExchanges(window),
    repo.sumShiftRefunds({ ...window, registerId: session.id }),
  ]);

  const buckets = bucketPayments(
    payments.map((p) => ({ method: p.method, amount: p._sum.amount }))
  );

  return {
    cash: buckets.cash,
    upi: buckets.upi,
    card: buckets.card,
    other: buckets.other,
    gross: money(toDecimal(sales.grandTotal)),
    split: money(toDecimal(sales.splitTotal)),
    discounts: money(toDecimal(sales.discountTotal)),
    refunds: money(toDecimal(refunds.cashAmount)),
    refundCount: refunds.count,
    storeCreditRefunds: money(toDecimal(refunds.storeCreditAmount)),
    totalRefunds: money(toDecimal(refunds.totalAmount)),
    exchangeValue: money(toDecimal(exchanges.issued)),
    exchangeTopUps: money(toDecimal(exchanges.topUps)),
    exchangeCount: exchanges.count,
    transactionCount: sales.transactionCount,
  };
}

// =============================================================================
// DTO SHAPING
//
// Decimal → number happens HERE and nowhere else. A Decimal serialised straight
// to JSON becomes a string, which every consumer then has to remember to parse;
// one that is parsed in three places will eventually be parsed differently in
// one of them.
// =============================================================================

function employeeName(e: { firstName: string; lastName: string } | null | undefined): string {
  return e ? `${e.firstName} ${e.lastName}`.trim() : "—";
}

type SessionRow = Awaited<ReturnType<typeof repo.findById>>;

function toSessionDTO(session: NonNullable<SessionRow>) {
  return {
    id: session.id,
    sessionNumber: session.sessionNumber,
    registerNumber: session.registerNumber,
    status: session.status,

    openedAt: session.openedAt,
    closedAt: session.closedAt,
    durationMinutes: session.durationMinutes,
    durationLabel: formatDuration(
      session.durationMinutes ?? shiftDurationMinutes(session.openedAt, session.closedAt ?? new Date())
    ),

    // `employeeId` is the spec's name for the shift's owner. It is the SAME
    // column as openedById — a session has exactly one accountable cashier, so
    // a second column would be a second source of truth for one fact.
    employeeId: session.openedById,
    employee: session.openedBy
      ? {
          id: session.openedBy.id,
          name: employeeName(session.openedBy),
          employeeCode: session.openedBy.employeeCode,
          role: session.openedBy.role,
        }
      : null,
    closedBy: session.closedBy ? { id: session.closedBy.id, name: employeeName(session.closedBy) } : null,
    reconciledBy: session.reconciledBy
      ? { id: session.reconciledBy.id, name: employeeName(session.reconciledBy) }
      : null,
    reconciledAt: session.reconciledAt,
    reconcileNotes: session.reconcileNotes,

    openingCash: toNumber(session.openingBalance),
    closingCash: toNumber(session.closingBalance),
    expectedCash: toNumber(session.expectedBalance),
    countedCash: toNumber(session.countedCash),
    difference: toNumber(session.difference),
    discrepancyReason: session.discrepancyReason,
    denominations: session.denominations,

    cashSales: toNumber(session.cashSales),
    upiSales: toNumber(session.upiSales),
    cardSales: toNumber(session.cardSales),
    otherSales: toNumber(session.otherSales),
    splitSales: toNumber(session.splitSales),
    refundTotal: toNumber(session.refundTotal),
    exchangeTotal: toNumber(session.exchangeTotal),
    discountTotal: toNumber(session.discountTotal),
    cashDropTotal: toNumber(session.cashDropTotal),
    cashPayoutTotal: toNumber(session.cashPayoutTotal),
    transactionCount: session.transactionCount,

    notes: session.notes,
    storeCode: session.storeCode,
  };
}

// =============================================================================
// THE SALE GATE
// =============================================================================

/**
 * Resolves the open session a sale must be recorded against, or refuses.
 *
 * MANAGERS AND OWNERS ARE NOT EXEMPT when they are the one selling — if a
 * manager rings up a bill, that cash lands in a physical drawer and must be
 * accounted for like anyone else's. What differs by role is who may OPEN a
 * drawer, not who must have one.
 *
 * Returns `null` only when register enforcement is disabled in settings, which
 * is the documented escape hatch for stores that do not run tills.
 */
export async function requireOpenSessionForSale(
  employeeId: string,
  tx?: Prisma.TransactionClient
): Promise<{ id: string; registerNumber: string } | null> {
  const enforced = await isRegisterEnforced();
  const session = await repo.findOpenSessionForEmployee(employeeId, tx);

  if (session) return { id: session.id, registerNumber: session.registerNumber };
  if (!enforced) return null;

  throw new AppError(
    HTTP_STATUS.CONFLICT,
    "No cash register session is open. Open your register before recording a sale.",
    { reason: "REGISTER_NOT_OPEN" }
  );
}

/**
 * Whether the store requires an open register to sell.
 *
 * Read from Settings.storeConfig so an owner can turn it off for a business
 * that does not run tills, without a code change. Defaults to ENFORCED: a
 * missing setting must fail closed, because the alternative is a store that
 * silently loses drawer accountability after a config wipe.
 */
async function isRegisterEnforced(): Promise<boolean> {
  try {
    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
      select: { storeConfig: true },
    });
    const config = (settings?.storeConfig ?? {}) as Record<string, unknown>;
    return config["enforceRegisterSession"] !== false;
  } catch (err) {
    logger.warn({ err }, "[CashRegister] settings read failed; enforcing register by default");
    return true;
  }
}

/**
 * Records a sale's cash leg on the drawer ledger and its timeline.
 *
 * Called from INSIDE the checkout transaction, so a sale and its drawer impact
 * commit together. A sale that committed without its cash movement would make
 * the drawer short by exactly the amount of that sale — the most damaging
 * possible failure mode for this module.
 *
 * Non-cash tenders still write an activity (the shift's story includes them)
 * but with amount 0, because they never enter the physical drawer.
 */
export async function recordSaleOnDrawer(
  tx: Prisma.TransactionClient,
  input: {
    registerId: string;
    saleId: string;
    saleNumber: string;
    employeeId: string;
    payments: Array<{ method: PaymentMethod; amount: Prisma.Decimal | number }>;
  }
): Promise<void> {
  const cashLeg = input.payments
    .filter((p) => p.method === PaymentMethod.CASH)
    .reduce((sum, p) => sum.plus(toDecimal(p.amount)), ZERO);

  if (cashLeg.greaterThan(0)) {
    await repo.createCashTransaction(
      {
        registerId: input.registerId,
        type: CashTransactionType.CASH_IN,
        amount: money(cashLeg),
        reason: `Cash sale ${input.saleNumber}`,
        referenceId: input.saleId,
        referenceType: ReferenceType.SALE,
        employeeId: input.employeeId,
      },
      tx
    );
  }

  const methods = [...new Set(input.payments.map((p) => p.method))].join(" + ");
  await recordActivity(tx, {
    registerId: input.registerId,
    type: RegisterActivityType.SALE,
    description: `Sale ${input.saleNumber} (${methods || "no payment"})`,
    amount: money(cashLeg),
    referenceType: ReferenceType.SALE,
    referenceId: input.saleId,
    employeeId: input.employeeId,
  });
}

/**
 * Records an exchange's cash impact. A positive priceDifference means the
 * customer paid extra (cash in); a negative one is a refund paid out.
 */
export async function recordExchangeOnDrawer(
  tx: Prisma.TransactionClient,
  input: {
    registerId: string;
    exchangeId: string;
    exchangeNumber: string;
    employeeId: string;
    /** Signed. Positive = customer pays, negative = shop refunds. */
    cashDifference: Prisma.Decimal | number;
  }
): Promise<void> {
  const delta = toDecimal(input.cashDifference);

  if (!delta.isZero()) {
    await repo.createCashTransaction(
      {
        registerId: input.registerId,
        type: delta.isPositive() ? CashTransactionType.CASH_IN : CashTransactionType.CASH_OUT,
        amount: money(delta.abs()),
        reason: `Exchange ${input.exchangeNumber}`,
        referenceId: input.exchangeId,
        referenceType: ReferenceType.EXCHANGE,
        employeeId: input.employeeId,
      },
      tx
    );
  }

  await recordActivity(tx, {
    registerId: input.registerId,
    type: delta.isNegative() ? RegisterActivityType.REFUND : RegisterActivityType.EXCHANGE,
    description: `Exchange ${input.exchangeNumber}`,
    amount: money(delta),
    referenceType: ReferenceType.EXCHANGE,
    referenceId: input.exchangeId,
    employeeId: input.employeeId,
  });
}

// =============================================================================
// OPEN
// =============================================================================

export async function openRegister(input: OpenRegisterInput, user: AuthenticatedUser) {
  // Two distinct conflicts, two distinct messages. "A register is already open"
  // is useless to a cashier who needs to know whether it is THEIR drawer or
  // someone else's till they are trying to claim.
  const [ownSession, tillSession] = await Promise.all([
    repo.findOpenSessionForEmployee(user.id),
    repo.findOpenSession(input.registerNumber),
  ]);

  if (ownSession) {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      `You already have an open session on ${ownSession.registerNumber}. Close it before opening another.`,
      { reason: "SESSION_ALREADY_OPEN", registerId: ownSession.id }
    );
  }

  if (tillSession) {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      `${input.registerNumber} is already open under ${employeeName(tillSession.openedBy)}.`,
      { reason: "REGISTER_OCCUPIED", registerNumber: input.registerNumber }
    );
  }

  // If a denomination count was supplied it must agree with the declared float.
  // Accepting a mismatch would mean the shift starts from a number nobody
  // actually counted — and every later variance inherits that error.
  const counted = countDenominations(input.denominations ?? null);
  if (input.denominations && !counted.total.equals(toDecimal(input.openingCash))) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      `Denomination count (₹${counted.total}) does not match the opening cash entered (₹${input.openingCash}).`,
      { reason: "DENOMINATION_MISMATCH", countedTotal: toNumber(counted.total) }
    );
  }

  const now = new Date();

  const session = await prisma.$transaction(async (tx) => {
    const sessionNumber = await repo.nextSessionNumber(now, tx);

    const created = await repo.createSession(
      {
        sessionNumber,
        registerNumber: input.registerNumber,
        status: RegisterStatus.OPEN,
        openingBalance: money(toDecimal(input.openingCash)),
        openedById: user.id,
        openedAt: now,
        notes: input.notes ?? null,
        ...(input.denominations && { denominations: input.denominations as Prisma.InputJsonValue }),
      },
      tx
    );

    await recordActivity(tx, {
      registerId: created.id,
      type: RegisterActivityType.OPENED,
      description: `Register ${created.registerNumber} opened with an opening float of ₹${input.openingCash.toFixed(2)}`,
      amount: ZERO,
      balanceAfter: money(toDecimal(input.openingCash)),
      referenceType: ReferenceType.CASH_REGISTER,
      referenceId: created.id,
      employeeId: user.id,
    });

    return created;
  });

  audit({
    employeeId: user.id,
    action: ActionType.REGISTER_OPENED,
    tableName: "cash_registers",
    recordId: session.id,
    newData: {
      sessionNumber: session.sessionNumber,
      registerNumber: session.registerNumber,
      openingCash: toNumber(session.openingBalance),
    },
  });

  return toSessionDTO(session);
}

// =============================================================================
// LIVE DASHBOARD
// =============================================================================

/**
 * The screen a cashier watches all shift.
 *
 * Every figure is computed live rather than read from the frozen rollups —
 * during an OPEN shift there is nothing frozen yet, and a cashier needs to see
 * the drawer as it is right now, not as it was at the last write.
 */
export async function getLiveDashboard(user: AuthenticatedUser, registerId?: string) {
  const session = registerId
    ? await repo.findById(registerId)
    : await repo.findOpenSessionForEmployee(user.id);

  if (!session) {
    return {
      hasOpenSession: false,
      session: null,
      position: null,
      sales: null,
      drops: null,
      payouts: null,
      recentActivity: [],
    };
  }

  assertCanViewSession(session, user);

  const [position, sales, dropSums, payoutSums, activity] = await Promise.all([
    computeLivePosition(session),
    computeShiftSales(session),
    repo.sumDrops(session.id),
    repo.sumPayouts(session.id),
    repo.listActivities({ registerId: session.id, skip: 0, take: 20 }),
  ]);

  const elapsed = shiftDurationMinutes(session.openedAt, session.closedAt ?? new Date());

  // The reconciliation the cashier verifies line by line.
  //
  // `cashCollected` is the LEDGER's cash-in, not the sales table's cash column.
  // They differ legitimately — a cash exchange top-up is cash in that is not a
  // sale — and the ledger is what the physical drawer followed.
  //
  // Refunds, drops and payouts are all CASH_OUT rows, so they are named here
  // from their own tables and the remainder is surfaced as `otherAdjustments`
  // rather than being silently dropped. That keeps the identity exact: the
  // displayed lines always sum to the displayed total.
  const drops = toDecimal(dropSums.amount);
  const payouts = toDecimal(payoutSums.amount);
  const namedCashOut = sales.refunds.plus(drops).plus(payouts);
  const drawer = buildDrawerBreakdown({
    openingFloat: position.openingCash,
    cashCollected: position.cashIn,
    cashRefunds: sales.refunds,
    cashPayouts: payouts,
    cashDrops: drops,
    otherAdjustments: namedCashOut.minus(position.cashOut),
  });

  const collected = calculateCollected({
    breakdown: { cash: sales.cash, upi: sales.upi, card: sales.card, other: sales.other, total: sales.gross },
    cashRefunds: sales.refunds,
    storeCreditRefunds: sales.storeCreditRefunds,
  });

  return {
    hasOpenSession: session.status === RegisterStatus.OPEN,
    session: toSessionDTO(session),

    position: {
      openingCash: toNumber(position.openingCash),
      cashIn: toNumber(position.cashIn),
      cashOut: toNumber(position.cashOut),
      expectedCash: toNumber(position.expectedCash),
    },

    // Traceable build-up of expected cash. Every line is a cash movement, and
    // they reconcile to `expectedInDrawer` exactly.
    drawer: {
      openingFloat: toNumber(drawer.openingFloat),
      cashCollected: toNumber(drawer.cashCollected),
      cashRefunds: toNumber(drawer.cashRefunds),
      cashPayouts: toNumber(drawer.cashPayouts),
      cashDrops: toNumber(drawer.cashDrops),
      otherAdjustments: toNumber(drawer.otherAdjustments),
      expectedInDrawer: toNumber(drawer.expectedInDrawer),
    },

    collected: {
      cash: toNumber(collected.cash),
      upi: toNumber(collected.upi),
      card: toNumber(collected.card),
      other: toNumber(collected.other),
      digital: toNumber(collected.digital),
      totalCollected: toNumber(collected.totalCollected),
      cashRefunds: toNumber(collected.cashRefunds),
      storeCreditRefunds: toNumber(collected.storeCreditRefunds),
      netCollected: toNumber(collected.netCollected),
      // Explains the difference between total collected and gross sales.
      exchangeTopUps: toNumber(sales.exchangeTopUps),
      grossSales: toNumber(sales.gross),
    },

    sales: {
      cash: toNumber(sales.cash),
      upi: toNumber(sales.upi),
      card: toNumber(sales.card),
      other: toNumber(sales.other),
      split: toNumber(sales.split),
      gross: toNumber(sales.gross),
      discounts: toNumber(sales.discounts),
      refunds: toNumber(sales.refunds),
      refundCount: sales.refundCount,
      storeCreditRefunds: toNumber(sales.storeCreditRefunds),
      totalRefunds: toNumber(sales.totalRefunds),
      exchangeValue: toNumber(sales.exchangeValue),
      exchangeCount: sales.exchangeCount,
      transactionCount: sales.transactionCount,
    },

    drops: { total: toNumber(dropSums.amount), count: dropSums.count },
    payouts: { total: toNumber(payoutSums.amount), count: payoutSums.count },

    shift: {
      openedAt: session.openedAt,
      elapsedMinutes: elapsed,
      elapsedLabel: formatDuration(elapsed),
    },

    recentActivity: activity.items.map(toActivityDTO),
  };
}

function toActivityDTO(a: {
  id: string;
  type: RegisterActivityType;
  description: string;
  amount: Prisma.Decimal;
  balanceAfter: Prisma.Decimal | null;
  referenceType: ReferenceType | null;
  referenceId: string | null;
  createdAt: Date;
  employee?: { id: string; firstName: string; lastName: string } | null;
}) {
  return {
    id: a.id,
    type: a.type,
    description: a.description,
    amount: toNumber(a.amount),
    balanceAfter: a.balanceAfter === null ? null : toNumber(a.balanceAfter),
    referenceType: a.referenceType,
    referenceId: a.referenceId,
    createdAt: a.createdAt,
    employee: a.employee ? { id: a.employee.id, name: employeeName(a.employee) } : null,
  };
}

// =============================================================================
// CASH DROP
// =============================================================================

export async function createCashDrop(
  registerId: string,
  input: CreateCashDropInput,
  user: AuthenticatedUser
) {
  const session = await repo.findById(registerId);
  if (!session) throw new AppError(HTTP_STATUS.NOT_FOUND, "Register session not found.");
  assertCanOperateSession(session, user);

  // A drop larger than the drawer holds is either a typo or theft in progress.
  // Either way it must not be recorded as if it were routine.
  const position = await computeLivePosition(session);
  const amount = money(toDecimal(input.amount));

  if (amount.greaterThan(position.expectedCash)) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      `Cannot drop ₹${amount} — the drawer is only expected to hold ₹${position.expectedCash}.`,
      { reason: "INSUFFICIENT_DRAWER_CASH", expectedCash: toNumber(position.expectedCash) }
    );
  }

  const now = new Date();

  const drop = await prisma.$transaction(async (tx) => {
    const dropNumber = await repo.nextDropNumber(now, tx);

    const created = await repo.createDrop(
      {
        registerId,
        dropNumber,
        amount,
        reason: input.reason,
        destination: input.destination ?? null,
        referenceNumber: input.referenceNumber ?? null,
        employeeId: user.id,
        witnessedById: input.witnessedById ?? null,
        storeCode: session.storeCode,
      },
      tx
    );

    // The drawer ledger entry is what actually moves expected cash. The
    // CashDrop row carries the narrative; without this the drop would be
    // documented but invisible to the reconciliation.
    await repo.createCashTransaction(
      {
        registerId,
        type: CashTransactionType.CASH_OUT,
        amount,
        reason: `Cash drop ${dropNumber}: ${input.reason}`,
        referenceId: created.id,
        referenceType: ReferenceType.CASH_DROP,
        employeeId: user.id,
      },
      tx
    );

    await repo.updateSession(
      registerId,
      { cashDropTotal: { increment: amount } },
      tx
    );

    await recordActivity(tx, {
      registerId,
      type: RegisterActivityType.CASH_DROP,
      description: `Cash drop ${dropNumber} — ${input.reason}`,
      amount: amount.negated(),
      balanceAfter: position.expectedCash.minus(amount),
      referenceType: ReferenceType.CASH_DROP,
      referenceId: created.id,
      employeeId: user.id,
    });

    return created;
  });

  audit({
    employeeId: user.id,
    action: ActionType.CASH_DROP_RECORDED,
    tableName: "cash_drops",
    recordId: drop.id,
    newData: {
      dropNumber: drop.dropNumber,
      amount: toNumber(drop.amount),
      reason: drop.reason,
      registerId,
    },
  });

  return toDropDTO(drop);
}

function toDropDTO(d: {
  id: string;
  dropNumber: string;
  amount: Prisma.Decimal;
  reason: string;
  destination: string | null;
  referenceNumber: string | null;
  createdAt: Date;
  employee?: { id: string; firstName: string; lastName: string } | null;
  witnessedBy?: { id: string; firstName: string; lastName: string } | null;
  register?: { id: string; registerNumber: string; sessionNumber: string | null } | null;
}) {
  return {
    id: d.id,
    dropNumber: d.dropNumber,
    amount: toNumber(d.amount),
    reason: d.reason,
    destination: d.destination,
    referenceNumber: d.referenceNumber,
    createdAt: d.createdAt,
    employee: d.employee ? { id: d.employee.id, name: employeeName(d.employee) } : null,
    witnessedBy: d.witnessedBy ? { id: d.witnessedBy.id, name: employeeName(d.witnessedBy) } : null,
    register: d.register ?? null,
  };
}

export async function listCashDrops(query: CashDropQuery, user: AuthenticatedUser) {
  const where: Prisma.CashDropWhereInput = {};

  // A cashier sees only their own drops. Applied to the WHERE clause rather
  // than filtered after the fact, so the pagination total is also correct for
  // them — a count that includes rows they cannot see is a leak of its own.
  if (!isManagerOrAbove(user)) where.employeeId = user.id;
  else if (query.employeeId) where.employeeId = query.employeeId;

  if (query.registerId) where.registerId = query.registerId;
  if (query.startDate || query.endDate) {
    where.createdAt = {
      ...(query.startDate && { gte: query.startDate }),
      ...(query.endDate && { lte: query.endDate }),
    };
  }
  if (query.search) {
    where.OR = [
      { dropNumber: { contains: query.search, mode: "insensitive" } },
      { reason: { contains: query.search, mode: "insensitive" } },
      { destination: { contains: query.search, mode: "insensitive" } },
      { referenceNumber: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const { items, total, totalAmount } = await repo.listDrops({
    skip: (query.page - 1) * query.limit,
    take: query.limit,
    where,
  });

  return {
    data: items.map(toDropDTO),
    summary: { totalAmount: toNumber(totalAmount), count: total },
    meta: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}

// =============================================================================
// CASH PAYOUT
//
// A payout is TWO records in one transaction: the drawer-side CashPayout and
// the accounting-side Expense. They are separate rows because they answer
// different questions — "why is the till short ₹200" and "what did we spend on
// packaging this month" — and a single row cannot be indexed well for both.
// =============================================================================

/**
 * Resolves (creating if absent) the ExpenseCategory a payout category maps to.
 *
 * Keyed on `code` rather than display name so an owner renaming "Tea" to
 * "Refreshments" does not orphan every future payout into a duplicate category.
 */
async function resolvePayoutExpenseCategory(
  tx: Prisma.TransactionClient,
  category: string
): Promise<string> {
  const code = `PAYOUT_${category}`;
  const label = category
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");

  const existing = await tx.expenseCategory.findUnique({ where: { code } });
  if (existing) return existing.id;

  // A name collision with a manually created category is possible; fall back to
  // adopting it rather than failing the payout, and stamp the code so the next
  // lookup is a direct hit.
  const byName = await tx.expenseCategory.findUnique({ where: { name: label } });
  if (byName) {
    const adopted = await tx.expenseCategory.update({ where: { id: byName.id }, data: { code } });
    return adopted.id;
  }

  const created = await tx.expenseCategory.create({
    data: { name: label, code, isActive: true },
  });
  return created.id;
}

export async function createCashPayout(
  registerId: string,
  input: CreateCashPayoutInput,
  user: AuthenticatedUser
) {
  const session = await repo.findById(registerId);
  if (!session) throw new AppError(HTTP_STATUS.NOT_FOUND, "Register session not found.");
  assertCanOperateSession(session, user);

  const position = await computeLivePosition(session);
  const amount = money(toDecimal(input.amount));

  if (amount.greaterThan(position.expectedCash)) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      `Cannot pay out ₹${amount} — the drawer is only expected to hold ₹${position.expectedCash}.`,
      { reason: "INSUFFICIENT_DRAWER_CASH", expectedCash: toNumber(position.expectedCash) }
    );
  }

  const now = new Date();

  const payout = await prisma.$transaction(async (tx) => {
    const [payoutNumber, expenseCode, categoryId] = await Promise.all([
      repo.nextPayoutNumber(now, tx),
      financeRepository.nextExpenseCode(now, tx),
      resolvePayoutExpenseCategory(tx, input.category),
    ]);

    // Accounting side first — the payout carries the FK to it.
    const expense = await tx.expense.create({
      data: {
        expenseCode,
        categoryId,
        title: input.reason.slice(0, 100),
        amount,
        vendorName: input.payeeName ?? null,
        paymentMethod: PaymentMethod.CASH,
        description: `Cash payout ${payoutNumber} from register ${session.registerNumber}`,
        employeeId: user.id,
        expenseDate: now,
        // Drawer payouts are authorised at the moment cash leaves the till —
        // there is no world in which the money comes back if an approver later
        // says no, so recording it as PENDING would misstate the P&L.
        approvalStatus: ApprovalStatus.APPROVED,
        approvedById: user.id,
        approvedAt: now,
        registerId,
        ...(input.receiptAssetId && { receiptAssetId: input.receiptAssetId }),
        storeCode: session.storeCode,
      },
    });

    const created = await repo.createPayout(
      {
        registerId,
        payoutNumber,
        category: input.category as never,
        amount,
        reason: input.reason,
        payeeName: input.payeeName ?? null,
        receiptAssetId: input.receiptAssetId ?? null,
        approvalStatus: ApprovalStatus.APPROVED,
        approvedById: user.id,
        approvedAt: now,
        employeeId: user.id,
        expenseId: expense.id,
        storeCode: session.storeCode,
      },
      tx
    );

    await repo.createCashTransaction(
      {
        registerId,
        type: CashTransactionType.CASH_OUT,
        amount,
        reason: `Payout ${payoutNumber} (${input.category}): ${input.reason}`,
        referenceId: created.id,
        referenceType: ReferenceType.CASH_PAYOUT,
        employeeId: user.id,
      },
      tx
    );

    await repo.updateSession(registerId, { cashPayoutTotal: { increment: amount } }, tx);

    await recordActivity(tx, {
      registerId,
      type: RegisterActivityType.CASH_PAYOUT,
      description: `Payout ${payoutNumber} — ${input.category}: ${input.reason}`,
      amount: amount.negated(),
      balanceAfter: position.expectedCash.minus(amount),
      referenceType: ReferenceType.CASH_PAYOUT,
      referenceId: created.id,
      employeeId: user.id,
    });

    return created;
  });

  audit({
    employeeId: user.id,
    action: ActionType.CASH_PAYOUT_RECORDED,
    tableName: "cash_payouts",
    recordId: payout.id,
    newData: {
      payoutNumber: payout.payoutNumber,
      category: payout.category,
      amount: toNumber(payout.amount),
      reason: payout.reason,
      expenseId: payout.expenseId,
      registerId,
    },
  });

  return toPayoutDTO(payout);
}

function toPayoutDTO(p: {
  id: string;
  payoutNumber: string;
  category: string;
  amount: Prisma.Decimal;
  reason: string;
  payeeName: string | null;
  receiptAssetId: string | null;
  approvalStatus: ApprovalStatus;
  approvedAt: Date | null;
  expenseId: string | null;
  createdAt: Date;
  employee?: { id: string; firstName: string; lastName: string } | null;
  approvedBy?: { id: string; firstName: string; lastName: string } | null;
  register?: { id: string; registerNumber: string; sessionNumber: string | null } | null;
}) {
  return {
    id: p.id,
    payoutNumber: p.payoutNumber,
    category: p.category,
    amount: toNumber(p.amount),
    reason: p.reason,
    payeeName: p.payeeName,
    receiptAssetId: p.receiptAssetId,
    approvalStatus: p.approvalStatus,
    approvedAt: p.approvedAt,
    expenseId: p.expenseId,
    createdAt: p.createdAt,
    employee: p.employee ? { id: p.employee.id, name: employeeName(p.employee) } : null,
    approvedBy: p.approvedBy ? { id: p.approvedBy.id, name: employeeName(p.approvedBy) } : null,
    register: p.register ?? null,
  };
}

export async function listCashPayouts(query: CashPayoutQuery, user: AuthenticatedUser) {
  const where: Prisma.CashPayoutWhereInput = {};

  if (!isManagerOrAbove(user)) where.employeeId = user.id;
  else if (query.employeeId) where.employeeId = query.employeeId;

  if (query.registerId) where.registerId = query.registerId;
  if (query.category) where.category = query.category as never;
  if (query.startDate || query.endDate) {
    where.createdAt = {
      ...(query.startDate && { gte: query.startDate }),
      ...(query.endDate && { lte: query.endDate }),
    };
  }
  if (query.search) {
    where.OR = [
      { payoutNumber: { contains: query.search, mode: "insensitive" } },
      { reason: { contains: query.search, mode: "insensitive" } },
      { payeeName: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const { items, total, totalAmount, byCategory } = await repo.listPayouts({
    skip: (query.page - 1) * query.limit,
    take: query.limit,
    where,
  });

  return {
    data: items.map(toPayoutDTO),
    summary: {
      totalAmount: toNumber(totalAmount),
      count: total,
      byCategory: byCategory.map((c) => ({
        category: c.category,
        amount: toNumber(c._sum.amount),
        count: c._count._all,
      })),
    },
    meta: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}

// =============================================================================
// MANUAL ADJUSTMENT & NOTES
// =============================================================================

export async function createAdjustment(
  registerId: string,
  input: CreateAdjustmentInput,
  user: AuthenticatedUser
) {
  const session = await repo.findById(registerId);
  if (!session) throw new AppError(HTTP_STATUS.NOT_FOUND, "Register session not found.");

  // Adjustments are a supervisor tool. A cashier who can silently add cash to
  // their own expected balance can cover any shortage they like, which would
  // make the entire reconciliation meaningless.
  if (!isManagerOrAbove(user)) {
    throw new AppError(
      HTTP_STATUS.FORBIDDEN,
      "Only a manager or owner can post a drawer adjustment."
    );
  }
  if (session.status !== RegisterStatus.OPEN) {
    throw new AppError(HTTP_STATUS.CONFLICT, "This register session is closed.");
  }

  const position = await computeLivePosition(session);
  const amount = money(toDecimal(input.amount));
  const isOut = input.direction === "OUT";

  if (isOut && amount.greaterThan(position.expectedCash)) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      `Cannot remove ₹${amount} — the drawer is only expected to hold ₹${position.expectedCash}.`
    );
  }

  await prisma.$transaction(async (tx) => {
    await repo.createCashTransaction(
      {
        registerId,
        type: isOut ? CashTransactionType.CASH_OUT : CashTransactionType.CASH_IN,
        amount,
        reason: `Manual adjustment: ${input.reason}`,
        referenceId: registerId,
        referenceType: ReferenceType.CASH_REGISTER,
        employeeId: user.id,
      },
      tx
    );

    await recordActivity(tx, {
      registerId,
      type: RegisterActivityType.ADJUSTMENT,
      description: `Drawer adjustment (${input.direction}) — ${input.reason}`,
      amount: isOut ? amount.negated() : amount,
      balanceAfter: isOut ? position.expectedCash.minus(amount) : position.expectedCash.plus(amount),
      referenceType: ReferenceType.CASH_REGISTER,
      referenceId: registerId,
      employeeId: user.id,
    });
  });

  audit({
    employeeId: user.id,
    action: ActionType.INVENTORY_ADJUST,
    tableName: "cash_transactions",
    recordId: registerId,
    newData: { direction: input.direction, amount: toNumber(amount), reason: input.reason },
  });

  return getLiveDashboard(user, registerId);
}

export async function addRegisterNote(
  registerId: string,
  input: AddRegisterNoteInput,
  user: AuthenticatedUser
) {
  const session = await repo.findById(registerId);
  if (!session) throw new AppError(HTTP_STATUS.NOT_FOUND, "Register session not found.");
  assertCanViewSession(session, user);

  await prisma.$transaction((tx) =>
    recordActivity(tx, {
      registerId,
      type: RegisterActivityType.NOTE,
      description: input.note,
      amount: ZERO,
      referenceType: ReferenceType.CASH_REGISTER,
      referenceId: registerId,
      employeeId: user.id,
    })
  );

  return { registerId, note: input.note };
}

// =============================================================================
// CLOSE
// =============================================================================

/**
 * Preflight for the close dialog: what the system expects, so the cashier
 * counts against a live figure rather than a stale one.
 */
export async function getClosePreview(registerId: string, user: AuthenticatedUser) {
  const session = await repo.findById(registerId);
  if (!session) throw new AppError(HTTP_STATUS.NOT_FOUND, "Register session not found.");
  assertCanViewSession(session, user);

  if (session.status !== RegisterStatus.OPEN) {
    throw new AppError(HTTP_STATUS.CONFLICT, "This register session is already closed.");
  }

  const [position, sales, drops, payouts] = await Promise.all([
    computeLivePosition(session),
    computeShiftSales(session),
    repo.sumDrops(session.id),
    repo.sumPayouts(session.id),
  ]);

  return {
    registerId: session.id,
    sessionNumber: session.sessionNumber,
    registerNumber: session.registerNumber,
    openedAt: session.openedAt,
    openingCash: toNumber(position.openingCash),
    cashIn: toNumber(position.cashIn),
    cashOut: toNumber(position.cashOut),
    expectedCash: toNumber(position.expectedCash),
    cashSales: toNumber(sales.cash),
    upiSales: toNumber(sales.upi),
    cardSales: toNumber(sales.card),
    otherSales: toNumber(sales.other),
    refunds: toNumber(sales.refunds),
    cashDropTotal: toNumber(drops.amount),
    cashPayoutTotal: toNumber(payouts.amount),
    transactionCount: sales.transactionCount,
  };
}

export async function closeRegister(
  registerId: string,
  input: CloseRegisterInput,
  user: AuthenticatedUser
) {
  const session = await repo.findById(registerId);
  if (!session) throw new AppError(HTTP_STATUS.NOT_FOUND, "Register session not found.");
  assertCanOperateSession(session, user);

  const counted = money(toDecimal(input.countedCash));

  // A supplied denomination count must total the declared figure. Two numbers
  // that disagree mean one of them is wrong, and closing on the wrong one bakes
  // the error into a permanent record.
  if (input.denominations) {
    const denomTotal = countDenominations(input.denominations).total;
    if (!denomTotal.equals(counted)) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        `Denomination count (₹${denomTotal}) does not match the counted cash entered (₹${counted}).`,
        { reason: "DENOMINATION_MISMATCH", countedTotal: toNumber(denomTotal) }
      );
    }
  }

  const [position, sales, drops, payouts] = await Promise.all([
    computeLivePosition(session),
    computeShiftSales(session),
    repo.sumDrops(session.id),
    repo.sumPayouts(session.id),
  ]);

  const variance = calculateVariance(position.expectedCash, counted);

  // The server's own variance is authoritative. The validation layer already
  // checked the reason against what the CLIENT expected; this re-check catches
  // the case the client could not have known about — a sale that landed between
  // the dialog opening and the request arriving.
  if (variance.requiresReason && !input.discrepancyReason?.trim()) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      `The drawer is ${variance.kind === "OVER" ? "over" : "short"} by ₹${variance.difference.abs()}. A reason is required to close this shift.`,
      {
        reason: "DISCREPANCY_REASON_REQUIRED",
        expectedCash: toNumber(position.expectedCash),
        countedCash: toNumber(counted),
        difference: toNumber(variance.difference),
      }
    );
  }

  const closedAt = new Date();
  const durationMinutes = shiftDurationMinutes(session.openedAt, closedAt);

  const closed = await prisma.$transaction(async (tx) => {
    const updated = await repo.updateSession(
      registerId,
      {
        status: RegisterStatus.CLOSED,
        closedAt,
        closedById: user.id,
        durationMinutes,

        expectedBalance: position.expectedCash,
        countedCash: counted,
        // closingBalance is the pre-existing column every other reader in the
        // codebase already uses; it is kept in lockstep with countedCash rather
        // than deprecated, so nothing that reads it silently starts seeing null.
        closingBalance: counted,
        difference: variance.difference,
        discrepancyReason: input.discrepancyReason?.trim() ?? null,
        ...(input.denominations && { denominations: input.denominations as Prisma.InputJsonValue }),

        cashSales: sales.cash,
        upiSales: sales.upi,
        cardSales: sales.card,
        otherSales: sales.other,
        splitSales: sales.split,
        refundTotal: sales.refunds,
        exchangeTotal: sales.exchangeValue,
        discountTotal: sales.discounts,
        cashDropTotal: money(toDecimal(drops.amount)),
        cashPayoutTotal: money(toDecimal(payouts.amount)),
        transactionCount: sales.transactionCount,

        // Frozen so the closed-shift summary can rebuild its reconciliation
        // from what the drawer actually did, not from the nearest sales column.
        // `cashCollected` is the LEDGER's cash-in — it includes cash exchange
        // top-ups, which `cashSales` cannot, because an exchange is not a sale.
        cashCollected: position.cashIn,
        exchangeTopUps: sales.exchangeTopUps,
        storeCreditTotal: sales.storeCreditRefunds,

        ...(input.notes !== undefined && { notes: input.notes ?? null }),
      },
      tx
    );

    await recordActivity(tx, {
      registerId,
      type: RegisterActivityType.CLOSED,
      description:
        variance.kind === "BALANCED"
          ? `Register closed and balanced at ₹${counted}`
          : `Register closed ${variance.kind === "OVER" ? "OVER" : "SHORT"} by ₹${variance.difference.abs()} — ${input.discrepancyReason}`,
      amount: ZERO,
      balanceAfter: counted,
      referenceType: ReferenceType.CASH_REGISTER,
      referenceId: registerId,
      employeeId: user.id,
    });

    return updated;
  });

  audit({
    employeeId: user.id,
    action: ActionType.REGISTER_CLOSED,
    tableName: "cash_registers",
    recordId: registerId,
    oldData: { status: session.status, expectedBalance: toNumber(session.expectedBalance) },
    newData: {
      sessionNumber: closed.sessionNumber,
      expectedCash: toNumber(position.expectedCash),
      countedCash: toNumber(counted),
      difference: toNumber(variance.difference),
      discrepancyReason: input.discrepancyReason ?? null,
      durationMinutes,
    },
  });

  return {
    session: toSessionDTO(closed),
    variance: {
      difference: toNumber(variance.difference),
      kind: variance.kind,
      percentage: variance.percentage,
    },
  };
}

// =============================================================================
// RECONCILE
// =============================================================================

export async function reconcileRegister(
  registerId: string,
  input: ReconcileRegisterInput,
  user: AuthenticatedUser
) {
  if (!isManagerOrAbove(user)) {
    throw new AppError(HTTP_STATUS.FORBIDDEN, "Only a manager or owner can reconcile a shift.");
  }

  const session = await repo.findById(registerId);
  if (!session) throw new AppError(HTTP_STATUS.NOT_FOUND, "Register session not found.");

  if (session.status === RegisterStatus.OPEN) {
    throw new AppError(HTTP_STATUS.CONFLICT, "Close the shift before reconciling it.");
  }
  if (session.status === RegisterStatus.RECONCILED) {
    throw new AppError(HTTP_STATUS.CONFLICT, "This shift has already been reconciled.");
  }

  // The cashier cannot sign off on their own drawer. Self-approval defeats the
  // entire control — the point of reconciliation is a second pair of eyes.
  if (session.openedById === user.id) {
    throw new AppError(
      HTTP_STATUS.FORBIDDEN,
      "You cannot reconcile a shift you worked. Ask another manager or the owner to sign it off."
    );
  }

  const reconciledAt = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const result = await repo.updateSession(
      registerId,
      {
        status: RegisterStatus.RECONCILED,
        reconciledById: user.id,
        reconciledAt,
        reconcileNotes: input.reconcileNotes ?? null,
      },
      tx
    );

    await recordActivity(tx, {
      registerId,
      type: RegisterActivityType.RECONCILED,
      description: `Shift reconciled and signed off${input.reconcileNotes ? ` — ${input.reconcileNotes}` : ""}`,
      amount: ZERO,
      referenceType: ReferenceType.CASH_REGISTER,
      referenceId: registerId,
      employeeId: user.id,
    });

    return result;
  });

  audit({
    employeeId: user.id,
    action: ActionType.REGISTER_RECONCILED,
    tableName: "cash_registers",
    recordId: registerId,
    newData: { reconciledAt, reconcileNotes: input.reconcileNotes ?? null },
  });

  return toSessionDTO(updated);
}

// =============================================================================
// SHIFT SUMMARY
// =============================================================================

/**
 * The full shift report.
 *
 * For a CLOSED session every figure comes from the frozen rollups — that is the
 * whole reason they are stored. For an OPEN one there is nothing frozen yet, so
 * the same shape is computed live and flagged `isLive` so a caller never
 * mistakes a running total for a final one.
 */
export async function getShiftSummary(registerId: string, user: AuthenticatedUser) {
  const session = await repo.findById(registerId);
  if (!session) throw new AppError(HTTP_STATUS.NOT_FOUND, "Register session not found.");
  assertCanViewSession(session, user);

  const isOpen = session.status === RegisterStatus.OPEN;

  const [position, liveSales, drops, payouts, activity] = await Promise.all([
    isOpen ? computeLivePosition(session) : Promise.resolve(null),
    isOpen ? computeShiftSales(session) : Promise.resolve(null),
    repo.listDrops({ skip: 0, take: 100, where: { registerId } }),
    repo.listPayouts({ skip: 0, take: 100, where: { registerId } }),
    repo.listActivities({ registerId, skip: 0, take: 200 }),
  ]);

  const expectedCash = isOpen ? position!.expectedCash : toDecimal(session.expectedBalance);
  const countedCash = isOpen ? null : toDecimal(session.countedCash);
  const difference = isOpen ? null : toDecimal(session.difference);

  const durationMinutes =
    session.durationMinutes ?? shiftDurationMinutes(session.openedAt, session.closedAt ?? new Date());

  // The traceable build-up. For a CLOSED shift the components come from the
  // frozen rollups and `otherAdjustments` is the residual that makes the lines
  // reconcile to the stored `expectedBalance` — so a summary can never display
  // a set of figures that fails to add up to its own total, even for a session
  // closed before this breakdown existed.
  const cashRefunds = isOpen ? liveSales!.refunds : toDecimal(session.refundTotal);
  const dropTotal = toDecimal(drops.totalAmount);
  const payoutTotal = toDecimal(payouts.totalAmount);

  // Cash collected is the LEDGER's cash-in, never the sales table's cash column.
  // The two differ legitimately — a cash exchange top-up is money in the drawer
  // that is not a sale — and the physical drawer followed the ledger.
  //
  // For a closed shift this comes from the `cashCollected` rollup frozen at
  // close. Shifts closed before that column existed have it backfilled from the
  // ledger by migration; a genuinely un-backfillable zero on a shift that did
  // take cash falls back to `cashSales` so the panel degrades to the old,
  // slightly understated figure rather than to a blank drawer.
  const frozenCashCollected = toDecimal(session.cashCollected);
  const cashCollected = isOpen
    ? position!.cashIn
    : frozenCashCollected.isZero() && !toDecimal(session.cashSales).isZero()
      ? toDecimal(session.cashSales)
      : frozenCashCollected;

  const provisional = buildDrawerBreakdown({
    openingFloat: session.openingBalance,
    cashCollected,
    cashRefunds,
    cashPayouts: payoutTotal,
    cashDrops: dropTotal,
  });

  const drawer = buildDrawerBreakdown({
    openingFloat: session.openingBalance,
    cashCollected,
    cashRefunds,
    cashPayouts: payoutTotal,
    cashDrops: dropTotal,
    otherAdjustments: toDecimal(expectedCash).minus(provisional.expectedInDrawer),
  });

  return {
    isLive: isOpen,
    session: toSessionDTO(session),

    totals: {
      openingCash: toNumber(session.openingBalance),
      cashSales: isOpen ? toNumber(liveSales!.cash) : toNumber(session.cashSales),
      upiSales: isOpen ? toNumber(liveSales!.upi) : toNumber(session.upiSales),
      cardSales: isOpen ? toNumber(liveSales!.card) : toNumber(session.cardSales),
      otherSales: isOpen ? toNumber(liveSales!.other) : toNumber(session.otherSales),
      splitSales: isOpen ? toNumber(liveSales!.split) : toNumber(session.splitSales),
      // Cash refunds only — the figure that legitimately reduces the drawer.
      refunds: toNumber(cashRefunds),
      // Frozen at close rather than hardcoded to 0, which previously made every
      // closed shift claim it had issued no store credit at all.
      storeCreditRefunds: isOpen
        ? toNumber(liveSales!.storeCreditRefunds)
        : toNumber(session.storeCreditTotal),
      // Goods issued on exchange. INFORMATIONAL: it is merchandise value, not
      // money, and is excluded from every cash and drawer total.
      exchanges: isOpen ? toNumber(liveSales!.exchangeValue) : toNumber(session.exchangeTotal),
      discounts: isOpen ? toNumber(liveSales!.discounts) : toNumber(session.discountTotal),
      cashDrops: toNumber(dropTotal),
      cashPayouts: toNumber(payoutTotal),
      expectedCash: toNumber(expectedCash),
      countedCash: countedCash === null ? null : toNumber(countedCash),
      difference: difference === null ? null : toNumber(difference),
      transactionCount: isOpen ? liveSales!.transactionCount : session.transactionCount,
    },

    // Every line is a cash movement, and they sum exactly to expectedInDrawer.
    drawer: {
      openingFloat: toNumber(drawer.openingFloat),
      cashCollected: toNumber(drawer.cashCollected),
      cashRefunds: toNumber(drawer.cashRefunds),
      cashPayouts: toNumber(drawer.cashPayouts),
      cashDrops: toNumber(drawer.cashDrops),
      otherAdjustments: toNumber(drawer.otherAdjustments),
      expectedInDrawer: toNumber(drawer.expectedInDrawer),
      closingCash: countedCash === null ? null : toNumber(countedCash),
    },

    shift: {
      employee: session.openedBy ? employeeName(session.openedBy) : "—",
      employeeCode: session.openedBy?.employeeCode ?? null,
      registerNumber: session.registerNumber,
      openedAt: session.openedAt,
      closedAt: session.closedAt,
      durationMinutes,
      durationLabel: formatDuration(durationMinutes),
      closedBy: session.closedBy ? employeeName(session.closedBy) : null,
      reconciledBy: session.reconciledBy ? employeeName(session.reconciledBy) : null,
      discrepancyReason: session.discrepancyReason,
    },

    denominations: countDenominations(
      (session.denominations as Record<string, number> | null) ?? null
    ).lines.map((l) => ({
      denomination: l.denomination,
      count: l.count,
      value: toNumber(l.value),
    })),

    drops: drops.items.map(toDropDTO),
    payouts: payouts.items.map(toPayoutDTO),
    activity: activity.items.map(toActivityDTO),
  };
}

// =============================================================================
// HISTORY
// =============================================================================

function buildHistoryWhere(
  query: RegisterHistoryQuery,
  user: AuthenticatedUser
): Prisma.CashRegisterWhereInput {
  const where: Prisma.CashRegisterWhereInput = {};

  if (!isManagerOrAbove(user)) where.openedById = user.id;
  else if (query.employeeId) where.openedById = query.employeeId;

  if (query.registerNumber) where.registerNumber = query.registerNumber;
  if (query.status) where.status = query.status as RegisterStatus;

  if (query.startDate || query.endDate) {
    where.openedAt = {
      ...(query.startDate && { gte: query.startDate }),
      ...(query.endDate && { lte: query.endDate }),
    };
  }

  // "Did not balance" means a non-zero difference. `not: 0` alone would also
  // match NULL in some engines, so open sessions (which have no difference yet)
  // are excluded explicitly rather than accidentally counted as discrepancies.
  if (query.hasDiscrepancy === true) {
    where.difference = { not: 0 };
    where.NOT = { difference: null };
  } else if (query.hasDiscrepancy === false) {
    where.difference = 0;
  }

  if (query.search) {
    where.OR = [
      { sessionNumber: { contains: query.search, mode: "insensitive" } },
      { registerNumber: { contains: query.search, mode: "insensitive" } },
      { discrepancyReason: { contains: query.search, mode: "insensitive" } },
      { openedBy: { firstName: { contains: query.search, mode: "insensitive" } } },
      { openedBy: { lastName: { contains: query.search, mode: "insensitive" } } },
      { openedBy: { employeeCode: { contains: query.search, mode: "insensitive" } } },
    ];
  }

  return where;
}

export async function listRegisterHistory(query: RegisterHistoryQuery, user: AuthenticatedUser) {
  const where = buildHistoryWhere(query, user);

  const [{ items, total }, { totals, counts }] = await Promise.all([
    repo.listSessions({
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      where,
      orderBy: { [query.sortBy]: query.sortOrder } as Prisma.CashRegisterOrderByWithRelationInput,
    }),
    repo.aggregateSessions(where),
  ]);

  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));

  return {
    data: items.map(toSessionDTO),
    summary: {
      sessions: total,
      open: byStatus["OPEN"] ?? 0,
      closed: byStatus["CLOSED"] ?? 0,
      reconciled: byStatus["RECONCILED"] ?? 0,
      totalOpeningCash: toNumber(totals._sum.openingBalance),
      totalExpectedCash: toNumber(totals._sum.expectedBalance),
      totalCountedCash: toNumber(totals._sum.countedCash),
      totalDifference: toNumber(totals._sum.difference),
      totalCashSales: toNumber(totals._sum.cashSales),
      totalUpiSales: toNumber(totals._sum.upiSales),
      totalCardSales: toNumber(totals._sum.cardSales),
      totalDrops: toNumber(totals._sum.cashDropTotal),
      totalPayouts: toNumber(totals._sum.cashPayoutTotal),
      totalTransactions: totals._sum.transactionCount ?? 0,
    },
    meta: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}

export async function listSessionActivity(
  registerId: string,
  query: RegisterActivityQuery,
  user: AuthenticatedUser
) {
  const session = await repo.findById(registerId);
  if (!session) throw new AppError(HTTP_STATUS.NOT_FOUND, "Register session not found.");
  assertCanViewSession(session, user);

  const { items, total } = await repo.listActivities({
    registerId,
    skip: (query.page - 1) * query.limit,
    take: query.limit,
    ...(query.type ? { type: query.type as never } : {}),
  });

  return {
    data: items.map(toActivityDTO),
    meta: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}

/** Distinct till identifiers, for the history filter's register dropdown. */
export async function listRegisterNumbers() {
  const numbers = await repo.listRegisterNumbers();
  return numbers.length > 0 ? numbers : ["REG-01"];
}

/** Exposed for the export service, which needs the same filtered set unpaginated. */
export const internals = { buildHistoryWhere, toSessionDTO, computeLivePosition };
