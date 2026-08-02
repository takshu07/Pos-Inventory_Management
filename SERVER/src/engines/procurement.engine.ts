// =============================================================================
// PROCUREMENT ENGINE
// =============================================================================
//
// The pure decision logic behind goods receipt and purchase totals.
//
// WHY THIS EXISTS SEPARATELY FROM purchase.service:
// the service owns the transaction, the inventory movements and the audit
// trail — all of which need a database. The RULES it applies (what may be
// received, whether a receipt completes an order, what a bill totals) are
// arithmetic and are the part most likely to be quietly wrong. Extracting them
// makes them testable without a database, which is the only way they get
// regression coverage on this project: the integration suite refuses to run
// against a non-test database, and there isn't one.
//
// Everything here is a pure function. No Prisma, no clock reads except where a
// date is passed in explicitly.
// =============================================================================

import { Prisma } from "../../generated/prisma";
import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";

// -----------------------------------------------------------------------------
// TOTALS
// -----------------------------------------------------------------------------

export interface PurchaseLineAmounts {
  quantity: number;
  costPrice: number;
}

export interface PurchaseTotals {
  subtotal: number;
  totalAmount: number;
}

/**
 * Bill arithmetic: `subtotal - discount + tax`.
 *
 * Throws rather than clamping a negative total. A discount larger than the
 * goods plus tax is a data-entry error, and silently flooring it at zero would
 * create a bill whose stated total does not match its lines.
 */
export function calculatePurchaseTotals(
  items: PurchaseLineAmounts[],
  discount: number,
  tax: number
): PurchaseTotals {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.costPrice, 0);
  const totalAmount = subtotal - discount + tax;

  if (totalAmount < 0) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Total amount cannot be negative.");
  }

  return { subtotal, totalAmount };
}

// -----------------------------------------------------------------------------
// GOODS RECEIPT
// -----------------------------------------------------------------------------

/** A purchase line as the receipt planner needs to see it. */
export interface ReceivableLine {
  id: string;
  quantity: number;
  receivedQuantity: number;
}

/** One instruction: book `quantity` more units against line `itemId`. */
export interface ReceiptInstruction {
  itemId: string;
  quantity: number;
}

export interface ReceiptPlan {
  /** Lines to actually book, zero-quantity entries removed. */
  instructions: ReceiptInstruction[];
  /** True when this receipt closes out every outstanding unit. */
  isFullyReceived: boolean;
  /** Total units booked by this receipt. */
  totalUnits: number;
}

/** Units still owed on a line. */
export function outstandingFor(line: ReceivableLine): number {
  return Math.max(0, line.quantity - line.receivedQuantity);
}

/**
 * Decides what a goods receipt will book, and validates it.
 *
 * `requested === undefined` means "receive everything still outstanding" — the
 * behaviour the endpoint had before partial receipts existed, preserved so
 * existing callers are unaffected.
 *
 * Rejects rather than clamps an over-receipt: taking in more than was ordered
 * is nearly always a mis-keyed number, and absorbing it silently would put
 * stock on the shelf that the supplier never shipped, which then reconciles
 * against nothing.
 */
export function planReceipt(
  lines: ReceivableLine[],
  requested?: ReceiptInstruction[]
): ReceiptPlan {
  const outstandingById = new Map(lines.map((l) => [l.id, outstandingFor(l)]));

  let instructions: ReceiptInstruction[];

  if (requested) {
    const seen = new Set<string>();

    for (const line of requested) {
      if (seen.has(line.itemId)) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "The same purchase line was submitted twice in one receipt."
        );
      }
      seen.add(line.itemId);

      const outstanding = outstandingById.get(line.itemId);
      if (outstanding === undefined) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "A submitted line does not belong to this purchase."
        );
      }
      if (line.quantity < 0) {
        throw new AppError(HTTP_STATUS.BAD_REQUEST, "Received quantity cannot be negative.");
      }
      if (line.quantity > outstanding) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          `Cannot receive ${line.quantity} units — only ${outstanding} remain outstanding on that line.`,
          { reason: "OVER_RECEIPT", itemId: line.itemId, outstanding }
        );
      }
    }

    instructions = requested.filter((l) => l.quantity > 0);
  } else {
    instructions = lines
      .map((l) => ({ itemId: l.id, quantity: outstandingFor(l) }))
      .filter((l) => l.quantity > 0);
  }

  if (instructions.length === 0) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      "Nothing to receive — every line on this purchase is already fully received."
    );
  }

  const booked = new Map(instructions.map((i) => [i.itemId, i.quantity]));
  const isFullyReceived = lines.every(
    (l) => l.receivedQuantity + (booked.get(l.id) ?? 0) >= l.quantity
  );

  return {
    instructions,
    isFullyReceived,
    totalUnits: instructions.reduce((sum, i) => sum + i.quantity, 0),
  };
}

/** Aggregate receipt progress for a purchase — what the detail screen shows. */
export interface ReceiptProgress {
  orderedUnits: number;
  receivedUnits: number;
  outstandingUnits: number;
  isFullyReceived: boolean;
  percentReceived: number;
}

