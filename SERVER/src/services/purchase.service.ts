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
import {
  calculatePurchaseTotals,
  checkCancellable,
  planReceipt,
  summariseReceipt,
} from "../engines/procurement.engine";
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

/** Thin alias — the arithmetic itself lives in the procurement engine. */
const calculateTotals = calculatePurchaseTotals;

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

  return {
    ...purchase,
    payments,
    /** Receipt progress, derived once here so every client agrees on it. */
    receipt: summariseReceipt(purchase.items),
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
  // The rules (omitted `items` = everything outstanding; over-receipt rejected,
  // never clamped; a no-op receipt refused) live in the procurement engine so
  // they are unit-testable without a database. See engines/procurement.engine.
  const { instructions: receiptPlan, isFullyReceived } = planReceipt(
    existing.items,
    data.items
  );

  const variantIdByItem = new Map(existing.items.map((i) => [i.id, i.variantId]));
  const costByItem = new Map(existing.items.map((i) => [i.id, i.costPrice]));

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

  const receivedUnits = existing.items.reduce((sum, i) => sum + i.receivedQuantity, 0);
  const paidAmount = Number(existing.paidAmount);

  // The refusal rules live in the engine so they can be regression-tested.
  const refusal = checkCancellable({
    status: existing.status,
    receivedUnits,
    paidAmount,
  });

  if (refusal === "ALREADY_CANCELLED") {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Purchase is already cancelled.");
  }
  if (refusal === "ALREADY_RECEIVED") {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      "Stock has already been received against this purchase. Raise a supplier return instead of cancelling.",
      { reason: "ALREADY_RECEIVED", receivedUnits }
    );
  }
  if (refusal === "ALREADY_PAID") {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      "Payments have been recorded against this bill. Reverse them before cancelling.",
      { reason: "ALREADY_PAID", paidAmount }
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
