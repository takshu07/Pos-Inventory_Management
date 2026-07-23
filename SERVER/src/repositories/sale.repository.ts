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
  async findById(idOrSaleNumber: string) {
    return prisma.sale.findFirst({
      where: {
        OR: [
          { id: idOrSaleNumber },
          { saleNumber: idOrSaleNumber }
        ]
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        employee: { select: { id: true, firstName: true, lastName: true } },
        items: true,
        payments: true,
        exchanges: {
          orderBy: { exchangeDate: "asc" },
          include: {
            returnedItems: {
              include: {
                variant: {
                  select: {
                    sku: true,
                    product: { select: { name: true } },
                    size: { select: { name: true } },
                    color: { select: { name: true } },
                  },
                },
              },
            },
            issuedItems: {
              include: {
                variant: {
                  select: {
                    sku: true,
                    product: { select: { name: true } },
                    size: { select: { name: true } },
                    color: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
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

    // NOTE: This is a read-only list query and does NOT need transactional
    // atomicity. Wrapping the count + deeply-nested findMany in an interactive
    // $transaction gave the whole batch a 5s timeout; the nested exchange/
    // item includes routinely blew past it, throwing "expired transaction" and
    // surfacing as a 500. Run them as independent parallel reads instead.
    const [total, data] = await Promise.all([
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
          // Exchange summary for the list UI: number, values, and item lines so the
          // grid / customer-history cards can show what was swapped without a drill-in.
          exchanges: {
            orderBy: { exchangeDate: "asc" },
            select: {
              id: true,
              exchangeNumber: true,
              exchangeDate: true,
              returnedValue: true,
              issuedValue: true,
              priceDifference: true,
              status: true,
              returnedItems: {
                select: {
                  id: true,
                  quantity: true,
                  totalValue: true,
                  variant: {
                    select: {
                      sku: true,
                      product: { select: { name: true } },
                      size: { select: { name: true } },
                      color: { select: { name: true } },
                    },
                  },
                },
              },
              issuedItems: {
                select: {
                  id: true,
                  quantity: true,
                  totalValue: true,
                  variant: {
                    select: {
                      sku: true,
                      product: { select: { name: true } },
                      size: { select: { name: true } },
                      color: { select: { name: true } },
                    },
                  },
                },
              },
            },
          },
          items: true,
        },
      }),
    ]);

    return { total, data };
  },
};
