// =============================================================================
// PURCHASE SERVICE
// =============================================================================

import { Prisma, PurchaseStatus, MovementType } from "../../generated/prisma";
import type { EmployeeRole } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import { purchaseRepository } from "../repositories/purchase.repository";
import { supplierRepository } from "../repositories/supplier.repository";
import { auditRepository } from "../repositories/audit.repository";
import { logger } from "../config/logger";
import { stripUndefined } from "../utils/object";
import type { PaginatedResponse } from "../types/common.types";
import type {
  CreatePurchaseInput,
  UpdatePurchaseInput,
  ReceivePurchaseInput,
  ListPurchasesQuery,
  CancelPurchaseInput,
} from "../validation/purchase.validation";
import { deriveSettlementStatus } from "../engines/finance.engine";
import { executeMovement } from "./inventoryMovement.service";
import { recomputeVariants } from "./effectivePrice.service";
import { labelIntegrationService } from "./labelIntegration.service";
import crypto from "crypto";

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

function generatePurchaseNumber(): string {
  // E.g. PO-240712-4F8A
  const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const randomPart = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `PO-${datePart}-${randomPart}`;
}

function calculateTotals(items: { quantity: number; costPrice: number }[], discount: number, tax: number) {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.costPrice, 0);
  const totalAmount = subtotal - discount + tax;

  if (totalAmount < 0) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Total amount cannot be negative.");
  }

  return { subtotal, totalAmount };
}

// -----------------------------------------------------------------------------
// READ OPERATIONS
// -----------------------------------------------------------------------------

export async function listPurchases(query: ListPurchasesQuery) {
  const { data, total } = await purchaseRepository.findMany(query);
  const totalPages = Math.ceil(total / query.limit);

  return {
    data,
    meta: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPreviousPage: query.page > 1,
    },
  } as PaginatedResponse<(typeof data)[0]>;
}

export async function getPurchaseById(id: string) {
  const purchase = await purchaseRepository.findById(id);

  if (!purchase) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Purchase not found.");
  }

  // Settlement history belongs on the bill it settles — the detail screen shows
  // goods receipt and payment side by side.
  const payments = await purchaseRepository.paymentsFor(id);

  const receivedUnits = purchase.items.reduce((sum, i) => sum + i.receivedQuantity, 0);
  const orderedUnits = purchase.items.reduce((sum, i) => sum + i.quantity, 0);

  return {
    ...purchase,
    payments,
    /** Receipt progress, derived once here so every client agrees on it. */
    receipt: {
      orderedUnits,
      receivedUnits,
      outstandingUnits: orderedUnits - receivedUnits,
      isFullyReceived: receivedUnits >= orderedUnits && orderedUnits > 0,
      percentReceived: orderedUnits === 0 ? 0 : Math.round((receivedUnits / orderedUnits) * 100),
    },
  };
}

// -----------------------------------------------------------------------------
// WRITE OPERATIONS
// -----------------------------------------------------------------------------

export async function createPurchase(data: CreatePurchaseInput, executorId: string) {
  // 1. Validate Supplier
  const supplier = await supplierRepository.findById(data.supplierId);
  if (!supplier) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Supplier not found.");
  }
  if (!supplier.isActive) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Cannot create purchase for an inactive supplier.");
  }

  // 2. Calculate Totals
  const { subtotal, totalAmount } = calculateTotals(data.items, data.discountAmount, data.taxAmount);

  // 3. Prepare Items (Zod guarantees items exist)
  const purchaseItems: Prisma.PurchaseItemCreateWithoutPurchaseInput[] = data.items.map((item) => ({
    quantity: item.quantity,
    costPrice: new Prisma.Decimal(item.costPrice.toString()),
    sellingPriceAtPurchase: new Prisma.Decimal(item.sellingPriceAtPurchase.toString()),
    totalPrice: new Prisma.Decimal((item.quantity * item.costPrice).toString()),
    variant: { connect: { id: item.variantId } },
  }));

  // 4. Save
  //
  // dueAmount is seeded from the total here. It used to be left at its schema
  // default of 0, which meant a brand-new unpaid bill reported nothing
  // outstanding and never appeared in the payables queue or in a supplier's
  // balance. Nothing is paid at creation time, so the whole total is due.
  const purchase = await purchaseRepository.create({
    purchaseNumber: generatePurchaseNumber(),
    supplierInvoiceNumber: data.supplierInvoiceNumber ?? null,
    notes: data.notes ?? null,
    discountAmount: new Prisma.Decimal(data.discountAmount.toString()),
    taxAmount: new Prisma.Decimal(data.taxAmount.toString()),
    subtotal: new Prisma.Decimal(subtotal.toString()),
    totalAmount: new Prisma.Decimal(totalAmount.toString()),
    status: data.status,
    dueAmount: new Prisma.Decimal(totalAmount.toString()),
    paidAmount: new Prisma.Decimal(0),
    paymentStatus: "UNPAID",
    ...(data.dueDate ? { dueDate: data.dueDate } : {}),
    supplier: { connect: { id: data.supplierId } },
    employee: { connect: { id: executorId } },
    items: { create: purchaseItems },
  });

  // 5. Audit
  auditRepository.create({
    performedBy: executorId,
    action: "CREATE",
    module: "PURCHASE",
    tableName: "purchases",
    recordId: purchase.id,
    newData: purchase as unknown as Record<string, unknown>,
  });

  logger.info({ executorId, purchaseId: purchase.id }, "Purchase created");

  return purchase;
}

