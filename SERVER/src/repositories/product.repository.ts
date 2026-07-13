import type { Prisma } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import type { ListProductsQuery } from "../validation/product.validation";

export const productRepository = {
  async findMany(query: ListProductsQuery) {
    const { page, limit, search, categoryId, brandId, isActive } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {
      ...(isActive !== undefined && { isActive }),
      ...(categoryId && { categoryId }),
      ...(brandId && { brandId }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { searchKeywords: { contains: search, mode: "insensitive" } },
        ],
      }),
    };

    const [total, data] = await prisma.$transaction([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          _count: { select: { variants: true } }, // Useful for UI indicators
        },
      }),
    ]);

    return { total, data };
  },

  async findById(id: string) {
    return prisma.product.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
      },
    });
  },

  async findByName(name: string, excludeId?: string) {
    return prisma.product.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        ...(excludeId && { id: { not: excludeId } }),
      },
    });
  },

  async create(data: Prisma.ProductCreateInput) {
    return prisma.product.create({ 
      data,
      include: {
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
      }
    });
  },

  async update(id: string, data: Prisma.ProductUpdateInput) {
    return prisma.product.update({
      where: { id },
      data,
      include: {
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
      }
    });
  },

  // Future-proofing: Check if a product has active variants
  async hasActiveVariants(id: string) {
    const count = await prisma.productVariant.count({
      where: { productId: id, isActive: true },
    });
    return count > 0;
  }
};
