/**
 * Cash Register types.
 *
 * These mirror the server DTOs exactly. Money arrives as `number` because the
 * service converts Decimal → number at its response boundary — the client
 * never parses a string that might be a currency value, which is where
 * silent NaN corruption creeps in.
 */

export type RegisterStatus = "OPEN" | "CLOSED" | "RECONCILED";

export type RegisterActivityType =
  | "OPENED" | "SALE" | "REFUND" | "EXCHANGE" | "CASH_DROP"
  | "CASH_PAYOUT" | "EXPENSE" | "ADJUSTMENT" | "NOTE" | "CLOSED" | "RECONCILED";

export type PayoutCategory =
  | "TEA" | "COURIER" | "PACKAGING" | "CLEANING" | "TRANSPORT"
  | "STATIONERY" | "MAINTENANCE" | "UTILITIES" | "STAFF_WELFARE" | "MISCELLANEOUS";

export interface EmployeeBrief {
  id: string;
  name: string;
  employeeCode?: string;
  role?: string;
}

export interface RegisterSession {
  id: string;
  sessionNumber: string | null;
  registerNumber: string;
  status: RegisterStatus;

  openedAt: string;
  closedAt: string | null;
  durationMinutes: number | null;
  durationLabel: string;

  employeeId: string;
  employee: EmployeeBrief | null;
  closedBy: EmployeeBrief | null;
  reconciledBy: EmployeeBrief | null;
  reconciledAt: string | null;
  reconcileNotes: string | null;

  openingCash: number;
  closingCash: number;
  expectedCash: number;
  countedCash: number;
  difference: number;
  discrepancyReason: string | null;
  denominations: Record<string, number> | null;

  cashSales: number;
  upiSales: number;
  cardSales: number;
  otherSales: number;
  splitSales: number;
  refundTotal: number;
  exchangeTotal: number;
  discountTotal: number;
  cashDropTotal: number;
  cashPayoutTotal: number;
  transactionCount: number;

  notes: string | null;
  storeCode: string | null;
}

export interface RegisterActivity {
  id: string;
  type: RegisterActivityType;
  description: string;
  amount: number;
  balanceAfter: number | null;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
  employee: EmployeeBrief | null;
}

/**
 * The itemised build-up of expected cash.
 *
 * ONLY CASH APPEARS HERE. UPI, card, exchange and store-credit values are
 * excluded by design — they move no notes, and including them would produce a
 * drawer figure that can never be counted against.
 *
 *   expectedInDrawer = openingFloat + cashCollected
 *                    − cashRefunds − cashPayouts − cashDrops
 *                    ± otherAdjustments
 */
export interface DrawerBreakdown {
  openingFloat: number;
  cashCollected: number;
  cashRefunds: number;
  cashPayouts: number;
  cashDrops: number;
  otherAdjustments: number;
  expectedInDrawer: number;
}

export interface LiveDashboard {
  hasOpenSession: boolean;
  session: RegisterSession | null;
  position: {
    openingCash: number;
    cashIn: number;
    cashOut: number;
    expectedCash: number;
  } | null;
  /**
   * The traceable build-up of expected cash. Every field is a CASH movement,
   * and the lines reconcile exactly to `expectedInDrawer`.
   */
  drawer: DrawerBreakdown | null;
  /** Money taken this shift, and what was handed back in cash. */
  collected: {
    cash: number;
    upi: number;
    card: number;
    other: number;
    digital: number;
    totalCollected: number;
    cashRefunds: number;
    storeCreditRefunds: number;
    netCollected: number;
    /** Money taken on exchanges. Part of totalCollected, not of grossSales. */
    exchangeTopUps: number;
    grossSales: number;
  } | null;
  sales: {
    cash: number;
    upi: number;
    card: number;
    other: number;
    split: number;
    gross: number;
    discounts: number;
    /** Refunds paid back in CASH. The only refund figure that hits the drawer. */
    refunds: number;
    refundCount: number;
    /** Refunds settled as store credit. Informational — moves no notes. */
    storeCreditRefunds: number;
    totalRefunds: number;
    /** Merchandise value issued on exchange. Informational, never cash. */
    exchangeValue: number;
    exchangeCount: number;
    transactionCount: number;
  } | null;
  drops: { total: number; count: number } | null;
  payouts: { total: number; count: number } | null;
  shift?: {
    openedAt: string;
    elapsedMinutes: number;
    elapsedLabel: string;
  };
  recentActivity: RegisterActivity[];
}