export async function updatePurchase(id: string, data: UpdatePurchaseInput, executorId: string) {
  const existing = await purchaseRepository.findById(id);

  if (!existing) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Purchase not found.");
  }

  if (existing.status === PurchaseStatus.RECEIVED || existing.status === PurchaseStatus.CANCELLED) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, `Cannot modify a purchase with status ${existing.status}.`);
  }

  // Calculate new totals if items or monetary fields changed
  const itemsToCalculate = data.items ?? existing.items.map(i => ({ 
    quantity: i.quantity, 
    costPrice: Number(i.costPrice) 
  }));
  const discountAmount = data.discountAmount ?? Number(existing.discountAmount);
  const taxAmount = data.taxAmount ?? Number(existing.taxAmount);
  
  const { subtotal, totalAmount } = calculateTotals(itemsToCalculate, discountAmount, taxAmount);

  // Editing the total moves the goalposts for settlement, so the payables
  // columns have to be re-derived in the same write. Leaving dueAmount at its
  // old value would let a repriced bill report a balance that no longer
  // matches totalAmount - paidAmount.
  const settlement = deriveSettlementStatus({
    total: totalAmount,
    paid: existing.paidAmount,
    dueDate: data.dueDate !== undefined ? data.dueDate : existing.dueDate,
  });

  if (settlement.dueAmount.lessThan(0)) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      "The new total is less than what has already been paid on this bill."
    );
  }

  const updateData = stripUndefined({
    supplierInvoiceNumber: data.supplierInvoiceNumber,
    notes: data.notes,
    status: data.status,
    dueDate: data.dueDate,
    discountAmount: data.discountAmount !== undefined ? new Prisma.Decimal(data.discountAmount.toString()) : undefined,
    taxAmount: data.taxAmount !== undefined ? new Prisma.Decimal(data.taxAmount.toString()) : undefined,
    subtotal: new Prisma.Decimal(subtotal.toString()),
    totalAmount: new Prisma.Decimal(totalAmount.toString()),
    dueAmount: settlement.dueAmount,
    paymentStatus: settlement.status as never,
  }) as Prisma.PurchaseUpdateInput;

  // If items changed, we delete old and recreate.
  if (data.items) {
    const purchaseItems = data.items.map((item) => ({
      quantity: item.quantity,
      costPrice: new Prisma.Decimal(item.costPrice.toString()),
      sellingPriceAtPurchase: new Prisma.Decimal(item.sellingPriceAtPurchase.toString()),
      totalPrice: new Prisma.Decimal((item.quantity * item.costPrice).toString()),
      variantId: item.variantId,
    }));

    updateData.items = {
      deleteMany: {},
      create: purchaseItems,
    };
  }

  const updated = await purchaseRepository.update(id, updateData);

  auditRepository.create({
    performedBy: executorId,
    action: "UPDATE",
    module: "PURCHASE",
    tableName: "purchases",
    recordId: id,
    oldData: existing as unknown as Record<string, unknown>,
    newData: updated as unknown as Record<string, unknown>,
  });

  logger.info({ executorId, purchaseId: id }, "Purchase updated");

  return updated;
}

