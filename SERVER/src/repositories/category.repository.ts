import type { Prisma } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import type { ListCategoriesQuery } from "../validation/catalog.validation";

export const categoryRepository = {
  async findMany(query: ListCategoriesQuery) {
    const { page, limit, search, isActive } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.CategoryWhereInput = {
      ...(isActive !== undefined && { isActive }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      }),
    };

    // Parallel count and fetch for performance
    const [total, data] = await prisma.$transaction([
      prisma.category.count({ where }),
      prisma.category.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      }),
    ]);

    return { total, data };
  },

  async findById(id: string) {
    return prisma.category.findUnique({ where: { id } });
  },

  async findByName(name: string, excludeId?: string) {
    return prisma.category.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        ...(excludeId && { id: { not: excludeId } }),
      },
    });
  },

  async create(data: Prisma.CategoryCreateInput) {
    return prisma.category.create({ data });
  },

  async update(id: string, data: Prisma.CategoryUpdateInput) {
    return prisma.category.update({
      where: { id },
      data,
    });
  },
};