export function summariseReceipt(lines: ReceivableLine[]): ReceiptProgress {
  const orderedUnits = lines.reduce((sum, l) => sum + l.quantity, 0);
  const receivedUnits = lines.reduce((sum, l) => sum + l.receivedQuantity, 0);

  return {
    orderedUnits,
    receivedUnits,
    outstandingUnits: Math.max(0, orderedUnits - receivedUnits),
    // An empty purchase is not "fully received"; it has nothing to receive.
    isFullyReceived: orderedUnits > 0 && receivedUnits >= orderedUnits,
    percentReceived: orderedUnits === 0 ? 0 : Math.round((receivedUnits / orderedUnits) * 100),
  };
}

// -----------------------------------------------------------------------------
// CANCELLATION
// -----------------------------------------------------------------------------

export type CancelRefusal = "ALREADY_RECEIVED" | "ALREADY_PAID" | "ALREADY_CANCELLED" | null;

/**
 * Whether a purchase may still be cancelled.
 *
 * Refuses once ANY stock has been received — reversing a receipt is a supplier
 * return, with its own movement type and paperwork, not a side effect of
 * cancelling the order. Refuses once ANY money has been paid, because a bill
 * with payments against it must be settled or refunded rather than erased.
 */
export function checkCancellable(params: {
  status: string;
  receivedUnits: number;
  paidAmount: number;
}): CancelRefusal {
  if (params.status === "CANCELLED") return "ALREADY_CANCELLED";
  if (params.receivedUnits > 0) return "ALREADY_RECEIVED";
  if (params.paidAmount > 0) return "ALREADY_PAID";
  return null;
}

// -----------------------------------------------------------------------------
// BRAND STATISTICS
// -----------------------------------------------------------------------------

/**
 * Raw stat row as Postgres returns it: COUNT/SUM come back as BIGINT and
 * Decimal as string, neither of which survives JSON.
 */
export interface RawBrandStats {
  productCount: bigint | number | string;
  variantCount: bigint | number | string;
  unitsSold: bigint | number | string;
  revenue: string | number | null;
  stockUnits: bigint | number | string;
  stockValue: string | number | null;
}

export interface BrandStats {
  productCount: number;
  variantCount: number;
  unitsSold: number;
  revenue: number;
  stockUnits: number;
  stockValue: number;
  averageSellingPrice: number;
}

/**
 * Normalises a raw brand stat row into plain numbers.
 *
 * A missing row means a brand with no products at all, which is zero across the
 * board — not null. Rendering "—" for a brand that genuinely has nothing would
 * be indistinguishable from a failed query.
 */
export function projectBrandStats(raw: RawBrandStats | undefined): BrandStats {
  const unitsSold = Number(raw?.unitsSold ?? 0);
  const revenue = Number(raw?.revenue ?? 0);

  return {
    productCount: Number(raw?.productCount ?? 0),
    variantCount: Number(raw?.variantCount ?? 0),
    unitsSold,
    revenue,
    stockUnits: Number(raw?.stockUnits ?? 0),
    stockValue: Number(raw?.stockValue ?? 0),
    // Guard the zero denominator: a brand that has sold nothing has no average
    // price, and NaN would render as "NaN" on a card.
    averageSellingPrice: unitsSold === 0 ? 0 : Number((revenue / unitsSold).toFixed(2)),
  };
}

// -----------------------------------------------------------------------------
// SUPPLIER BALANCES
// -----------------------------------------------------------------------------

export interface SupplierRollupInput {
  /** Non-cancelled bills for this supplier. */
  purchaseCount: number;
  totalSpend: Prisma.Decimal | number | null;
  /** Sum of paidAmount across those bills — money applied TO bills. */
  paidOnBills: Prisma.Decimal | number | null;
  /** Sum of dueAmount across those bills — the authoritative liability. */
  outstanding: Prisma.Decimal | number | null;
  /** Sum of every SupplierPayment, bill-linked or not. */
  totalPaid: Prisma.Decimal | number | null;
  paymentCount: number;
}

export interface SupplierBalances {
  purchaseCount: number;
  totalSpend: number;
  outstanding: number;
  totalPaid: number;
  onAccountCredit: number;
  paymentCount: number;
}

/**
 * Derives a supplier's money position.
 *
 * `outstanding` is taken from the BILLS' own dueAmount, never recomputed as
 * (spend − paid). The two diverge the moment an on-account payment exists — one
 * not tied to any bill — and treating that as settling specific bills would
 * understate what is still owed against them. On-account money is reported
 * separately as credit instead of being netted off silently.
 */
export function deriveSupplierBalances(input: SupplierRollupInput): SupplierBalances {
  const totalSpend = Number(input.totalSpend ?? 0);
  const paidOnBills = Number(input.paidOnBills ?? 0);
  const outstanding = Number(input.outstanding ?? 0);
  const totalPaid = Number(input.totalPaid ?? 0);

  return {
    purchaseCount: input.purchaseCount,
    totalSpend,
    outstanding,
    totalPaid,
    onAccountCredit: Number((totalPaid - paidOnBills).toFixed(2)),
    paymentCount: input.paymentCount,
  };
}