export async function receivePurchase(
  id: string,
  data: ReceivePurchaseInput,
  executorId: string,
  // Optional so existing callers are unaffected. Used only to attribute the
  // automatic label print that follows a receipt. Defaults to MANAGER because
  // the receive route is already gated at MANAGER or above, and the Label
  // Engine re-checks permissions itself regardless.
  executorRole: EmployeeRole = "MANAGER"
) {
  const existing = await purchaseRepository.findById(id);

  if (!existing) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Purchase not found.");
  }

  if (existing.status === PurchaseStatus.RECEIVED) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Purchase is already received.");
  }
  if (existing.status === PurchaseStatus.CANCELLED) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Cannot receive a cancelled purchase.");
  }

  // ── Resolve what is actually being booked in on this receipt ───────────────
  //
  // Omitting `items` means "receive everything still outstanding", which is the
  // original all-or-nothing behaviour. Supplying it books the given quantities
  // against the named lines and leaves the rest outstanding.
  const outstandingByItem = new Map(
    existing.items.map((i) => [i.id, i.quantity - i.receivedQuantity])
  );

  let receiptPlan: { itemId: string; quantity: number }[];

  if (data.items) {
    const seen = new Set<string>();
    for (const line of data.items) {
      if (seen.has(line.itemId)) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "The same purchase line was submitted twice in one receipt."
        );
      }
      seen.add(line.itemId);

      const outstanding = outstandingByItem.get(line.itemId);
      if (outstanding === undefined) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "A submitted line does not belong to this purchase."
        );
      }
      // Over-receipt is a mis-keyed number far more often than a genuine
      // over-shipment. Rejecting keeps physical stock honest; clamping would
      // silently invent inventory.
      if (line.quantity > outstanding) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          `Cannot receive ${line.quantity} units — only ${outstanding} remain outstanding on that line.`,
          { reason: "OVER_RECEIPT", itemId: line.itemId, outstanding }
        );
      }
    }

    receiptPlan = data.items.filter((l) => l.quantity > 0);
  } else {
    receiptPlan = existing.items
      .map((i) => ({ itemId: i.id, quantity: i.quantity - i.receivedQuantity }))
      .filter((l) => l.quantity > 0);
  }

  if (receiptPlan.length === 0) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      "Nothing to receive — every line on this purchase is already fully received."
    );
  }

  const variantIdByItem = new Map(existing.items.map((i) => [i.id, i.variantId]));
  const costByItem = new Map(existing.items.map((i) => [i.id, i.costPrice]));

  // Does this receipt close out the purchase, or leave lines open?
  const isFullyReceived = existing.items.every((i) => {
    const booked = receiptPlan.find((l) => l.itemId === i.id)?.quantity ?? 0;
    return i.receivedQuantity + booked >= i.quantity;
  });

  // Transaction: record the receipt AND move the stock, atomically.
  const receivedPurchase = await prisma.$transaction(async (tx) => {
    // 1. Update purchase status
    const updatePayload = stripUndefined({
      status: isFullyReceived ? PurchaseStatus.RECEIVED : PurchaseStatus.PARTIAL,
      // Only a completed receipt gets a completion timestamp.
      receivedAt: isFullyReceived ? new Date() : undefined,
      notes: data.notes,
      supplierInvoiceNumber: data.supplierInvoiceNumber,
    }) as Prisma.PurchaseUpdateInput;

    const purchase = await tx.purchase.update({
      where: { id },
      data: updatePayload,
      include: { items: true },
    });

    // 2. Book each received line into stock and advance its received counter.
    for (const line of receiptPlan) {
      const variantId = variantIdByItem.get(line.itemId)!;

      // Execute the movement — the ONLY sanctioned path to currentStock.
      await executeMovement(
        {
          variantId,
          employeeId: executorId,
          type: MovementType.PURCHASE,
          quantityChanged: line.quantity,
          referenceNumber: purchase.purchaseNumber,
          relatedPurchaseId: purchase.id,
          reason: isFullyReceived ? "Purchase Order Received" : "Purchase Order Partially Received",
        },
        tx
      );

      await tx.purchaseItem.update({
        where: { id: line.itemId },
        data: { receivedQuantity: { increment: line.quantity } },
      });

      const item = { variantId, costPrice: costByItem.get(line.itemId)! };

      // Update the variant's cached costPrice from this receipt.
      //
      // sellingPrice is deliberately NOT written here. It used to be copied
      // from item.sellingPriceAtPurchase, which silently overwrote the shelf
      // price on every goods receipt — bypassing the mrp >= selling >= cost
      // invariant and fighting any active discount. Selling price is now
      // derived, so we update the cost input and let the pricing engine
      // recompute the price below.
      //
      // item.sellingPriceAtPurchase is still recorded on the PurchaseItem as
      // the planned-margin snapshot for that purchase; it is simply no longer
      // treated as an instruction to reprice the catalog.
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { costPrice: item.costPrice },
      });
    }

    // Re-derive selling prices for everything THIS receipt touched — not every
    // line on the purchase. On a partial receipt the untouched lines have not
    // had their cost updated, so repricing them would be a no-op at best and a
    // spurious price event at worst.
    await recomputeVariants(
      receiptPlan.map((l) => variantIdByItem.get(l.itemId)!),
      { tx }
    );

    return purchase;
  });

  auditRepository.create({
    performedBy: executorId,
    action: "UPDATE",
    module: "PURCHASE",
    tableName: "purchases",
    recordId: id,
    oldData: existing as unknown as Record<string, unknown>,
    newData: receivedPurchase as unknown as Record<string, unknown>,
  });

  logger.info(
    {
      executorId,
      purchaseId: id,
      lines: receiptPlan.length,
      units: receiptPlan.reduce((sum, l) => sum + l.quantity, 0),
      fullyReceived: isFullyReceived,
    },
    isFullyReceived
      ? "Purchase received and inventory updated"
      : "Purchase partially received and inventory updated"
  );

  // ── Label Engine integration ───────────────────────────────────────────────
  // "After Purchase Receive → print quantity based on received stock."
  //
  // Deliberately AFTER the transaction commits and deliberately not awaited:
  // the receipt is already durable, so a printer problem must not roll back
  // received stock. The integration honours the printAfterPurchase setting and
  // swallows its own errors — the Label Engine never fails a purchase.
  void labelIntegrationService
    .maybePrintAfterPurchaseReceive(id, { id: executorId, role: executorRole })
    .catch(() => {
      /* already logged inside the integration */
    });

  return receivedPurchase;
}

