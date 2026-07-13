import type { Prisma } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import type { ListBrandsQuery } from "../validation/catalog.validation";

export const brandRepository = {
  async findMany(query: ListBrandsQuery) {
    const { page, limit, search, isActive } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.BrandWhereInput = {
      ...(isActive !== undefined && { isActive }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      }),
    };

    const [total, data] = await prisma.$transaction([
      prisma.brand.count({ where }),
      prisma.brand.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: "asc" },
      }),
    ]);

    return { total, data };
  },

  async findById(id: string) {
    return prisma.brand.findUnique({ where: { id } });
  },

  async findByName(name: string, excludeId?: string) {
    return prisma.brand.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        ...(excludeId && { id: { not: excludeId } }),
      },
    });
  },

  async create(data: Prisma.BrandCreateInput) {
    return prisma.brand.create({ data });
  },

  async update(id: string, data: Prisma.BrandUpdateInput) {
    return prisma.brand.update({
      where: { id },
      data,
    });
  },
};
