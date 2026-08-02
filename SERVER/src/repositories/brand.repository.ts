import type { Prisma } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import type { ListBrandsQuery } from "../validation/catalog.validation";

/**
 * Sort fields are optional here even though the HTTP validator supplies
 * defaults: internal callers (pickers, lookups) build a query object by hand
 * and have no opinion on ordering.
 */
type BrandQuery = Omit<ListBrandsQuery, "sortBy" | "sortOrder"> &
  Partial<Pick<ListBrandsQuery, "sortBy" | "sortOrder">>;

export const brandRepository = {
  async findMany(query: BrandQuery) {
    const { page, limit, search, isActive, sortBy = "name", sortOrder = "asc" } = query;
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
        orderBy: { [sortBy]: sortOrder },
      }),
    ]);

    return { total, data };
  },

  async findById(id: string) {
    return prisma.brand.findUnique({ where: { id } });
  },

  /**
   * Catalogue + sales rollup for a page of brands, in ONE query rather than
   * two per row.
   *
   * Sales reach a brand through sale_items → product_variants → products, so
   * this is an aggregate over that join restricted to the ids on screen. Note
   * the lowercase @@map-ed table names — the Prisma model names do not exist
   * as relations in Postgres.
   *
   * COUNT(DISTINCT p.id) is deliberate: a brand's product count must not be
   * multiplied by the number of variants or sale lines those products have.
   */
  async statsFor(brandIds: string[]) {
    if (brandIds.length === 0) return [];

    // Each metric is its own correlated scalar. Combining them into a single
    // join chain would multiply the catalogue counts by the number of sale
    // lines — the same fan-out trap documented for the reports repository.
    return prisma.$queryRaw<
      {
        brandId: string;
        productCount: bigint;
        variantCount: bigint;
        unitsSold: bigint;
        revenue: string | null;
        stockUnits: bigint;
        stockValue: string | null;
      }[]
    >`
      SELECT
        b."id" AS "brandId",
        (
          SELECT COUNT(*) FROM "products" p
          WHERE p."brandId" = b."id" AND p."isActive" = TRUE
        ) AS "productCount",
        (
          SELECT COUNT(*) FROM "product_variants" pv
          JOIN "products" p ON p."id" = pv."productId"
          WHERE p."brandId" = b."id" AND p."isActive" = TRUE
        ) AS "variantCount",
        (
          SELECT COALESCE(SUM(si."quantity"), 0) FROM "sale_items" si
          JOIN "product_variants" pv ON pv."id" = si."variantId"
          JOIN "products" p ON p."id" = pv."productId"
          WHERE p."brandId" = b."id"
        ) AS "unitsSold",
        (
          SELECT COALESCE(SUM(si."totalPrice"), 0) FROM "sale_items" si
          JOIN "product_variants" pv ON pv."id" = si."variantId"
          JOIN "products" p ON p."id" = pv."productId"
          WHERE p."brandId" = b."id"
        ) AS "revenue",
        (
          SELECT COALESCE(SUM(pv."currentStock"), 0) FROM "product_variants" pv
          JOIN "products" p ON p."id" = pv."productId"
          WHERE p."brandId" = b."id" AND p."isActive" = TRUE
        ) AS "stockUnits",
        (
          SELECT COALESCE(SUM(pv."currentStock" * pv."costPrice"), 0)
          FROM "product_variants" pv
          JOIN "products" p ON p."id" = pv."productId"
          WHERE p."brandId" = b."id" AND p."isActive" = TRUE
        ) AS "stockValue"
      FROM "brands" b
      WHERE b."id" = ANY(${brandIds})
    `;
  },

  async findByName(name: string, excludeId?: string) {
    return prisma.brand.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        ...(excludeId && { id: { not: excludeId } }),
      },
    });
  },

  /**
   * Total products pointing at this brand, INCLUDING deactivated ones.
   *
   * The delete guard must use this rather than the active-only `productCount`
   * from statsFor: an inactive product still holds the Restrict foreign key, so
   * a brand whose products are all deactivated would pass an active-only check
   * and then fail on the constraint with an opaque database error.
   */
  async referenceCount(brandId: string) {
    return prisma.product.count({ where: { brandId } });
  },

  async create(data: Prisma.BrandCreateInput) {
    return prisma.brand.create({ data });
  },

  async remove(id: string) {
    return prisma.brand.delete({ where: { id } });
  },

  async update(id: string, data: Prisma.BrandUpdateInput) {
    return prisma.brand.update({
      where: { id },
      data,
    });
  },
};
