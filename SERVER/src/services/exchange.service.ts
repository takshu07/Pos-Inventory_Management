import { Prisma, MovementType, ExchangeStatus } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import { AppError } from "../errors/AppError";
import { HTTP_STATUS } from "../constants/httpStatus";
import { logger } from "../config/logger";
import { auditRepository } from "../repositories/audit.repository";
import { exchangeRepository } from "../repositories/exchange.repository";
import { executeMovement } from "./inventoryMovement.service";
import { formatPaginatedResponse } from "../utils/queryEngine";
import type { PaginationParams } from "../types/common.types";
import type { CreateExchangeInput } from "../validation/exchange.validation";

export const exchangeService = {
  async getExchanges(params: PaginationParams) {
    const [total, data] = await exchangeRepository.findAll(params);
    return formatPaginatedResponse(data, total, params);
  },

  async getExchangeById(id: string) {
    const exchange = await exchangeRepository.findById(id);
    if (!exchange) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Exchange record not found");
    }
    return exchange;
  },

  async processExchange(payload: CreateExchangeInput, employeeId: string) {
    // 1. Validate Original Sale
    const originalSale = await prisma.sale.findUnique({
      where: { id: payload.originalSaleId },
      include: { items: true },
    });

    if (!originalSale) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Original sale not found");
    }

    if (originalSale.status !== "COMPLETED" && originalSale.status !== "PARTIAL") {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Cannot exchange items from an incomplete or voided sale");
    }

    // 2. Validate Returns
    const previouslyReturnedMap = await exchangeRepository.getPreviouslyReturnedQuantities(payload.originalSaleId);
    
    let returnedValue = new Prisma.Decimal(0);
    const validatedReturns: Prisma.ExchangeReturnItemUncheckedCreateWithoutExchangeInput[] = [];

    for (const ret of payload.returnedItems) {
      const originalItem = originalSale.items.find((i) => i.variantId === ret.variantId);
      if (!originalItem) {
        throw new AppError(HTTP_STATUS.BAD_REQUEST, `Variant ${ret.variantId} was not part of the original sale.`);
      }

      const previouslyReturned = previouslyReturnedMap[ret.variantId] || 0;
      const availableToReturn = originalItem.quantity - previouslyReturned;

      if (ret.quantity > availableToReturn) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          `Cannot return ${ret.quantity} of variant ${ret.variantId}. Only ${availableToReturn} eligible.`
        );
      }

      // Re-calculate the effective unit price paid after discounts
      // Note: This relies on the original sale item's totalPrice which accounts for manual/item discounts.
      const unitPricePaid = new Prisma.Decimal(originalItem.totalPrice).dividedBy(originalItem.quantity);
      const lineReturnTotal = unitPricePaid.mul(ret.quantity);
      
      returnedValue = returnedValue.add(lineReturnTotal);

      validatedReturns.push({
        variantId: ret.variantId,
        quantity: ret.quantity,
        priceAtSale: unitPricePaid,
        totalValue: lineReturnTotal,
      });
    }

    // 3. Validate Issues
    const issueVariantIds = payload.issuedItems.map(i => i.variantId);
    const dbVariants = await prisma.productVariant.findMany({
      where: { id: { in: issueVariantIds }, isActive: true },
    });

    if (dbVariants.length !== payload.issuedItems.length) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "One or more issued variants are invalid or inactive.");
    }

    let issuedValue = new Prisma.Decimal(0);
    const validatedIssues: Prisma.ExchangeIssuedItemUncheckedCreateWithoutExchangeInput[] = [];

    for (const issue of payload.issuedItems) {
      const variant = dbVariants.find(v => v.id === issue.variantId)!;
      
      if (variant.currentStock < issue.quantity) {
        throw new AppError(HTTP_STATUS.BAD_REQUEST, `Insufficient stock for variant ${variant.sku}.`);
      }

      const lineIssueTotal = new Prisma.Decimal(variant.sellingPrice).mul(issue.quantity);
      issuedValue = issuedValue.add(lineIssueTotal);

      validatedIssues.push({
        variantId: issue.variantId,
        quantity: issue.quantity,
        sellingPrice: variant.sellingPrice,
        totalValue: lineIssueTotal,
      });
    }

    // 4. Calculate Price Difference
    const priceDifference = issuedValue.sub(returnedValue);

    // 5. Execute Transaction
    const exchange = await prisma.$transaction(async (tx) => {
      const exchangeNumber = await exchangeRepository.generateNextExchangeNumber(tx);

      const createdExchange = await tx.exchange.create({
        data: {
          exchangeNumber,
          originalSaleId: originalSale.id,
          customerId: originalSale.customerId,
          employeeId,
          returnedValue,
          issuedValue,
          priceDifference,
          exchangeReason: payload.exchangeReason ?? null,
          notes: payload.notes ?? null,
          status: ExchangeStatus.COMPLETED,
          returnedItems: {
            create: validatedReturns,
          },
          issuedItems: {
            create: validatedIssues,
          },
        },
      });

      // Execute inventory movements for RETURNS (Stock increases)
      for (const ret of validatedReturns) {
        await executeMovement(
          {
            variantId: ret.variantId,
            quantityChanged: ret.quantity, // positive
            type: MovementType.EXCHANGE_IN,
            employeeId,
            relatedExchangeId: createdExchange.id,
          },
          tx
        );
      }

      // Execute inventory movements for ISSUES (Stock decreases)
      for (const issue of validatedIssues) {
        await executeMovement(
          {
            variantId: issue.variantId,
            quantityChanged: -issue.quantity, // negative
            type: MovementType.EXCHANGE_OUT,
            employeeId,
            relatedExchangeId: createdExchange.id,
          },
          tx
        );
      }

      // Future hook: If priceDifference > 0, we could generate a pending Payment record.
      // For now, it assumes cash is collected instantly.

      return createdExchange;
    });

    // 6. Asynchronous Audit Logging
    auditRepository.create({
      performedBy: employeeId,
      action: "CREATE",
      module: "EXCHANGE",
      tableName: "exchanges",
      recordId: exchange.id,
      newData: { exchangeNumber: exchange.exchangeNumber, priceDifference },
    }).catch(err => logger.error({ err, exchangeId: exchange.id }, "Failed to log exchange audit"));

    return exchange;
  }
};