// -----------------------------------------------------------------------------
// CANCELLATION
// -----------------------------------------------------------------------------

/**
 * Cancels an unreceived purchase order.
 *
 * Deliberately REFUSES once any stock has been booked in. Reversing a receipt
 * is a supplier return — a distinct movement with its own paperwork — not a
 * side effect of cancelling the paperwork that ordered it. Allowing cancel here
 * would silently strand stock on the shelf with no order backing it.
 *
 * Equally refuses once money has moved: a bill with payments against it must be
 * settled or refunded, not erased.
 */
export async function cancelPurchase(
  id: string,
  data: CancelPurchaseInput,
  executorId: string
) {
  const existing = await purchaseRepository.findById(id);

  if (!existing) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Purchase not found.");
  }

  if (existing.status === PurchaseStatus.CANCELLED) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Purchase is already cancelled.");
  }

  const receivedUnits = existing.items.reduce((sum, i) => sum + i.receivedQuantity, 0);
  if (receivedUnits > 0) {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      "Stock has already been received against this purchase. Raise a supplier return instead of cancelling.",
      { reason: "ALREADY_RECEIVED", receivedUnits }
    );
  }

  if (Number(existing.paidAmount) > 0) {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      "Payments have been recorded against this bill. Reverse them before cancelling.",
      { reason: "ALREADY_PAID", paidAmount: Number(existing.paidAmount) }
    );
  }

  const cancelled = await purchaseRepository.update(id, {
    status: PurchaseStatus.CANCELLED,
    // A cancelled bill owes nothing, so it drops out of the payables queue.
    dueAmount: new Prisma.Decimal(0),
    paymentStatus: "CANCELLED",
    notes: existing.notes
      ? `${existing.notes}\n\n[Cancelled] ${data.reason}`
      : `[Cancelled] ${data.reason}`,
  });

  auditRepository.create({
    performedBy: executorId,
    action: "UPDATE",
    module: "PURCHASE",
    tableName: "purchases",
    recordId: id,
    oldData: existing as unknown as Record<string, unknown>,
    newData: { status: PurchaseStatus.CANCELLED, reason: data.reason },
  });

  logger.info({ executorId, purchaseId: id }, "Purchase cancelled");

  return cancelled;
}
