import type { Prisma } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import type { ListSuppliersQuery } from "../validation/catalog.validation";

export const supplierRepository = {
  async findMany(query: ListSuppliersQuery) {
    const { page, limit, search, isActive } = query;
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
        orderBy: { businessName: "asc" },
      }),
    ]);

    return { total, data };
  },

  async findById(id: string) {
    return prisma.supplier.findUnique({ where: { id } });
  },

  async findByPhone(phone: string, excludeId?: string) {
    return prisma.supplier.findFirst({
      where: {
        phone,
        ...(excludeId && { id: { not: excludeId } }),
      },
    });
  },

  async create(data: Prisma.SupplierCreateInput) {
    return prisma.supplier.create({ data });
  },

  async update(id: string, data: Prisma.SupplierUpdateInput) {
    return prisma.supplier.update({
      where: { id },
      data,
    });
  },
};
