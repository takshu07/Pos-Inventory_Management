// =============================================================================
// PURCHASE SERVICE
// =============================================================================

import { Prisma, PurchaseStatus, MovementType } from "../../generated/prisma";
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
} from "../validation/purchase.validation";
import { executeMovement } from "./inventoryMovement.service";
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

  return purchase;
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
  const purchase = await purchaseRepository.create({
    purchaseNumber: generatePurchaseNumber(),
    supplierInvoiceNumber: data.supplierInvoiceNumber ?? null,
    notes: data.notes ?? null,
    discountAmount: new Prisma.Decimal(data.discountAmount.toString()),
    taxAmount: new Prisma.Decimal(data.taxAmount.toString()),
    subtotal: new Prisma.Decimal(subtotal.toString()),
    totalAmount: new Prisma.Decimal(totalAmount.toString()),
    status: data.status,
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

  const updateData = stripUndefined({
    supplierInvoiceNumber: data.supplierInvoiceNumber,
    notes: data.notes,
    discountAmount: data.discountAmount !== undefined ? new Prisma.Decimal(data.discountAmount.toString()) : undefined,
    taxAmount: data.taxAmount !== undefined ? new Prisma.Decimal(data.taxAmount.toString()) : undefined,
    subtotal: new Prisma.Decimal(subtotal.toString()),
    totalAmount: new Prisma.Decimal(totalAmount.toString()),
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

export async function receivePurchase(id: string, data: ReceivePurchaseInput, executorId: string) {
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

  // Transaction: Mark as received AND update inventory
  const receivedPurchase = await prisma.$transaction(async (tx) => {
    // 1. Update purchase status
    const updatePayload = stripUndefined({
      status: PurchaseStatus.RECEIVED,
      notes: data.notes,
      supplierInvoiceNumber: data.supplierInvoiceNumber,
    }) as Prisma.PurchaseUpdateInput;
    
    const purchase = await tx.purchase.update({
      where: { id },
      data: updatePayload,
      include: { items: true },
    });

    // 2. Loop through items and update inventory & variant costPrice
    for (const item of purchase.items) {
      // Execute the movement
      await executeMovement(
        {
          variantId: item.variantId,
          employeeId: executorId,
          type: MovementType.PURCHASE,
          quantityChanged: item.quantity,
          referenceNumber: purchase.purchaseNumber,
          relatedPurchaseId: purchase.id,
          reason: "Purchase Order Received",
        },
        tx
      );

      // Update variant's authoritative costPrice and sellingPrice
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: {
          costPrice: item.costPrice,
          // Optional: Only update sellingPrice if we want POs to dictate it, but usually yes.
          sellingPrice: item.sellingPriceAtPurchase,
        },
      });
    }

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

  logger.info({ executorId, purchaseId: id }, "Purchase received and inventory updated");

  return receivedPurchase;
}
