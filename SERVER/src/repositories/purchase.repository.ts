import type { Prisma } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import type { ListPurchasesQuery } from "../validation/purchase.validation";

export type PurchaseWithDetails = Prisma.PurchaseGetPayload<{
  include: {
    supplier: { select: { id: true; businessName: true; isActive: true } };
    employee: { select: { id: true; firstName: true; lastName: true } };
    items: {
      include: {
        variant: {
          select: {
            id: true;
            sku: true;
            barcode: true;
            currentStock: true;
            product: { select: { name: true } };
            size: { select: { name: true } };
            color: { select: { name: true } };
          };
        };
      };
    };
  };
}>;

export const purchaseRepository = {
  async findMany(query: ListPurchasesQuery) {
    const {
      page,
      limit,
      supplierId,
      status,
      search,
      paymentStatus,
      dateFrom,
      dateTo,
      sortBy,
      sortOrder,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.PurchaseWhereInput = {
      ...(supplierId && { supplierId }),
      ...(status && { status }),
      ...(paymentStatus && { paymentStatus: paymentStatus as never }),
      ...((dateFrom || dateTo) && {
        purchaseDate: {
          ...(dateFrom && { gte: dateFrom }),
          ...(dateTo && { lte: dateTo }),
        },
      }),
      ...(search && {
        OR: [
          { purchaseNumber: { contains: search, mode: "insensitive" } },
          { supplierInvoiceNumber: { contains: search, mode: "insensitive" } },
          { supplier: { businessName: { contains: search, mode: "insensitive" } } },
        ],
      }),
    };

    const [total, data] = await prisma.$transaction([
      prisma.purchase.count({ where }),
      prisma.purchase.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          supplier: { select: { id: true, businessName: true } },
          employee: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { items: true } },
          // Receipt progress for the list badge. Cheap: two ints per line, and
          // a purchase has a handful of lines, not thousands.
          items: { select: { quantity: true, receivedQuantity: true } },
        },
      }),
    ]);

    return { total, data };
  },

  /**
   * Supplier procurement rollup — lifetime spend, bill counts and outstanding
   * balance in ONE grouped pass instead of N queries per supplier row.
   */
  async statsBySupplier(supplierIds: string[]) {
    if (supplierIds.length === 0) return [];

    return prisma.purchase.groupBy({
      by: ["supplierId"],
      where: { supplierId: { in: supplierIds }, status: { not: "CANCELLED" } },
      _count: { _all: true },
      _sum: { totalAmount: true, paidAmount: true, dueAmount: true },
      _max: { purchaseDate: true },
    });
  },

  async findById(id: string): Promise<PurchaseWithDetails | null> {
    return prisma.purchase.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, businessName: true, isActive: true } },
        employee: { select: { id: true, firstName: true, lastName: true } },
        items: {
          include: {
            variant: {
              select: {
                id: true,
                sku: true,
                barcode: true,
                currentStock: true,
                product: { select: { name: true } },
                size: { select: { name: true } },
                color: { select: { name: true } },
              },
            },
          },
        },
      },
    });
  },

  async create(data: Prisma.PurchaseCreateInput) {
    return prisma.purchase.create({
      data,
      include: { items: true },
    });
  },

  async update(id: string, data: Prisma.PurchaseUpdateInput) {
    return prisma.purchase.update({
      where: { id },
      data,
      include: { items: true },
    });
  },

  /** Settlement payments recorded against a bill, newest first. */
  async paymentsFor(purchaseId: string) {
    return prisma.supplierPayment.findMany({
      where: { purchaseId },
      orderBy: { paidAt: "desc" },
      select: {
        id: true,
        paymentNumber: true,
        amount: true,
        paymentMethod: true,
        referenceNumber: true,
        notes: true,
        paidAt: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  },
};
