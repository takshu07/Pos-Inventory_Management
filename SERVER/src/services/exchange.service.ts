import { Prisma, MovementType, ExchangeStatus, ReturnCondition } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import { AppError } from "../errors/AppError";
import { HTTP_STATUS } from "../constants/httpStatus";
import { logger } from "../config/logger";
import { auditRepository } from "../repositories/audit.repository";
import { exchangeRepository } from "../repositories/exchange.repository";
import { executeMovement } from "./inventoryMovement.service";
import { formatPaginatedResponse } from "../utils/queryEngine";
import { evaluateExchangeWindow } from "../utils/exchangeWindow";
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

    // NEW VALIDATION: Customer Ownership
    if (!payload.customerId || originalSale.customerId !== payload.customerId) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Customer mismatch: Exchange must belong to the original customer.");
    }

    // VALIDATION: Purchase within the configured exchange window.
    // The window length comes from the ConfigurationEngine via the shared
    // evaluateExchangeWindow helper — the same source of truth the customer
    // eligibility endpoint uses — so UI and enforcement never diverge.
    const windowStatus = evaluateExchangeWindow(originalSale.saleDate);
    if (!windowStatus.eligible) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        `Exchange rejected: Purchase is older than the ${windowStatus.windowDays}-day exchange window.`
      );
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
        condition: ret.condition as ReturnCondition,
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

    const returnVariantIds = payload.returnedItems.map(i => i.variantId);
    const returnedVariants = await prisma.productVariant.findMany({
      where: { id: { in: returnVariantIds } }
    });

    let issuedValue = new Prisma.Decimal(0);
    const validatedIssues: Prisma.ExchangeIssuedItemUncheckedCreateWithoutExchangeInput[] = [];

    for (const issue of payload.issuedItems) {
      const variant = dbVariants.find(v => v.id === issue.variantId)!;
      
      if (variant.currentStock < issue.quantity) {
        throw new AppError(HTTP_STATUS.BAD_REQUEST, `Insufficient stock for variant ${variant.sku}.`);
      }

      // NEW VALIDATION: MRP RULE
      // Find the old product's MRP. For simplicity, we check if ANY returned item has a higher MRP than the replacement.
      // In a strict mapping, each issue is linked to a specific return. We will enforce that the new item's MRP is >= the highest returned MRP.
      const highestReturnedMrp = returnedVariants.reduce((max, rv) => Math.max(max, Number(rv.mrp)), 0);
      if (Number(variant.mrp) < highestReturnedMrp) {
        throw new AppError(HTTP_STATUS.BAD_REQUEST, `MRP Rule Failed: Replacement product MRP (${variant.mrp}) cannot be lower than the returned product MRP (${highestReturnedMrp}).`);
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

    if (priceDifference.greaterThan(0)) {
      const payments = payload.payments || [];
      const totalPayment = payments.reduce((sum, p) => sum + p.amount, 0);
      if (new Prisma.Decimal(totalPayment).lessThan(priceDifference)) {
        throw new AppError(HTTP_STATUS.BAD_REQUEST, "Total payment amount is less than the price difference.");
      }
    }

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

      // Issue store credit if negative difference
      if (priceDifference.lessThan(0)) {
        await tx.customer.update({
          where: { id: originalSale.customerId },
          data: {
            storeCredit: {
              increment: priceDifference.abs()
            }
          }
        });
      }

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

      // Process Payments if any
      const payments = payload.payments || [];
      if (payments.length > 0) {
        await tx.payment.createMany({
          data: payments.map((p) => ({
            exchangeId: createdExchange.id,
            method: p.method as any,
            amount: p.amount,
            transactionRef: p.transactionRef ?? null,
            status: "PAID",
          })),
        });
      }

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
