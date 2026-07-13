import { Prisma } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import type { ListSalesQuery } from "../validation/sale.validation";

export const saleRepository = {
  /**
   * Creates the root Sale record.
   * MUST be executed within the overarching Prisma Transaction.
   */
  async createSale(
    tx: Prisma.TransactionClient,
    data: Prisma.SaleUncheckedCreateInput
  ) {
    return tx.sale.create({
      data,
    });
  },

  /**
   * Bulk creates the SaleItem records (with strict archival snapshots).
   * MUST be executed within the overarching Prisma Transaction.
   */
  async createSaleItems(
    tx: Prisma.TransactionClient,
    data: Prisma.SaleItemUncheckedCreateInput[]
  ) {
    return tx.saleItem.createMany({
      data,
    });
  },

  /**
   * Bulk creates the Payment records.
   * MUST be executed within the overarching Prisma Transaction.
   */
  async createPayments(
    tx: Prisma.TransactionClient,
    data: Prisma.PaymentUncheckedCreateInput[]
  ) {
    return tx.payment.createMany({
      data,
    });
  },

  /**
   * Fetches a single Sale with all necessary relations for rendering a Receipt.
   */
  async findById(id: string) {
    return prisma.sale.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        employee: { select: { id: true, firstName: true, lastName: true } },
        items: true,
        payments: true,
      },
    });
  },

  /**
   * Idempotency Check: Fetches a Sale by its Idempotency-Key.
   * If found, the Service will intercept and return this existing Sale
   * instead of creating a duplicate.
   */
  async findByIdempotencyKey(idempotencyKey: string) {
    return prisma.sale.findUnique({
      where: { idempotencyKey },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        employee: { select: { id: true, firstName: true, lastName: true } },
        items: true,
        payments: true,
      },
    });
  },

  /**
   * Enterprise Search: Fetches a paginated grid of Sales with advanced filtering
   * and fuzzy search capabilities (matching Invoice, Customer Name, Customer Phone).
   */
  async findMany(query: ListSalesQuery) {
    const { page, limit, status, customerId, employeeId, search, startDate, endDate } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.SaleWhereInput = {
      ...(status && { status }),
      ...(customerId && { customerId }),
      ...(employeeId && { employeeId }),
      ...(startDate &&
        endDate && {
          saleDate: {
            gte: new Date(startDate),
            lte: new Date(endDate),
          },
        }),
      ...(search && {
        OR: [
          { saleNumber: { contains: search, mode: "insensitive" } },
          { customer: { name: { contains: search, mode: "insensitive" } } },
          { customer: { phone: { contains: search, mode: "insensitive" } } },
          // Note: Filtering by deep relations like SKU is possible but can degrade performance 
          // on massive tables without explicit composite indexes. Kept lightweight for now.
        ],
      }),
    };

    const [total, data] = await prisma.$transaction([
      prisma.sale.count({ where }),
      prisma.sale.findMany({
        where,
        skip,
        take: limit,
        orderBy: { saleDate: "desc" },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          employee: { select: { id: true, firstName: true, lastName: true } },
          // We include payments to render payment status chips on the grid UI
          payments: { select: { method: true, amount: true, status: true } },
        },
      }),
    ]);

    return { total, data };
  },
};
