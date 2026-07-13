import { prisma } from "../config/prisma";
import { Prisma } from "../../generated/prisma";
import { buildPrismaQuery } from "../utils/queryEngine";
import type { PaginationParams } from "../types/common.types";

export const exchangeRepository = {
  /**
   * Generates the next sequential Exchange number (e.g. EX-202611-001)
   */
  async generateNextExchangeNumber(tx: Prisma.TransactionClient): Promise<string> {
    const today = new Date();
    const prefix = `EX-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}`;

    const lastExchange = await tx.exchange.findFirst({
      where: { exchangeNumber: { startsWith: prefix } },
      orderBy: { exchangeNumber: "desc" },
      select: { exchangeNumber: true },
    });

    let sequence = 1;
    if (lastExchange) {
      const parts = lastExchange.exchangeNumber.split("-");
      if (parts.length === 3 && parts[2]) {
        sequence = parseInt(parts[2], 10) + 1;
      }
    }

    return `${prefix}-${String(sequence).padStart(4, "0")}`;
  },

  /**
   * Query Engine integration for listing exchanges
   */
  async findAll(params: PaginationParams) {
    const queryArgs = buildPrismaQuery<Prisma.ExchangeWhereInput>(
      {
        searchableFields: ["exchangeNumber", "exchangeReason"],
        allowedSortFields: ["exchangeDate", "priceDifference", "createdAt"],
        allowedFilters: ["status", "employeeId", "customerId"],
        defaultSort: { field: "createdAt", order: "desc" },
      },
      params
    );

    return prisma.$transaction([
      prisma.exchange.count({ where: queryArgs.where }),
      prisma.exchange.findMany({
        ...queryArgs,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          employee: { select: { id: true, firstName: true, lastName: true } },
          returnedItems: true,
          issuedItems: true,
        },
      }),
    ]);
  },

  /**
   * Find exchange by ID with full relations
   */
  async findById(id: string) {
    return prisma.exchange.findUnique({
      where: { id },
      include: {
        customer: true,
        employee: { select: { id: true, firstName: true, lastName: true } },
        originalSale: { select: { saleNumber: true } },
        returnedItems: {
          include: {
            variant: {
              include: { product: true, size: true, color: true }
            }
          }
        },
        issuedItems: {
          include: {
            variant: {
              include: { product: true, size: true, color: true }
            }
          }
        },
      },
    });
  },

  /**
   * Sums up previous returned quantities for a specific sale item to prevent over-exchanging.
   */
  async getPreviouslyReturnedQuantities(originalSaleId: string): Promise<Record<string, number>> {
    // We look at all COMPLETED exchanges for this sale
    const pastExchanges = await prisma.exchange.findMany({
      where: {
        originalSaleId,
        status: "COMPLETED",
      },
      include: {
        returnedItems: true,
      },
    });

    const quantityMap: Record<string, number> = {};
    for (const exchange of pastExchanges) {
      for (const item of exchange.returnedItems) {
        quantityMap[item.variantId] = (quantityMap[item.variantId] || 0) + item.quantity;
      }
    }

    return quantityMap;
  }
};
