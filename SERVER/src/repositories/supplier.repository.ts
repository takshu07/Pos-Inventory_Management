import type { Prisma } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import type { ListSuppliersQuery } from "../validation/catalog.validation";

/** Sort fields optional for internal callers — see brand.repository. */
type SupplierQuery = Omit<ListSuppliersQuery, "sortBy" | "sortOrder"> &
  Partial<Pick<ListSuppliersQuery, "sortBy" | "sortOrder">>;

export const supplierRepository = {
  async findMany(query: SupplierQuery) {
    const {
      page,
      limit,
      search,
      isActive,
      sortBy = "businessName",
      sortOrder = "asc",
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.SupplierWhereInput = {
      ...(isActive !== undefined && { isActive }),
      ...(search && {
        OR: [
          { businessName: { contains: search, mode: "insensitive" } },
          { contactPerson: { contains: search, mode: "insensitive" } },
          { phone: { contains: search } }, // phone numbers shouldn't need insensitive
          { email: { contains: search, mode: "insensitive" } },
        ],
      }),
    };

    const [total, data] = await prisma.$transaction([
      prisma.supplier.count({ where }),
      prisma.supplier.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
    ]);

    return { total, data };
  },

  async findById(id: string) {
    return prisma.supplier.findUnique({ where: { id } });
  },

  /**
   * Procurement and settlement rollup for a page of suppliers.
   *
   * Two grouped passes rather than one join: purchases and payments are
   * independent one-to-many branches off Supplier, and joining both at once
   * would multiply each by the other's row count.
   *
   * CANCELLED bills are excluded from spend and balances — a cancelled order
   * was never a liability.
   */
  async statsFor(supplierIds: string[]) {
    if (supplierIds.length === 0) {
      return { purchases: [], payments: [], products: [] };
    }

    const [purchases, payments, products] = await Promise.all([
      prisma.purchase.groupBy({
        by: ["supplierId"],
        where: { supplierId: { in: supplierIds }, status: { not: "CANCELLED" } },
        _count: { _all: true },
        _sum: { totalAmount: true, paidAmount: true, dueAmount: true },
        _max: { purchaseDate: true },
      }),
      prisma.supplierPayment.groupBy({
        by: ["supplierId"],
        where: { supplierId: { in: supplierIds } },
        _count: { _all: true },
        _sum: { amount: true },
        _max: { paidAt: true },
      }),
      prisma.productVariant.groupBy({
        by: ["supplierId"],
        where: { supplierId: { in: supplierIds } },
        _count: { _all: true },
      }),
    ]);

    return { purchases, payments, products };
  },

  /** Bills raised on a supplier, newest first. */
  async purchaseHistory(supplierId: string, limit = 50) {
    return prisma.purchase.findMany({
      where: { supplierId },
      orderBy: { purchaseDate: "desc" },
      take: limit,
      select: {
        id: true,
        purchaseNumber: true,
        supplierInvoiceNumber: true,
        purchaseDate: true,
        status: true,
        totalAmount: true,
        paidAmount: true,
        dueAmount: true,
        paymentStatus: true,
        dueDate: true,
        receivedAt: true,
        _count: { select: { items: true } },
      },
    });
  },

  /** Settlement history for a supplier, newest first. */
  async paymentHistory(supplierId: string, limit = 50) {
    return prisma.supplierPayment.findMany({
      where: { supplierId },
      orderBy: { paidAt: "desc" },
      take: limit,
      select: {
        id: true,
        paymentNumber: true,
        amount: true,
        paymentMethod: true,
        referenceNumber: true,
        notes: true,
        paidAt: true,
        purchase: { select: { id: true, purchaseNumber: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  },

  /** Products this supplier is the sourcing origin for. */
  async suppliedProducts(supplierId: string, limit = 50) {
    return prisma.productVariant.findMany({
      where: { supplierId },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true,
        sku: true,
        currentStock: true,
        costPrice: true,
        supplierSku: true,
        leadTimeDays: true,
        product: { select: { id: true, name: true } },
        size: { select: { name: true } },
        color: { select: { name: true } },
      },
    });
  },

  async findByPhone(phone: string, excludeId?: string) {
    return prisma.supplier.findFirst({
      where: {
        phone,
        ...(excludeId && { id: { not: excludeId } }),
      },
    });
  },

  /**
   * Everything that would block a hard delete. Purchases and variants both hold
   * Restrict foreign keys to Supplier, so a supplier with any history must be
   * deactivated rather than deleted.
   */
  async referenceCounts(supplierId: string) {
    const [purchases, variants, payments] = await Promise.all([
      prisma.purchase.count({ where: { supplierId } }),
      prisma.productVariant.count({ where: { supplierId } }),
      prisma.supplierPayment.count({ where: { supplierId } }),
    ]);
    return { purchases, variants, payments };
  },

  async create(data: Prisma.SupplierCreateInput) {
    return prisma.supplier.create({ data });
  },

  async remove(id: string) {
    return prisma.supplier.delete({ where: { id } });
  },

  async update(id: string, data: Prisma.SupplierUpdateInput) {
    return prisma.supplier.update({
      where: { id },
      data,
    });
  },
};
