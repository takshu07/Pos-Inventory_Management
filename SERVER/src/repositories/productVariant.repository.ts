import type { Prisma } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import type { ListProductVariantsQuery } from "../validation/productVariant.validation";

export const productVariantRepository = {
  async findMany(query: ListProductVariantsQuery) {
    const { page, limit, search, productId, sizeId, colorId, isActive } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductVariantWhereInput = {
      ...(isActive !== undefined && { isActive }),
      ...(productId && { productId }),
      ...(sizeId && { sizeId }),
      ...(colorId && { colorId }),
      ...(search && {
        OR: [
          { sku: { contains: search, mode: "insensitive" } },
          { barcode: { contains: search, mode: "insensitive" } },
          { product: { name: { contains: search, mode: "insensitive" } } },
        ],
      }),
    };

    const [total, data] = await prisma.$transaction([
      prisma.productVariant.count({ where }),
      prisma.productVariant.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          product: { select: { id: true, name: true, category: { select: { name: true } } } },
          size: { select: { id: true, name: true } },
          color: { select: { id: true, name: true, hexCode: true } },
        },
      }),
    ]);

    return { total, data };
  },

  async findById(id: string) {
    return prisma.productVariant.findUnique({
      where: { id },
      include: {
        product: { select: { id: true, name: true } },
        size: { select: { id: true, name: true } },
        color: { select: { id: true, name: true, hexCode: true } },
      },
    });
  },

  async findByBarcode(barcode: string) {
    return prisma.productVariant.findUnique({
      where: { barcode },
      include: {
        product: { select: { id: true, name: true } },
        size: { select: { id: true, name: true } },
        color: { select: { id: true, name: true } },
      },
    });
  },

  async checkConstraints(sku: string, barcode?: string | null, excludeId?: string) {
    const whereSku: Prisma.ProductVariantWhereInput = { sku };
    if (excludeId) whereSku.id = { not: excludeId };
    
    const existingSku = await prisma.productVariant.findFirst({ where: whereSku });

    let existingBarcode = null;
    if (barcode) {
      const whereBarcode: Prisma.ProductVariantWhereInput = { barcode };
      if (excludeId) whereBarcode.id = { not: excludeId };
      existingBarcode = await prisma.productVariant.findFirst({ where: whereBarcode });
    }

    return { existingSku, existingBarcode };
  },

  async checkCombination(productId: string, sizeId: string, colorId: string, excludeId?: string) {
    return prisma.productVariant.findFirst({
      where: {
        productId,
        sizeId,
        colorId,
        ...(excludeId && { id: { not: excludeId } }),
      },
    });
  },

  async create(data: Prisma.ProductVariantCreateInput) {
    return prisma.productVariant.create({ 
      data,
      include: {
        product: { select: { id: true, name: true } },
        size: { select: { id: true, name: true } },
        color: { select: { id: true, name: true } },
      }
    });
  },

  async update(id: string, data: Prisma.ProductVariantUpdateInput) {
    return prisma.productVariant.update({
      where: { id },
      data,
      include: {
        product: { select: { id: true, name: true } },
        size: { select: { id: true, name: true } },
        color: { select: { id: true, name: true } },
      }
    });
  },

  /**
   * Enterprise Sales Engine helper: Fetches authoritative variant data
   * needed for calculating checkouts without exposing Prisma to the Service layer.
   */
  async findVariantsForCheckout(variantIds: string[], tx?: Prisma.TransactionClient) {
    const client = tx || prisma;
    return client.productVariant.findMany({
      where: {
        id: { in: variantIds },
      },
      select: {
        id: true,
        currentStock: true,
        isActive: true,
        sellingPrice: true,
        costPrice: true,
        sku: true,
        barcode: true,
        product: { select: { id: true, name: true, categoryId: true, brandId: true } },
        size: { select: { name: true } },
        color: { select: { name: true } },
      },
    });
  },
};