export interface CashDrop {
  id: string;
  dropNumber: string;
  amount: number;
  reason: string;
  destination: string | null;
  referenceNumber: string | null;
  createdAt: string;
  employee: EmployeeBrief | null;
  witnessedBy: EmployeeBrief | null;
  register: { id: string; registerNumber: string; sessionNumber: string | null } | null;
}

export interface CashPayout {
  id: string;
  payoutNumber: string;
  category: PayoutCategory;
  amount: number;
  reason: string;
  payeeName: string | null;
  receiptAssetId: string | null;
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED";
  approvedAt: string | null;
  expenseId: string | null;
  createdAt: string;
  employee: EmployeeBrief | null;
  approvedBy: EmployeeBrief | null;
  register: { id: string; registerNumber: string; sessionNumber: string | null } | null;
}

export interface ClosePreview {
  registerId: string;
  sessionNumber: string | null;
  registerNumber: string;
  openedAt: string;
  openingCash: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  cashSales: number;
  upiSales: number;
  cardSales: number;
  otherSales: number;
  refunds: number;
  cashDropTotal: number;
  cashPayoutTotal: number;
  transactionCount: number;
}

export interface ShiftSummary {
  isLive: boolean;
  session: RegisterSession;
  totals: {
    openingCash: number;
    cashSales: number;
    upiSales: number;
    cardSales: number;
    otherSales: number;
    splitSales: number;
    /** Cash refunds only — the figure that legitimately reduces the drawer. */
    refunds: number;
    /** Refunds settled as store credit. Informational. */
    storeCreditRefunds: number;
    /** Merchandise issued on exchange. Informational, never cash. */
    exchanges: number;
    discounts: number;
    cashDrops: number;
    cashPayouts: number;
    expectedCash: number;
    countedCash: number | null;
    difference: number | null;
    transactionCount: number;
  };
  /** Line-by-line build-up of expected cash; sums exactly to its own total. */
  drawer: DrawerBreakdown & { closingCash: number | null };
  shift: {
    employee: string;
    employeeCode: string | null;
    registerNumber: string;
    openedAt: string;
    closedAt: string | null;
    durationMinutes: number;
    durationLabel: string;
    closedBy: string | null;
    reconciledBy: string | null;
    discrepancyReason: string | null;
  };
  denominations: Array<{ denomination: number; count: number; value: number }>;
  drops: CashDrop[];
  payouts: CashPayout[];
  activity: RegisterActivity[];
}

export interface RegisterHistorySummary {
  sessions: number;
  open: number;
  closed: number;
  reconciled: number;
  totalOpeningCash: number;
  totalExpectedCash: number;
  totalCountedCash: number;
  totalDifference: number;
  totalCashSales: number;
  totalUpiSales: number;
  totalCardSales: number;
  totalDrops: number;
  totalPayouts: number;
  totalTransactions: number;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

// =============================================================================
// PAYLOADS
// =============================================================================

export interface OpenRegisterPayload {
  registerNumber: string;
  openingCash: number;
  notes?: string;
  denominations?: Record<string, number>;
}

export interface CloseRegisterPayload {
  countedCash: number;
  notes?: string;
  discrepancyReason?: string;
  denominations?: Record<string, number>;
  expectedCashAtSubmit?: number;
}

export interface CashDropPayload {
  amount: number;
  reason: string;
  destination?: string;
  referenceNumber?: string;
  witnessedById?: string;
}

export interface CashPayoutPayload {
  category: PayoutCategory;
  amount: number;
  reason: string;
  payeeName?: string;
  receiptAssetId?: string;
}

export interface AdjustmentPayload {
  direction: "IN" | "OUT";
  amount: number;
  reason: string;
}

export interface RegisterHistoryParams {
  page?: number;
  limit?: number;
  search?: string;
  startDate?: string;
  endDate?: string;
  employeeId?: string;
  registerNumber?: string;
  status?: RegisterStatus;
  hasDiscrepancy?: boolean;
  sortBy?: "openedAt" | "closedAt" | "difference" | "expectedBalance";
  sortOrder?: "asc" | "desc";
}

export interface DropListParams {
  page?: number;
  limit?: number;
  search?: string;
  startDate?: string;
  endDate?: string;
  registerId?: string;
  employeeId?: string;
}

export interface PayoutListParams extends DropListParams {
  category?: PayoutCategory;
}
