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
    const { page, limit, supplierId, status, search } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.PurchaseWhereInput = {
      ...(supplierId && { supplierId }),
      ...(status && { status }),
      ...(search && {
        OR: [
          { purchaseNumber: { contains: search, mode: "insensitive" } },
          { supplierInvoiceNumber: { contains: search, mode: "insensitive" } },
        ],
      }),
    };

    const [total, data] = await prisma.$transaction([
      prisma.purchase.count({ where }),
      prisma.purchase.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          supplier: { select: { id: true, businessName: true } },
          employee: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { items: true } },
        },
      }),
    ]);

    return { total, data };
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
};
