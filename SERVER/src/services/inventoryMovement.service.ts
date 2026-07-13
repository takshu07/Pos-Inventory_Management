// =============================================================================
// INVENTORY MOVEMENT SERVICE
// =============================================================================

import type { Prisma } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import { auditRepository } from "../repositories/audit.repository";
import { logger } from "../config/logger";
import type { PaginatedResponse } from "../types/common.types";
import type {
  CreateInventoryMovementInput,
  ListInventoryMovementsQuery,
} from "../validation/inventoryMovement.validation";
import { inventoryMovementRepository as localRepo } from "../repositories/inventoryMovement.repository";
import { stripUndefined } from "../utils/object";

export async function listInventoryMovements(query: ListInventoryMovementsQuery) {
  const { data, total } = await localRepo.findMany(query);
  const totalPages = Math.ceil(total / query.limit);

  const response: PaginatedResponse<(typeof data)[0]> = {
    data,
    meta: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPreviousPage: query.page > 1,
    },
  };

  return response;
}

export async function getInventoryMovementById(id: string) {
  const movement = await localRepo.findById(id);

  if (!movement) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Inventory movement not found.");
  }

  return movement;
}

/**
 * Core transactional engine for all stock changes.
 * Can be called standalone, or passed an existing Prisma Transaction Client 
 * (e.g. from the Sales module).
 */
export async function executeMovement(
  data: Omit<Prisma.InventoryMovementUncheckedCreateInput, 'stockBefore' | 'stockAfter' | 'employeeId'> & {
    employeeId: string;
  },
  txClient: Prisma.TransactionClient = prisma
) {
  // 1. Fetch variant to get current stock (locking the row conceptually within a transaction)
  const variant = await txClient.productVariant.findUnique({
    where: { id: data.variantId },
    select: { id: true, currentStock: true, isActive: true },
  });

  if (!variant) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Product variant not found.");
  }

  if (!variant.isActive) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, "Cannot adjust stock for an inactive variant.");
  }

  // 2. Calculate new stock
  const stockBefore = variant.currentStock;
  const stockAfter = stockBefore + data.quantityChanged;

  if (stockAfter < 0) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      `Insufficient stock. Attempted to reduce stock by ${Math.abs(data.quantityChanged)}, but only ${stockBefore} available.`
    );
  }

  // 3. Update variant stock
  await txClient.productVariant.update({
    where: { id: variant.id },
    data: { currentStock: stockAfter },
  });

  // 4. Create movement ledger entry
  const createPayload = stripUndefined({
    variantId: data.variantId,
    employeeId: data.employeeId,
    type: data.type,
    quantityChanged: data.quantityChanged,
    stockBefore,
    stockAfter,
    reason: data.reason ?? null,
    referenceNumber: data.referenceNumber ?? null,
    relatedPurchaseId: data.relatedPurchaseId ?? null,
    relatedSaleId: data.relatedSaleId ?? null,
    relatedExchangeId: data.relatedExchangeId ?? null,
  }) as Prisma.InventoryMovementUncheckedCreateInput;

  const movement = await txClient.inventoryMovement.create({
    data: createPayload,
  });

  return movement;
}

/**
 * Handles API-initiated manual adjustments.
 */
export async function createManualAdjustment(
  data: CreateInventoryMovementInput,
  executorId: string
) {
  // Execute the entire adjustment inside an isolated transaction
  const movement = await prisma.$transaction(async (tx) => {
    return executeMovement(
      {
        variantId: data.variantId,
        employeeId: executorId,
        type: data.type,
        quantityChanged: data.quantityChanged,
        reason: data.reason ?? null,
        referenceNumber: data.referenceNumber ?? null,
      },
      tx
    );
  });

  // Fire-and-forget audit log for the manual action
  auditRepository.create({
    performedBy: executorId,
    action: "CREATE",
    module: "INVENTORY",
    tableName: "inventory_movements",
    recordId: movement.id,
    newData: movement as unknown as Record<string, unknown>,
  });

  logger.info(
    { executorId, variantId: data.variantId, type: data.type, qty: data.quantityChanged },
    "Manual inventory adjustment completed"
  );

  return movement;
}
